/**
 * Desktop Session Manager
 *
 * Manages sandboxed desktop sessions with VNC control.
 * Similar to BrowserSessionManager but for desktop environments.
 *
 * Automatically handles:
 * - Copying setup scripts to temp folder
 * - Generating dynamic sandbox configuration
 * - Launching sandbox with VNC server
 * - Connecting via VNC for screenshots and control
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import type {
  DesktopSession,
  DesktopSessionConfig,
  DesktopAction,
  ActionResult,
  InstructionResult,
  InstructionContext,
  SandboxInfo,
  SandboxConfig,
  VNCConfig,
  DesktopEvent,
} from './types';
import { DesktopSessionInstance } from './session';
import {
  createSessionCreatedEvent,
  createSessionUpdatedEvent,
  createSessionClosedEvent,
  createScreenshotEvent,
  createActionStartedEvent,
  createActionCompletedEvent,
  createClickMarkerEvent,
} from './events';

// Import Computer Use provider factory (reuse from browser module)
import { createComputerUseProvider } from '../browser/strategies/computer-use/providers/index';
import type { ComputerUseProvider } from '../browser/types';

const execAsync = promisify(exec);
const fsPromises = fs.promises;

/**
 * Interface for WebChannel-like broadcast capability.
 */
export interface IBroadcaster {
  broadcast(data: unknown): void;
}

export interface DesktopSessionManagerConfig {
  /** WebChannel for broadcasting events */
  webChannel?: IBroadcaster;
  /** Default sandbox configuration */
  defaultSandbox?: Partial<SandboxConfig>;
  /** Default VNC configuration */
  defaultVnc?: Partial<VNCConfig>;
  /** Path to sandbox configuration templates */
  sandboxConfigPath?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Pick<DesktopSessionManagerConfig, 'defaultSandbox' | 'defaultVnc'>> = {
  defaultSandbox: {
    type: 'windows-sandbox',
    platform: 'windows',
    memory: 4096,
    cpus: 2,
    enableGpu: true,
    enableNetwork: true,
  },
  defaultVnc: {
    host: 'localhost',
    port: 5900,
    password: 'olliebot',
    connectTimeout: 30000,
  },
};

/**
 * Manages sandboxed desktop sessions.
 */
export class DesktopSessionManager {
  private sessions: Map<string, DesktopSessionInstance> = new Map();
  private sandboxProcesses: Map<string, ChildProcess> = new Map();
  private sessionTempDirs: Map<string, string> = new Map(); // session ID -> temp dir path
  private sessionAbortControllers: Map<string, AbortController> = new Map(); // for cancelling in-progress provisioning
  private creationLock: Promise<void> = Promise.resolve(); // serializes createSession calls
  private webChannel?: IBroadcaster;
  private config: DesktopSessionManagerConfig;
  private sandboxConfigPath: string;

