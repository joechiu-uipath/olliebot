/**
 * Desktop Session Manager
 *
 * Manages sandboxed desktop sessions with VNC control.
 * Similar to BrowserSessionManager but for desktop environments.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
import { createProvider } from '../browser/strategies/computer-use/providers/index';
import type { ComputerUseProvider } from '../browser/strategies/computer-use/providers/types';

const execAsync = promisify(exec);

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
  private webChannel?: IBroadcaster;
  private config: DesktopSessionManagerConfig;
  private sandboxConfigPath: string;

  constructor(config: DesktopSessionManagerConfig = {}) {
    this.config = config;
    this.webChannel = config.webChannel;
    this.sandboxConfigPath = config.sandboxConfigPath || path.join(__dirname, '../../sandbox');
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Creates a new desktop session.
   */
  async createSession(config: DesktopSessionConfig): Promise<DesktopSession> {
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

    // Broadcast session created (in provisioning state)
    this.broadcast(createSessionCreatedEvent(session.getSession()));

    try {
      // Launch sandbox
      console.log(`[Desktop] Launching sandbox for session ${session.id}...`);
      await this.launchSandbox(session.id, sandboxConfig);

      // Update sandbox status
      session.updateSandbox({ status: 'running', startedAt: new Date() });
      this.broadcast(createSessionUpdatedEvent(session.id, { sandbox: session.getSession().sandbox }));

      // Wait for VNC to become available
      console.log(`[Desktop] Waiting for VNC server on port ${vncConfig.port}...`);
      await this.waitForVNC(vncConfig.host, vncConfig.port, 60000);

      // Initialize VNC connection
      console.log(`[Desktop] Connecting to VNC...`);
      await session.initialize(vncConfig);

      // Set up Computer Use provider if configured
      if (config.computerUseProvider) {
        const provider = createProvider(config.computerUseProvider as ComputerUseProvider);
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
      // Clean up on failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      session.updateSandbox({ status: 'error', error: errorMessage });
      this.broadcast(createSessionUpdatedEvent(session.id, {
        status: 'error',
        error: errorMessage,
        sandbox: session.getSession().sandbox,
      }));

      throw error;
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[Desktop] Session not found: ${sessionId}`);
      return;
    }

    // Close the session (VNC disconnect, etc.)
    await session.close();

    // Stop the sandbox
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
  private async launchSandbox(sessionId: string, config: SandboxConfig): Promise<void> {
    switch (config.type) {
      case 'windows-sandbox':
        await this.launchWindowsSandbox(sessionId, config);
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
   * Launches Windows Sandbox.
   */
  private async launchWindowsSandbox(sessionId: string, config: SandboxConfig): Promise<void> {
    // Check if Windows Sandbox is available
    if (os.platform() !== 'win32') {
      throw new Error('Windows Sandbox is only available on Windows');
    }

    // Path to .wsb config file
    const wsbPath = config.configPath || path.join(this.sandboxConfigPath, 'desktop-sandbox.wsb');

    if (!fs.existsSync(wsbPath)) {
      throw new Error(`Sandbox config not found: ${wsbPath}`);
    }

    // Launch Windows Sandbox
    const process = spawn('WindowsSandbox.exe', [wsbPath], {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    this.sandboxProcesses.set(sessionId, process);

    // Windows Sandbox takes time to start
    await new Promise((resolve) => setTimeout(resolve, 15000));
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
   * Stops a sandbox.
   */
  private async stopSandbox(sessionId: string): Promise<void> {
    const process = this.sandboxProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!session) return;

    const sandboxType = session.getSession().sandbox.type;

    try {
      switch (sandboxType) {
        case 'windows-sandbox':
          // Windows Sandbox closes when the window is closed
          // Try to terminate the process
          if (process) {
            process.kill();
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
            process.kill();
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
  }

  /**
   * Waits for VNC server to become available.
   */
  private async waitForVNC(host: string, port: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
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
        });

        console.log(`[Desktop] VNC server available at ${host}:${port}`);
        return;
      } catch {
        // Not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
