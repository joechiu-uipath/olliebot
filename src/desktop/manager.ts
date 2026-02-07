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
 * Path where the host temp folder is mapped inside Windows Sandbox.
 * Must be under the sandbox user profile
 * are not reliably created by MappedFolders on all Windows builds.
 */
const SANDBOX_MAPPED_DIR = 'C:\\Users\\WDAGUtilityAccount\\Desktop\\OllieBot';

/**
 * Parent folder for all desktop session temp directories.
 * Structure: %TEMP%\olliebot-desktop\{sessionId}\
 * This makes it easy to enumerate all sessions and find existing connections.
 */
const DESKTOP_SESSIONS_PARENT = 'olliebot-desktop';

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
const DEFAULT_CONFIG = {
  defaultSandbox: {
    type: 'windows-sandbox' as const,
    platform: 'windows' as const,
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
  // Sandbox Detection
  // ===========================================================================

  /**
   * Checks if Windows Sandbox is currently running.
   */
  private async isWindowsSandboxRunning(): Promise<boolean> {
    if (os.platform() !== 'win32') return false;

    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process WindowsSandbox -ErrorAction SilentlyContinue | Select-Object -First 1"'
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Finds an existing temp directory with a valid connection.json.
   * Returns the temp dir path and the sandbox IP, or null if not found.
   *
   * Structure: %TEMP%\olliebot-desktop\{sessionId}\connection.json
   */
  private async findExistingSandboxConnection(): Promise<{ tempDir: string; ip: string; port: number; sessionId: string } | null> {
    try {
      // Resolve tmpdir to long path (os.tmpdir() returns 8.3 short names)
      const longTmpDir = fs.realpathSync.native(os.tmpdir());
      const parentDir = path.join(longTmpDir, DESKTOP_SESSIONS_PARENT);

      // Check if parent folder exists
      try {
        const stat = await fsPromises.stat(parentDir);
        if (!stat.isDirectory()) return null;
      } catch {
        // Parent folder doesn't exist yet
        return null;
      }

      // Enumerate session subdirectories
      const sessionDirs = await fsPromises.readdir(parentDir);

      for (const sessionId of sessionDirs) {
        const tempDir = path.join(parentDir, sessionId);
        const connectionFile = path.join(tempDir, 'connection.json');

        try {
          const stat = await fsPromises.stat(tempDir);
          if (!stat.isDirectory()) continue;

          const raw = await fsPromises.readFile(connectionFile, 'utf-8');
          const content = raw.replace(/^\uFEFF/, ''); // Strip BOM
          const data = JSON.parse(content);

          if (data.ip && typeof data.ip === 'string') {
            console.log(`[Desktop] Found existing connection.json in ${DESKTOP_SESSIONS_PARENT}/${sessionId}: ip=${data.ip}, port=${data.port || 5900}`);
            return {
              tempDir,
              ip: data.ip,
              port: data.port || 5900,
              sessionId,
            };
          }
        } catch {
          // This directory doesn't have a valid connection.json, continue
        }
      }
    } catch (err) {
      console.warn(`[Desktop] Error searching for existing sandbox connection: ${err}`);
    }

    return null;
  }

  /**
   * Lists all session directories in the olliebot-desktop parent folder.
   * Useful for debugging and understanding what sessions exist on disk.
   */
  async listSessionDirectories(): Promise<Array<{ sessionId: string; hasConnection: boolean; ip?: string; port?: number }>> {
    const results: Array<{ sessionId: string; hasConnection: boolean; ip?: string; port?: number }> = [];

    try {
      const longTmpDir = fs.realpathSync.native(os.tmpdir());
      const parentDir = path.join(longTmpDir, DESKTOP_SESSIONS_PARENT);

      try {
        const stat = await fsPromises.stat(parentDir);
        if (!stat.isDirectory()) return results;
      } catch {
        return results; // Parent doesn't exist
      }

      const sessionDirs = await fsPromises.readdir(parentDir);

      for (const sessionId of sessionDirs) {
        const tempDir = path.join(parentDir, sessionId);
        const connectionFile = path.join(tempDir, 'connection.json');

        try {
          const stat = await fsPromises.stat(tempDir);
          if (!stat.isDirectory()) continue;

          try {
            const raw = await fsPromises.readFile(connectionFile, 'utf-8');
            const content = raw.replace(/^\uFEFF/, '');
            const data = JSON.parse(content);
            results.push({
              sessionId,
              hasConnection: true,
              ip: data.ip,
              port: data.port || 5900,
            });
          } catch {
            results.push({ sessionId, hasConnection: false });
          }
        } catch {
          // Not a directory, skip
        }
      }
    } catch (err) {
      console.warn(`[Desktop] Error listing session directories: ${err}`);
    }

    return results;
  }

  /**
   * Finds an alive VNC server by probing all known session connections.
   * Returns the first server that responds on its VNC port.
   */
  private async findAliveVNCServer(): Promise<{ ip: string; port: number; sessionId: string } | null> {
    const sessions = await this.listSessionDirectories();

    if (sessions.length === 0) {
      console.log('[Desktop] No session directories found');
      return null;
    }

    console.log(`[Desktop] Found ${sessions.length} session directories, probing VNC ports...`);

    const net = await import('net');

    for (const session of sessions) {
      if (!session.hasConnection || !session.ip) continue;

      const { ip, port, sessionId } = session;
      console.log(`[Desktop] Probing VNC at ${ip}:${port} (session: ${sessionId})...`);

      try {
        // Quick TCP probe with 3 second timeout
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(port!, ip);
          socket.setTimeout(3000);

          socket.on('connect', () => {
            socket.end();
            resolve();
          });

          socket.on('error', (err) => {
            socket.destroy();
            reject(err);
          });

          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('timeout'));
          });
        });

        console.log(`[Desktop] VNC server alive at ${ip}:${port}`);
        return { ip, port: port!, sessionId };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code || (err instanceof Error ? err.message : 'unknown');
        console.log(`[Desktop] VNC at ${ip}:${port} not responding: ${code}`);
      }
    }

    // No session folders have alive VNC, try ARP table as fallback
    console.log('[Desktop] No alive VNC in session folders, scanning Hyper-V network...');
    return await this.scanHyperVNetworkForVNC();
  }

  /**
   * Scans the Hyper-V network (172.x.x.x) for VNC servers as a fallback.
   * This handles cases where the sandbox was started manually or session folders were cleaned up.
   */
  private async scanHyperVNetworkForVNC(): Promise<{ ip: string; port: number; sessionId: string } | null> {
    if (os.platform() !== 'win32') return null;

    try {
      // Get ARP table entries for 172.x.x.x (Hyper-V range)
      const { stdout } = await execAsync('arp -a');
      const lines = stdout.split('\n');
      const hyperVIPs: string[] = [];

      for (const line of lines) {
        const match = line.match(/\b(172\.\d+\.\d+\.\d+)\b/);
        if (match) {
          hyperVIPs.push(match[1]);
        }
      }

      if (hyperVIPs.length === 0) {
        console.log('[Desktop] No Hyper-V IPs found in ARP table');
        return null;
      }

      console.log(`[Desktop] Found ${hyperVIPs.length} Hyper-V IPs, probing port 5900...`);

      const net = await import('net');

      for (const ip of hyperVIPs) {
        try {
          await new Promise<void>((resolve, reject) => {
            const socket = net.createConnection(5900, ip);
            socket.setTimeout(2000);

            socket.on('connect', () => {
              socket.end();
              resolve();
            });

            socket.on('error', reject);
            socket.on('timeout', () => reject(new Error('timeout')));
          });

          console.log(`[Desktop] Found VNC server at ${ip}:5900`);
          return { ip, port: 5900, sessionId: 'discovered' };
        } catch {
          // Not a VNC server, continue
        }
      }
    } catch (err) {
      console.warn(`[Desktop] ARP scan failed: ${err}`);
    }

    return null;
  }

  /**
   * Stops all running Windows Sandbox instances.
   */
  private async stopAllWindowsSandboxes(): Promise<void> {
    console.log('[Desktop] Stopping all Windows Sandbox instances...');
    for (const img of ['WindowsSandbox.exe', 'WindowsSandboxClient.exe']) {
      try {
        await execAsync(`taskkill /IM ${img} /F`);
      } catch {
        // Process wasn't running — that's fine
      }
    }
    // Wait a moment for processes to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * Launches sandbox and discovers its IP address.
   * This is the "fresh launch" path when no sandbox is running.
   */
  private async launchAndDiscoverSandbox(
    session: DesktopSessionInstance,
    sandboxConfig: SandboxConfig,
    vncConfig: VNCConfig,
    abortController: AbortController,
    t0: number
  ): Promise<void> {
    const tag = `[Desktop] [${session.id.slice(0, 8)}]`;

    // Launch sandbox
    await this.launchSandbox(session.id, sandboxConfig, abortController.signal);
    console.log(`${tag} Step 1/4: Sandbox launched (${Date.now() - t0}ms)`);

    // Check if aborted during sandbox launch
    if (abortController.signal.aborted) {
      throw new Error('Session creation aborted');
    }

    // Update sandbox status
    session.updateSandbox({ status: 'running', startedAt: new Date() });
    this.broadcast(createSessionUpdatedEvent(session.id, { sandbox: session.getSession().sandbox }));

    // Discover sandbox IP from connection.json written by setup-vnc.ps1.
    const t1 = Date.now();
    console.log(`${tag} Step 2/4: Discovering sandbox IP from connection.json...`);

    const sandboxHost = await this.discoverSandboxIP(session.id, 600000, abortController.signal);
    vncConfig.host = sandboxHost;
    console.log(`${tag} Step 2/4: Sandbox IP discovered: ${sandboxHost} (${Date.now() - t1}ms)`);
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

  /**
   * Resumes/connects to an existing VNC server without launching a sandbox.
   * This is faster than createSession when a sandbox is already running.
   *
   * If vncHost is not provided, auto-discovers by probing session folders.
   */
  async resumeSession(config: {
    name?: string;
    vncHost?: string;
    vncPort?: number;
    vncPassword?: string;
    computerUseProvider?: import('./types').ComputerUseProvider;
  }): Promise<DesktopSession> {
    const t0 = Date.now();
    const tag = `[Desktop] [resume]`;

    let vncHost = config.vncHost;
    let vncPort = config.vncPort || 5900;

    // Auto-discover VNC server if host not provided
    if (!vncHost) {
      console.log(`${tag} No vncHost provided, auto-discovering from session folders...`);
      const aliveServer = await this.findAliveVNCServer();
      if (!aliveServer) {
        throw new Error('No alive VNC server found. Ensure Windows Sandbox is running with VNC enabled.');
      }
      vncHost = aliveServer.ip;
      vncPort = aliveServer.port;
      console.log(`${tag} Auto-discovered VNC server at ${vncHost}:${vncPort}`);
    }

    // Create VNC config
    const vncConfig: VNCConfig = {
      host: vncHost,
      port: vncPort,
      password: config.vncPassword || 'olliebot',
      connectTimeout: 30000,
    };

    // Create minimal sandbox info (not launching, just tracking)
    const sandboxInfo: SandboxInfo = {
      type: 'windows-sandbox',
      platform: 'windows',
      status: 'running', // Already running
      vncPort: vncConfig.port,
    };

    // Create session config
    const sessionConfig: DesktopSessionConfig = {
      name: config.name,
      sandbox: { type: 'windows-sandbox', platform: 'windows' },
      vnc: vncConfig,
      computerUseProvider: config.computerUseProvider,
    };

    // Create session instance
    const session = new DesktopSessionInstance(sessionConfig, sandboxInfo);

    // Wire up event handlers
    this.setupSessionEventHandlers(session);

    // Store session
    this.sessions.set(session.id, session);

    // Broadcast session created
    this.broadcast(createSessionCreatedEvent(session.getSession()));

    console.log(`${tag} Connecting to VNC at ${vncConfig.host}:${vncConfig.port}...`);

    try {
      // Connect to VNC (no sandbox launch, direct connection)
      await session.initialize(vncConfig);
      console.log(`${tag} VNC connected (${Date.now() - t0}ms)`);

      // Set up Computer Use provider if configured
      if (config.computerUseProvider) {
        const provider = createComputerUseProvider(config.computerUseProvider as ComputerUseProvider);
        if (provider) {
          session.setComputerUseProvider(provider);
          console.log(`${tag} Computer Use provider set: ${config.computerUseProvider}`);
        }
      }

      console.log(`${tag} Session ready! Total time: ${Date.now() - t0}ms`);
      return session.getSession();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${tag} Failed to connect: ${errorMessage}`);

      session.updateSandbox({ status: 'error', error: errorMessage });
      this.broadcast(createSessionUpdatedEvent(session.id, {
        status: 'error',
        error: errorMessage,
        sandbox: session.getSession().sandbox,
      }));

      throw error;
    }
  }

  private async _doCreateSession(config: DesktopSessionConfig): Promise<DesktopSession> {
    // Merge with defaults
    const sandboxConfig: SandboxConfig = {
      ...DEFAULT_CONFIG.defaultSandbox,
      ...this.config.defaultSandbox,
      ...config.sandbox,
    };

    const vncConfig: VNCConfig = {
      host: DEFAULT_CONFIG.defaultVnc.host,
      port: DEFAULT_CONFIG.defaultVnc.port,
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
      const t0 = Date.now();
      const tag = `[Desktop] [${session.id.slice(0, 8)}]`;
      let sandboxHost: string;

      // Check if Windows Sandbox is already running with a valid connection
      const sandboxRunning = sandboxConfig.type === 'windows-sandbox' && await this.isWindowsSandboxRunning();

      if (sandboxRunning) {
        console.log(`${tag} Step 1/4: Windows Sandbox is already running, checking for existing connection...`);
        const existingConnection = await this.findExistingSandboxConnection();

        if (existingConnection) {
          console.log(`${tag} Step 1/4: Reusing existing sandbox (ip=${existingConnection.ip}, port=${existingConnection.port})`);
          // Reuse the existing temp directory
          this.sessionTempDirs.set(session.id, existingConnection.tempDir);
          sandboxHost = existingConnection.ip;
          vncConfig.host = sandboxHost;
          vncConfig.port = existingConnection.port;

          // Update sandbox status
          session.updateSandbox({ status: 'running', startedAt: new Date() });
          this.broadcast(createSessionUpdatedEvent(session.id, { sandbox: session.getSession().sandbox }));

          console.log(`${tag} Step 1/4: Skipped sandbox launch — reusing existing (${Date.now() - t0}ms)`);
        } else {
          console.log(`${tag} Step 1/4: Sandbox running but no valid connection.json found, launching fresh sandbox...`);
          // Stop the existing sandbox and launch a new one
          await this.stopAllWindowsSandboxes();
          await this.launchAndDiscoverSandbox(session, sandboxConfig, vncConfig, abortController, t0);
        }
      } else {
        // No sandbox running — launch a new one
        console.log(`${tag} Step 1/4: Launching sandbox...`);
        await this.launchAndDiscoverSandbox(session, sandboxConfig, vncConfig, abortController, t0);
      }

      // Check if aborted
      if (abortController.signal.aborted) {
        throw new Error('Session creation aborted');
      }

      // Wait for VNC port to become reachable on the sandbox IP
      const tVncProbe = Date.now();
      console.log(`${tag} Step 2/4: Probing VNC at ${vncConfig.host}:${vncConfig.port}...`);
      await this.waitForVNC(vncConfig.host, vncConfig.port, 60000, abortController.signal);
      console.log(`${tag} Step 2/4: VNC port is open (${Date.now() - tVncProbe}ms)`);

      // Initialize VNC connection (rfb2 auth + framebuffer).
      // TightVNC may accept TCP connections before the RFB protocol is ready,
      // so retry the full rfb2 handshake a few times.
      const t2 = Date.now();
      const maxVncRetries = 30;
      const vncRetryDelayMs = 5000;
      for (let vncAttempt = 1; ; vncAttempt++) {
        if (abortController.signal.aborted) throw new Error('Session creation aborted');
        console.log(`${tag} Step 3/4: VNC client connect attempt ${vncAttempt}/${maxVncRetries} to ${vncConfig.host}:${vncConfig.port}...`);
        try {
          await session.initialize(vncConfig, abortController.signal);
          break; // success
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (abortController.signal.aborted) throw err;
          if (vncAttempt >= maxVncRetries) {
            console.error(`${tag} Step 3/4: All ${maxVncRetries} VNC connect attempts failed. Last error: ${msg}`);
            throw err;
          }
          console.warn(`${tag} Step 3/4: VNC connect attempt ${vncAttempt} failed: ${msg}. Retrying in ${vncRetryDelayMs / 1000}s...`);
          // Reset session state so initialize() can be called again
          await session.resetForRetry();
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => { clearTimeout(timer); reject(new Error('Session creation aborted')); };
            const timer = setTimeout(() => {
              abortController.signal.removeEventListener('abort', onAbort);
              resolve();
            }, vncRetryDelayMs);
            abortController.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
      }
      console.log(`${tag} Step 3/4: VNC client connected (${Date.now() - t2}ms)`);

      // Set up Computer Use provider if configured
      console.log(`[Desktop] [${session.id.slice(0, 8)}] Step 4/4: Configuring Computer Use provider...`);
      if (config.computerUseProvider) {
        const provider = createComputerUseProvider(config.computerUseProvider as ComputerUseProvider);
        if (provider.isAvailable()) {
          session.setComputerUseProvider(provider);
          console.log(`[Desktop] [${session.id.slice(0, 8)}] Computer Use provider set: ${config.computerUseProvider}`);
        } else {
          console.warn(`[Desktop] [${session.id.slice(0, 8)}] Computer Use provider not available: ${config.computerUseProvider}`);
        }
      } else {
        console.log(`[Desktop] [${session.id.slice(0, 8)}] No Computer Use provider requested`);
      }

      const totalMs = Date.now() - t0;
      console.log(`[Desktop] [${session.id.slice(0, 8)}] Session ready! Total setup time: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);
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
    const tag = `[Desktop] [close ${sessionId.slice(0, 8)}]`;
    console.log(`${tag} closeSession() called`);

    // Abort any in-progress provisioning (waitForVNC, sandbox launch wait, etc.)
    const abortController = this.sessionAbortControllers.get(sessionId);
    if (abortController) {
      console.log(`${tag} Aborting in-progress provisioning (create tool should unblock now)`);
      abortController.abort();
      this.sessionAbortControllers.delete(sessionId);
    } else {
      console.log(`${tag} No abort controller — session was not mid-provisioning`);
    }

    const session = this.sessions.get(sessionId);
    const sessionStatus = session?.getSession().status;

    // Close the session (VNC disconnect, etc.) - if it was ever initialized
    // Use a timeout so a hung VNC connection doesn't block the force-kill below
    if (session) {
      console.log(`${tag} Closing session instance (status: ${sessionStatus}, VNC disconnect, 5s timeout)...`);
      try {
        await Promise.race([
          session.close(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Session close timed out')), 5000)
          ),
        ]);
        console.log(`${tag} Session instance closed`);
      } catch (error) {
        console.warn(`${tag} Error closing session instance: ${error}`);
      }
    } else {
      console.log(`${tag} No session instance found (may have been removed already)`);
    }

    // Only kill Windows Sandbox if session was active/busy (actually using the sandbox).
    // Don't kill sandbox for error/closed sessions - another session might be using it.
    const shouldKillSandbox = sessionStatus === 'active' || sessionStatus === 'busy';
    if (shouldKillSandbox) {
      console.log(`${tag} Stopping sandbox (session was ${sessionStatus})...`);
      await this.stopSandbox(sessionId);
    } else {
      console.log(`${tag} Skipping sandbox kill (session status: ${sessionStatus}) - sandbox may be used by other sessions`);
      // Still clean up the temp directory for this session
      const tempDir = this.sessionTempDirs.get(sessionId);
      if (tempDir) {
        try {
          await fsPromises.rm(tempDir, { recursive: true, force: true });
          console.log(`${tag} Cleaned up temp directory: ${tempDir}`);
        } catch (error) {
          console.warn(`${tag} Failed to clean up temp directory: ${error}`);
        }
        this.sessionTempDirs.delete(sessionId);
      }
    }

    // Remove from sessions
    this.sessions.delete(sessionId);

    // Broadcast closed event so the UI knows
    this.broadcast(createSessionClosedEvent(sessionId));

    console.log(`${tag} Session fully closed and cleaned up`);
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

    // Resolve tmpdir to long path (os.tmpdir() returns 8.3 short names like JOE~1.CHI
    // which Windows Sandbox MappedFolders cannot resolve)
    const longTmpDir = fs.realpathSync.native(os.tmpdir());

    // Create temp directory for this session: %TEMP%\olliebot-desktop\{sessionId}\
    const parentDir = path.join(longTmpDir, DESKTOP_SESSIONS_PARENT);
    const tempDir = path.join(parentDir, sessionId);
    await fsPromises.mkdir(tempDir, { recursive: true });
    this.sessionTempDirs.set(sessionId, tempDir);

    console.log(`[Desktop] Created temp directory: ${tempDir}`);

    // Copy the VNC setup script from the project sandbox/ directory
    const sourceScript = path.join(this.sandboxConfigPath, 'setup-vnc.ps1');
    const destScript = path.join(tempDir, 'setup-vnc.ps1');

    if (fs.existsSync(sourceScript)) {
      await fsPromises.copyFile(sourceScript, destScript);
      console.log(`[Desktop] Copied setup script from: ${sourceScript}`);
    } else {
      // Fallback: generate a basic VNC setup script if source not found
      console.warn(`[Desktop] Source script not found at ${sourceScript}, generating inline`);
      await this.generateVNCSetupScript(destScript, config);
    }

    // Generate the .wsb config file (dynamic — uses the session's tempDir as HostFolder)
    const wsbPath = path.join(tempDir, 'sandbox.wsb');
    await this.generateWindowsSandboxConfig(wsbPath, tempDir, config);

    console.log(`[Desktop] Generated sandbox config: ${wsbPath}`);

    // Log the .wsb content for debugging
    const wsbContent = await fsPromises.readFile(wsbPath, 'utf-8');
    console.log(`[Desktop] WSB config content:\n${wsbContent}`);

    // Launch Windows Sandbox with the .wsb config
    console.log(`[Desktop] Launching: WindowsSandbox.exe "${wsbPath}"`);
    const sandboxProcess = spawn('WindowsSandbox.exe', [wsbPath], {
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
$LogFile = "${SANDBOX_MAPPED_DIR}\\setup.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append -Force
    Write-Host $Message
}

# Create log directory
New-Item -ItemType Directory -Force -Path "${SANDBOX_MAPPED_DIR}" | Out-Null
Write-Log "Starting OllieBot Desktop Sandbox setup..."

# Create working directory
$WorkDir = "${SANDBOX_MAPPED_DIR}\\temp"
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
$readyFile = "${SANDBOX_MAPPED_DIR}\\ready.json"
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
      <SandboxFolder>${SANDBOX_MAPPED_DIR}</SandboxFolder>
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
    <Command>powershell.exe -ExecutionPolicy Bypass -File ${SANDBOX_MAPPED_DIR}\\setup-vnc.ps1</Command>
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
          // Kill the spawned launcher process
          if (process) {
            try { process.kill(); } catch { /* already dead */ }
          }
          // Force-kill all Windows Sandbox processes (taskkill is the reliable way)
          for (const img of ['WindowsSandbox.exe', 'WindowsSandboxClient.exe']) {
            try {
              const { stdout } = await execAsync(`taskkill /IM ${img} /F`);
              console.log(`[Desktop] taskkill ${img}: ${stdout.trim()}`);
            } catch {
              // Process wasn't running — that's fine
            }
          }
          // Last resort: PowerShell Stop-Process (catches renamed / wrapped processes)
          try {
            await execAsync(
              'powershell -NoProfile -Command "Get-Process WindowsSandbox*,WindowsSandboxClient* -ErrorAction SilentlyContinue | Stop-Process -Force"'
            );
          } catch {
            // Ignore
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
    let attempt = 0;
    const net = await import('net');

    // Helper: abort-aware sleep that doesn't leak listeners
    const abortableSleep = (ms: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Session creation aborted'));
        const onAbort = () => { clearTimeout(timer); reject(new Error('Session creation aborted')); };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    };

    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Session creation aborted');
      }

      attempt++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      try {
        // Try to connect to VNC port
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(port, host);
          socket.setTimeout(3000);
          let settled = false;

          const settle = (fn: () => void) => {
            if (!settled) { settled = true; fn(); }
          };

          socket.on('connect', () => {
            socket.end();
            settle(() => resolve());
          });

          socket.on('error', (err) => {
            socket.destroy();
            settle(() => reject(err));
          });

          socket.on('timeout', () => {
            socket.destroy();
            settle(() => reject(new Error('Socket timeout')));
          });

          // Abort the socket if session is being closed
          const onAbort = () => {
            socket.destroy();
            settle(() => reject(new Error('Session creation aborted')));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          // Clean up abort listener once socket settles
          socket.on('close', () => { signal?.removeEventListener('abort', onAbort); });
        });

        console.log(`[Desktop] VNC server available at ${host}:${port} (attempt ${attempt}, ${elapsed}s elapsed)`);
        return;
      } catch (err) {
        if (signal?.aborted) {
          throw new Error('Session creation aborted');
        }
        // Node socket errors have .code (ECONNREFUSED, ETIMEDOUT, etc.) which is often more useful than .message
        const errCode = (err as NodeJS.ErrnoException).code;
        const errMsg = errCode || (err instanceof Error ? err.message : String(err)) || 'unknown error';
        // Log every attempt so progress is visible; use shorter messages after the first few
        if (attempt <= 5 || attempt % 5 === 0) {
          console.log(`[Desktop] VNC probe #${attempt} to ${host}:${port} failed: ${errMsg} (${elapsed}s elapsed)`);
        } else if (attempt === 6) {
          console.log(`[Desktop] VNC probe #${attempt} failed: ${errMsg} (will log every 5th attempt from now)...`);
        }

        // Wait before retrying
        try {
          await abortableSleep(2000);
        } catch {
          throw new Error('Session creation aborted');
        }
      }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    throw new Error(`VNC server not available after ${attempt} attempts (${totalElapsed}s). Check that the sandbox is running and VNC is listening on ${host}:${port}`);
  }

  /**
   * Discovers the sandbox's IP address by polling for connection.json
   * written by setup-vnc.ps1 in the shared mapped folder.
   *
   * Windows Sandbox runs behind Hyper-V NAT so localhost won't work.
   * The setup script inside the sandbox writes its 172.x.x.x IP to this file.
   */
  private async discoverSandboxIP(sessionId: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const tempDir = this.sessionTempDirs.get(sessionId);
    if (!tempDir) {
      throw new Error('Session temp directory not found — cannot discover sandbox IP');
    }

    const connectionFile = path.join(tempDir, 'connection.json');
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Session creation aborted');
      }

      attempt++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      try {
        const raw = await fsPromises.readFile(connectionFile, 'utf-8');
        // PowerShell Out-File -Encoding UTF8 writes a BOM (\uFEFF) that JSON.parse rejects
        const content = raw.replace(/^\uFEFF/, '');
        const data = JSON.parse(content);

        if (data.ip) {
          console.log(`[Desktop] Sandbox IP discovered from connection.json: ${data.ip} (attempt ${attempt}, ${elapsed}s elapsed)`);
          return data.ip;
        }

        // File exists but no IP — sandbox script may not have detected it
        console.warn(`[Desktop] connection.json found but ip is null/empty (attempt ${attempt}, ${elapsed}s). Retrying...`);
      } catch (err) {
        // File doesn't exist yet — sandbox is still setting up
        if (attempt <= 3 || attempt % 10 === 0) {
          const code = (err as NodeJS.ErrnoException).code;
          console.log(`[Desktop] Waiting for connection.json (attempt ${attempt}, ${elapsed}s): ${code || err}`);
        }
      }

      // Wait before retrying
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Session creation aborted'));
        const onAbort = () => { clearTimeout(timer); reject(new Error('Session creation aborted')); };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, 2000);
        signal?.addEventListener('abort', onAbort, { once: true });
      }).catch(() => {
        throw new Error('Session creation aborted');
      });
    }

    throw new Error(
      `Could not discover sandbox IP after ${((Date.now() - startTime) / 1000).toFixed(1)}s. ` +
      `File not found: ${connectionFile}. Ensure setup-vnc.ps1 writes connection.json.`
    );
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Sets up event handlers for a session.
   */
  private setupSessionEventHandlers(session: DesktopSessionInstance): void {
    // Error handler — MUST be registered to prevent Node.js EventEmitter from
    // crashing the process on unhandled 'error' events (e.g. rfb2 "write after end").
    // The error is already logged by session.ts; here we just absorb it so the
    // retry loop in _doCreateSession can handle it gracefully.
    session.on('error', (error) => {
      console.error(`[Desktop] Session ${session.id} error event: ${error.message}`);
    });

    // Status changes
    session.on('status-changed', (status, error) => {
      // Include viewport when session becomes active (VNC just connected)
      const updates: Partial<DesktopSession> = { status, error };
      if (status === 'active') {
        const sessionState = session.getSession();
        updates.viewport = sessionState.viewport;
        updates.vnc = sessionState.vnc;
      }
      this.broadcast(createSessionUpdatedEvent(session.id, updates));
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