  constructor(config: DesktopSessionManagerConfig = {}) {
    this.config = config;
    this.webChannel = config.webChannel;
    // Path to source sandbox scripts (in the project)
    this.sandboxConfigPath = config.sandboxConfigPath || path.join(__dirname, '../../sandbox');
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Creates a new desktop session.
   */
  async createSession(config: DesktopSessionConfig): Promise<DesktopSession> {
    // Serialize creation to prevent double-launch (e.g. React StrictMode, duplicate tool calls)
    const result = new Promise<DesktopSession>((resolve, reject) => {
      this.creationLock = this.creationLock.then(
        () => this._doCreateSession(config).then(resolve, reject),
        () => this._doCreateSession(config).then(resolve, reject),
      );
    });
    return result;
  }

  private async _doCreateSession(config: DesktopSessionConfig): Promise<DesktopSession> {
    // Merge with defaults
    const sandboxConfig: SandboxConfig = {
      ...DEFAULT_CONFIG.defaultSandbox,
      ...this.config.defaultSandbox,
      ...config.sandbox,
    };

    const vncConfig: VNCConfig = {
      ...DEFAULT_CONFIG.defaultVnc,
      ...this.config.defaultVnc,
      ...config.vnc,
    };

    // Create sandbox info
    const sandboxInfo: SandboxInfo = {
      type: sandboxConfig.type,
      platform: sandboxConfig.platform,
      status: 'starting',
      vncPort: vncConfig.port,
    };

    // Create session instance
    const session = new DesktopSessionInstance(config, sandboxInfo);

    // Wire up event handlers
    this.setupSessionEventHandlers(session);

    // Store session
    this.sessions.set(session.id, session);

    // Create abort controller so closeSession() can cancel provisioning
    const abortController = new AbortController();
    this.sessionAbortControllers.set(session.id, abortController);

    // Broadcast session created (in provisioning state)
    this.broadcast(createSessionCreatedEvent(session.getSession()));

    try {
      // Launch sandbox
      console.log(`[Desktop] Launching sandbox for session ${session.id}...`);
      await this.launchSandbox(session.id, sandboxConfig, abortController.signal);

      // Check if aborted during sandbox launch
      if (abortController.signal.aborted) {
        throw new Error('Session creation aborted');
      }

      // Update sandbox status
      session.updateSandbox({ status: 'running', startedAt: new Date() });
      this.broadcast(createSessionUpdatedEvent(session.id, { sandbox: session.getSession().sandbox }));

      // Wait for VNC to become available
      console.log(`[Desktop] Waiting for VNC server on port ${vncConfig.port}...`);
      await this.waitForVNC(vncConfig.host, vncConfig.port, 60000, abortController.signal);

      // Initialize VNC connection
      console.log(`[Desktop] Connecting to VNC...`);
      await session.initialize(vncConfig);

      // Set up Computer Use provider if configured
      if (config.computerUseProvider) {
        const provider = createComputerUseProvider(config.computerUseProvider as ComputerUseProvider);
        if (provider && provider.isAvailable()) {
          session.setComputerUseProvider(provider);
          console.log(`[Desktop] Computer Use provider set: ${config.computerUseProvider}`);
        } else {
          console.warn(`[Desktop] Computer Use provider not available: ${config.computerUseProvider}`);
        }
      }

      console.log(`[Desktop] Session ${session.id} ready`);
      return session.getSession();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAborted = abortController.signal.aborted;

      if (isAborted) {
        // Session was closed during provisioning — clean up silently
        console.log(`[Desktop] Session ${session.id} creation was aborted, cleaning up`);
        await this.stopSandbox(session.id).catch(() => {});
        this.sessions.delete(session.id);
        this.broadcast(createSessionClosedEvent(session.id));
      } else {
        // Genuine error during provisioning
        session.updateSandbox({ status: 'error', error: errorMessage });
        this.broadcast(createSessionUpdatedEvent(session.id, {
          status: 'error',
          error: errorMessage,
          sandbox: session.getSession().sandbox,
        }));
      }

      throw error;
    } finally {
      this.sessionAbortControllers.delete(session.id);
    }
  }

  /**
   * Gets a session by ID.
   */
  getSession(sessionId: string): DesktopSession | undefined {
    return this.sessions.get(sessionId)?.getSession();
  }

  /**
   * Gets all sessions.
   */
  getSessions(): DesktopSession[] {
    return Array.from(this.sessions.values()).map((s) => s.getSession());
  }

  /**
   * Closes a session.
   */
  async closeSession(sessionId: string): Promise<void> {
    console.log(`[Desktop] Closing session ${sessionId}...`);

    // Abort any in-progress provisioning (waitForVNC, sandbox launch wait, etc.)
    const abortController = this.sessionAbortControllers.get(sessionId);
    if (abortController) {
      console.log(`[Desktop] Aborting in-progress provisioning for session ${sessionId}`);
      abortController.abort();
      this.sessionAbortControllers.delete(sessionId);
    }

    const session = this.sessions.get(sessionId);

    // Close the session (VNC disconnect, etc.) - if it was ever initialized
    if (session) {
      try {
        await session.close();
      } catch (error) {
        console.warn(`[Desktop] Error closing session instance: ${error}`);
      }
    }

    // Stop the sandbox (kill processes, clean up)
    await this.stopSandbox(sessionId);

    // Remove from sessions
    this.sessions.delete(sessionId);

    // Broadcast closed event
    this.broadcast(createSessionClosedEvent(sessionId));

    console.log(`[Desktop] Session ${sessionId} closed`);
  }

  /**
   * Closes all sessions.
   */
  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }

