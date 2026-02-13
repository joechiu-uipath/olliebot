/**
 * Desktop Session Tool
 *
 * Native tool for creating and managing desktop sessions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types';
import type { DesktopSessionManager } from '../manager';
import type { SandboxType, DesktopPlatform, ComputerUseProvider } from '../types';

export class DesktopSessionTool implements NativeTool {
  readonly name = 'desktop_session';
  readonly description = `Create, list, resume, or close sandboxed desktop sessions for desktop application automation.

Actions:
- create: Create a new desktop session (launches a sandboxed environment with VNC)
- resume: Resume/connect to an existing VNC server without launching a sandbox (faster)
- list: List all active desktop sessions
- close: Close a specific session
- get: Get details of a specific session

When creating a session, you can specify:
- sandboxType: Type of sandbox (windows-sandbox, hyperv, virtualbox, tart)
- platform: Target platform (windows, macos, linux)
- provider: Computer Use provider for AI control (azure_openai, google, anthropic, openai)

When resuming, you can optionally specify:
- vncHost: IP address of the VNC server (auto-discovered if not provided)
- vncPort: VNC port (default: 5900)
- vncPassword: VNC password (default: olliebot)

If vncHost is not provided, the tool will:
1. Check existing session folders for connection.json files
2. Probe each known IP to find alive VNC servers
3. Scan the Hyper-V network (172.x.x.x) as a fallback

The session will launch a sandboxed desktop environment and connect via VNC for remote control.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'resume', 'list', 'close', 'get'],
        description: 'The action to perform',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID (required for close/get actions)',
      },
      name: {
        type: 'string',
        description: 'Session name (optional for create action)',
      },
      sandboxType: {
        type: 'string',
        enum: ['windows-sandbox', 'hyperv', 'virtualbox', 'tart'],
        description: 'Type of sandbox to use (default: windows-sandbox)',
      },
      platform: {
        type: 'string',
        enum: ['windows', 'macos', 'linux'],
        description: 'Target platform (default: windows)',
      },
      provider: {
        type: 'string',
        enum: ['azure_openai', 'google', 'anthropic', 'openai'],
        description: 'Computer Use provider for AI-driven control',
      },
      vncHost: {
        type: 'string',
        description: 'VNC host to connect to (default: localhost)',
      },
      vncPort: {
        type: 'number',
        description: 'VNC port to connect to (default: 5900)',
      },
      vncPassword: {
        type: 'string',
        description: 'VNC password (default: olliebot)',
      },
    },
    required: ['action'],
  };

  private desktopManager: DesktopSessionManager;

  constructor(desktopManager: DesktopSessionManager) {
    this.desktopManager = desktopManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const action = String(params.action);

    try {
      switch (action) {
        case 'create':
          return await this.createSession(params);

        case 'resume':
          return await this.resumeSession(params);

        case 'list':
          return await this.listSessions();

        case 'close':
          return await this.closeSession(params);

        case 'get':
          return await this.getSession(params);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createSession(params: Record<string, unknown>): Promise<NativeToolResult> {
    const name = params.name ? String(params.name) : undefined;
    const sandboxType = (params.sandboxType as SandboxType) || 'windows-sandbox';
    const platform = (params.platform as DesktopPlatform) || 'windows';
    const provider = params.provider as ComputerUseProvider | undefined;

    // Check if a session with this name already exists (any non-terminal status)
    if (name) {
      const existingSessions = this.desktopManager.getSessions();
      const terminalStatuses = new Set(['closed', 'error']);
      const existingSession = existingSessions.find(
        (s) => s.name === name && !terminalStatuses.has(s.status)
      );
      if (existingSession) {
        console.log(`[DesktopSessionTool] Reusing existing session "${name}" (${existingSession.id})`);
        return {
          success: true,
          output: {
            message: `Reusing existing desktop session: ${existingSession.id}`,
            session: {
              id: existingSession.id,
              name: existingSession.name,
              status: existingSession.status,
              sandboxType: existingSession.sandbox.type,
              platform: existingSession.sandbox.platform,
            },
          },
        };
      }
    }

    console.log(`[DesktopSessionTool] Creating new session (name: ${name || '(auto)'}, sandbox: ${sandboxType}, platform: ${platform})`);
    const t0 = Date.now();
    const session = await this.desktopManager.createSession({
      name,
      sandbox: {
        type: sandboxType,
        platform,
      },
      vnc: {
        host: params.vncHost ? String(params.vncHost) : 'localhost',
        port: params.vncPort ? Number(params.vncPort) : 5900,
        password: params.vncPassword ? String(params.vncPassword) : 'olliebot',
      },
      computerUseProvider: provider,
    });

    const durationMs = Date.now() - t0;
    console.log(`[DesktopSessionTool] Session created successfully: ${session.id} (${durationMs}ms)`);

    return {
      success: true,
      output: {
        message: `Desktop session created: ${session.id}`,
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          sandboxType: session.sandbox.type,
          platform: session.sandbox.platform,
          viewport: session.viewport,
        },
      },
    };
  }

  private async resumeSession(params: Record<string, unknown>): Promise<NativeToolResult> {
    const vncHost = params.vncHost ? String(params.vncHost) : undefined;
    const vncPort = params.vncPort ? Number(params.vncPort) : undefined;
    const vncPassword = params.vncPassword ? String(params.vncPassword) : undefined;
    const name = params.name ? String(params.name) : undefined;
    const provider = params.provider as ComputerUseProvider | undefined;

    if (vncHost) {
      console.log(`[DesktopSessionTool] Resuming session - connecting to VNC at ${vncHost}:${vncPort || 5900}`);
    } else {
      console.log(`[DesktopSessionTool] Resuming session - auto-discovering VNC server...`);
    }

    const t0 = Date.now();

    const session = await this.desktopManager.resumeSession({
      name,
      vncHost,
      vncPort,
      vncPassword,
      computerUseProvider: provider,
    });

    const durationMs = Date.now() - t0;
    console.log(`[DesktopSessionTool] Session resumed successfully: ${session.id} (${durationMs}ms)`);

    return {
      success: true,
      output: {
        message: `Desktop session resumed: ${session.id}`,
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          sandboxType: session.sandbox.type,
          platform: session.sandbox.platform,
          viewport: session.viewport,
        },
      },
    };
  }

  private async listSessions(): Promise<NativeToolResult> {
    const sessions = this.desktopManager.getSessions();

    return {
      success: true,
      output: {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          sandboxType: s.sandbox.type,
          platform: s.sandbox.platform,
          viewport: s.viewport,
        })),
      },
    };
  }

  private async closeSession(params: Record<string, unknown>): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;

    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for close action',
      };
    }

    await this.desktopManager.closeSession(sessionId);

    return {
      success: true,
      output: {
        message: `Desktop session closed: ${sessionId}`,
      },
    };
  }

  private async getSession(params: Record<string, unknown>): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;

    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for get action',
      };
    }

    const session = this.desktopManager.getSession(sessionId);

    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    return {
      success: true,
      output: {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          sandbox: session.sandbox,
          vnc: session.vnc,
          viewport: session.viewport,
          createdAt: session.createdAt,
          error: session.error,
        },
      },
    };
  }
}