  // ===========================================================================
  // Action Execution
  // ===========================================================================

  /**
   * Executes an action on a session.
   */
  async executeAction(sessionId: string, action: DesktopAction): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        action,
        error: `Session not found: ${sessionId}`,
      };
    }

    return session.executeAction(action);
  }

  /**
   * Executes an instruction using Computer Use model.
   */
  async executeInstruction(
    sessionId: string,
    instruction: string,
    context?: InstructionContext
  ): Promise<InstructionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
        steps: 0,
        actions: [],
      };
    }

    return session.executeInstruction(instruction, context);
  }

  /**
   * Captures a screenshot from a session.
   */
  async captureScreenshot(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session.captureScreenshot();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Attaches a WebChannel for broadcasting events.
   */
  attachWebChannel(webChannel: IBroadcaster): void {
    this.webChannel = webChannel;
    console.log('[Desktop] WebChannel attached');
  }

  // ===========================================================================
  // Sandbox Management
  // ===========================================================================

  /**
   * Launches a sandbox based on configuration.
   */
  private async launchSandbox(sessionId: string, config: SandboxConfig, signal?: AbortSignal): Promise<void> {
    switch (config.type) {
      case 'windows-sandbox':
        await this.launchWindowsSandbox(sessionId, config, signal);
        break;

      case 'hyperv':
        await this.launchHyperVVM(sessionId, config);
        break;

      case 'virtualbox':
        await this.launchVirtualBoxVM(sessionId, config);
        break;

      case 'tart':
        await this.launchTartVM(sessionId, config);
        break;

      default:
        throw new Error(`Unsupported sandbox type: ${config.type}`);
    }
  }

  /**
   * Launches Windows Sandbox with automatic setup.
   *
   * This method:
   * 1. Creates a temp directory for this session
   * 2. Copies/generates the VNC setup script
   * 3. Generates a dynamic .wsb config file
   * 4. Launches Windows Sandbox
   */
  private async launchWindowsSandbox(sessionId: string, config: SandboxConfig, signal?: AbortSignal): Promise<void> {
    // Check if Windows Sandbox is available
    if (os.platform() !== 'win32') {
      throw new Error('Windows Sandbox is only available on Windows');
    }

    // Create temp directory for this session
    const tempDir = path.join(os.tmpdir(), `olliebot-desktop-${sessionId}`);
    await fsPromises.mkdir(tempDir, { recursive: true });
    this.sessionTempDirs.set(sessionId, tempDir);

    console.log(`[Desktop] Created temp directory: ${tempDir}`);

    // Copy or generate the VNC setup script
    const setupScriptPath = path.join(tempDir, 'setup-vnc.ps1');
    await this.generateVNCSetupScript(setupScriptPath, config);

    console.log(`[Desktop] Generated setup script: ${setupScriptPath}`);

    // Generate the .wsb config file
    const wsbPath = path.join(tempDir, 'sandbox.wsb');
    await this.generateWindowsSandboxConfig(wsbPath, tempDir, config);

    console.log(`[Desktop] Generated sandbox config: ${wsbPath}`);

    // Verify files exist before launching
    const wsbExists = fs.existsSync(wsbPath);
    const scriptExists = fs.existsSync(setupScriptPath);
    console.log(`[Desktop] Config file exists: ${wsbExists}, Setup script exists: ${scriptExists}`);

    // Log the .wsb content for debugging
    const wsbContent = await fsPromises.readFile(wsbPath, 'utf-8');
    console.log(`[Desktop] WSB config content:\n${wsbContent}`);

    // Launch Windows Sandbox with the .wsb config
    // Use path.resolve to ensure absolute path with native backslashes
    const resolvedWsbPath = path.resolve(wsbPath);
    console.log(`[Desktop] Launching: WindowsSandbox.exe "${resolvedWsbPath}"`);
    const sandboxProcess = spawn('WindowsSandbox.exe', [resolvedWsbPath], {
      detached: true,
      stdio: 'ignore',
    });

    sandboxProcess.on('error', (err) => {
      console.error(`[Desktop] Failed to launch WindowsSandbox.exe:`, err);
    });

    sandboxProcess.unref();
    this.sandboxProcesses.set(sessionId, sandboxProcess);

    // Windows Sandbox takes time to start and run the setup script
    // The setup script installs VNC which takes additional time
    console.log(`[Desktop] Waiting for sandbox to initialize (this may take 30-60 seconds)...`);
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Session creation aborted'));
      const timer = setTimeout(resolve, 20000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Session creation aborted'));
      }, { once: true });
    });
  }

  /**
   * Generates the VNC setup PowerShell script.
   */
  private async generateVNCSetupScript(scriptPath: string, config: SandboxConfig): Promise<void> {
    const vncPassword = 'olliebot'; // Default password, could be made configurable
    const vncPort = 5900;

    const script = `
# OllieBot Desktop Sandbox Setup Script
# Auto-generated for session

$ErrorActionPreference = "Stop"
$LogFile = "C:\\OllieBot\\setup.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append -Force
    Write-Host $Message
}

# Create log directory
New-Item -ItemType Directory -Force -Path "C:\\OllieBot" | Out-Null
Write-Log "Starting OllieBot Desktop Sandbox setup..."

# Create working directory
$WorkDir = "C:\\OllieBot\\temp"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

# Configure firewall for VNC
Write-Log "Configuring firewall for VNC..."
try {
    New-NetFirewallRule -DisplayName "OllieBot VNC" -Direction Inbound -Protocol TCP -LocalPort ${vncPort} -Action Allow -ErrorAction SilentlyContinue
    Write-Log "Firewall configured"
} catch {
    Write-Log "Firewall configuration failed: $_"
}

# Download and install TightVNC
Write-Log "Downloading TightVNC..."

$vncUrl = "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi"
$vncInstaller = "$WorkDir\\tightvnc.msi"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $vncUrl -OutFile $vncInstaller -UseBasicParsing
    Write-Log "TightVNC downloaded successfully"
} catch {
    Write-Log "Failed to download TightVNC: $_"

    # Fallback: Try alternative download method
    Write-Log "Trying alternative download method..."
    try {
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($vncUrl, $vncInstaller)
        Write-Log "TightVNC downloaded via WebClient"
    } catch {
        Write-Log "All download methods failed: $_"
        exit 1
    }
}

Write-Log "Installing TightVNC..."

# Silent install with predefined password
$arguments = @(
    "/i", $vncInstaller,
    "/quiet",
    "/norestart",
    "SET_USEVNCAUTHENTICATION=1",
    "VALUE_OF_USEVNCAUTHENTICATION=1",
    "SET_PASSWORD=1",
    "VALUE_OF_PASSWORD=${vncPassword}",
    "SET_USECONTROLAUTHENTICATION=1",
    "VALUE_OF_USECONTROLAUTHENTICATION=0",
    "SET_ACCEPTHTTPCONNECTIONS=1",
    "VALUE_OF_ACCEPTHTTPCONNECTIONS=0",
    "SET_RUNCONTROLINTERFACE=1",
    "VALUE_OF_RUNCONTROLINTERFACE=0"
)

$process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru

if ($process.ExitCode -eq 0) {
    Write-Log "TightVNC installed successfully"
} else {
    Write-Log "TightVNC installation failed with exit code: $($process.ExitCode)"
}

# Wait for service to be available
Start-Sleep -Seconds 3

# Start VNC server service
Write-Log "Starting VNC server..."
$vncService = Get-Service -Name "tvnserver" -ErrorAction SilentlyContinue
if ($vncService) {
    if ($vncService.Status -ne "Running") {
        Start-Service -Name "tvnserver"
        Write-Log "TightVNC service started"
    } else {
        Write-Log "TightVNC service already running"
    }
} else {
    # Try to start the server directly
    $vncExe = "C:\\Program Files\\TightVNC\\tvnserver.exe"
    if (Test-Path $vncExe) {
        Start-Process -FilePath $vncExe -ArgumentList "-start" -NoNewWindow
        Write-Log "TightVNC server started directly"
    } else {
        Write-Log "TightVNC executable not found at $vncExe"
    }
}

# Create ready signal file
$readyFile = "C:\\OllieBot\\ready.json"
$readyData = @{
    status = "ready"
    vnc_port = ${vncPort}
    timestamp = (Get-Date -Format "o")
    hostname = $env:COMPUTERNAME
} | ConvertTo-Json

$readyData | Out-File -FilePath $readyFile -Encoding UTF8
Write-Log "Ready signal written to $readyFile"

Write-Log "=== Setup Complete ==="
Write-Log "VNC should be available on port ${vncPort}"
Write-Log "Password: ${vncPassword}"

# Keep the PowerShell window open for debugging (optional)
# Start-Sleep -Seconds 3600
`;

    await fsPromises.writeFile(scriptPath, script, 'utf-8');
  }

  /**
   * Generates the Windows Sandbox .wsb configuration file.
   */
  private async generateWindowsSandboxConfig(
    wsbPath: string,
    hostFolder: string,
    config: SandboxConfig
  ): Promise<void> {
    const memory = config.memory || 4096;
    const enableGpu = config.enableGpu !== false ? 'Enable' : 'Disable';
    const enableNetwork = config.enableNetwork !== false ? 'Enabled' : 'Disabled';

    // Ensure Windows-native backslashes in the host folder path
    const resolvedHostFolder = path.resolve(hostFolder);

    // Windows Sandbox config XML
    const wsbConfig = `<Configuration>
  <!-- OllieBot Desktop Sandbox Configuration -->
  <!-- Auto-generated - do not edit -->

  <!-- Map the setup scripts folder into the sandbox -->
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${resolvedHostFolder}</HostFolder>
      <SandboxFolder>C:\\OllieBot</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>

  <!-- Enable networking for VNC access -->
  <Networking>${enableNetwork}</Networking>

  <!-- Enable GPU for better performance -->
  <vGPU>${enableGpu}</vGPU>

  <!-- Memory allocation -->
  <MemoryInMB>${memory}</MemoryInMB>

  <!-- Run setup script on logon -->
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\\OllieBot\\setup-vnc.ps1</Command>
  </LogonCommand>
</Configuration>
`;

    await fsPromises.writeFile(wsbPath, wsbConfig, 'utf-8');
  }

  /**
   * Launches Hyper-V VM.
   */
  private async launchHyperVVM(sessionId: string, config: SandboxConfig): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new Error('Hyper-V is only available on Windows');
    }

    const vmName = config.configPath || 'OllieBot-Desktop';

    // Check if VM exists and start it
    await execAsync(`powershell -Command "Start-VM -Name '${vmName}'"`);

    // Store reference (Hyper-V manages its own process)
    console.log(`[Desktop] Hyper-V VM '${vmName}' started`);
  }

  /**
   * Launches VirtualBox VM.
   */
  private async launchVirtualBoxVM(sessionId: string, config: SandboxConfig): Promise<void> {
    const vmName = config.configPath || 'OllieBot-Desktop';

    // Start VM headless
    const process = spawn('VBoxManage', ['startvm', vmName, '--type', 'headless'], {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    this.sandboxProcesses.set(sessionId, process);

    // Wait for VM to boot
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }

  /**
   * Launches Tart VM (macOS Apple Silicon).
   */
  private async launchTartVM(sessionId: string, config: SandboxConfig): Promise<void> {
    if (os.platform() !== 'darwin') {
      throw new Error('Tart is only available on macOS');
    }

    const vmName = config.configPath || 'olliebot-macos';

    // Start VM with VNC (--no-graphics enables VNC)
    const process = spawn('tart', ['run', '--no-graphics', vmName], {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    this.sandboxProcesses.set(sessionId, process);

    // Wait for VM to boot
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }

  /**
   * Stops a sandbox and cleans up resources.
   */
  private async stopSandbox(sessionId: string): Promise<void> {
    const process = this.sandboxProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    // Determine sandbox type (fall back to windows-sandbox if session already removed)
    const sandboxType = session?.getSession().sandbox.type || 'windows-sandbox';

    try {
      switch (sandboxType) {
        case 'windows-sandbox':
          // Windows Sandbox - try to close it gracefully
          if (process) {
            try { process.kill(); } catch { /* already dead */ }
          }
          // Also try to close via taskkill (more reliable)
          try {
            await execAsync('taskkill /IM WindowsSandbox.exe /F').catch(() => {});
            await execAsync('taskkill /IM WindowsSandboxClient.exe /F').catch(() => {});
          } catch {
            // Ignore - sandbox may already be closed
          }
          break;

        case 'hyperv':
          // Stop Hyper-V VM
          await execAsync(`powershell -Command "Stop-VM -Name 'OllieBot-Desktop' -Force"`);
          break;

        case 'virtualbox':
          // Power off VirtualBox VM
          await execAsync('VBoxManage controlvm OllieBot-Desktop poweroff');
          break;

        case 'tart':
          // Stop Tart VM
          if (process) {
            try { process.kill(); } catch { /* already dead */ }
          }
          await execAsync('tart stop olliebot-macos').catch(() => {
            // Ignore errors if VM is already stopped
          });
          break;
      }
    } catch (error) {
      console.warn(`[Desktop] Error stopping sandbox: ${error}`);
    }

    this.sandboxProcesses.delete(sessionId);

    // Clean up temp directory
    const tempDir = this.sessionTempDirs.get(sessionId);
    if (tempDir) {
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
        console.log(`[Desktop] Cleaned up temp directory: ${tempDir}`);
      } catch (error) {
        console.warn(`[Desktop] Failed to clean up temp directory: ${error}`);
      }
      this.sessionTempDirs.delete(sessionId);
    }
  }

  /**
   * Waits for VNC server to become available.
   */
  private async waitForVNC(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Session creation aborted');
      }

      try {
        // Try to connect to VNC port
        const net = await import('net');
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(port, host);
          socket.setTimeout(2000);

          socket.on('connect', () => {
            socket.end();
            resolve();
          });

          socket.on('error', reject);
          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Timeout'));
          });

          // Abort the socket if session is being closed
          signal?.addEventListener('abort', () => {
            socket.destroy();
            reject(new Error('Session creation aborted'));
          }, { once: true });
        });

        console.log(`[Desktop] VNC server available at ${host}:${port}`);
        return;
      } catch (err) {
        if (signal?.aborted) {
          throw new Error('Session creation aborted');
        }
        // Not ready yet, wait and retry
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Session creation aborted'));
          }, { once: true });
        }).catch(() => {
          throw new Error('Session creation aborted');
        });
      }
    }

    throw new Error(`VNC server not available after ${timeoutMs}ms`);
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Sets up event handlers for a session.
   */
  private setupSessionEventHandlers(session: DesktopSessionInstance): void {
    // Status changes
    session.on('status-changed', (status, error) => {
      this.broadcast(createSessionUpdatedEvent(session.id, { status, error }));
    });

    // Screenshots
    session.on('screenshot', (screenshot) => {
      this.broadcast(createScreenshotEvent(session.id, screenshot));
    });

    // Action events
    session.on('action-started', (actionId, action) => {
      this.broadcast(createActionStartedEvent(session.id, actionId, action));
    });

    session.on('action-completed', (actionId, action, result) => {
      this.broadcast(createActionCompletedEvent(session.id, actionId, action, result));

      // Also send screenshot update after action
      if (result.screenshot) {
        this.broadcast(createScreenshotEvent(session.id, result.screenshot));
      }
    });

    // Click markers
    session.on('click-marker', (marker) => {
      this.broadcast(createClickMarkerEvent(session.id, marker));
    });
  }

  /**
   * Broadcasts an event to WebChannel.
   */
  private broadcast(event: DesktopEvent): void {
    if (this.webChannel) {
      this.webChannel.broadcast(event);
    }
  }
}
