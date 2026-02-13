import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import { setupVoiceProxy } from './voice-proxy.js';
import type { SupervisorAgent } from '../agents/types.js';
import { getAgentRegistry, MissionLeadAgent } from '../agents/index.js';
import { WebSocketChannel } from '../channels/index.js';
import { getDb } from '../db/index.js';
import { isWellKnownConversation, getWellKnownConversationMeta, WellKnownConversations } from '../db/well-known-conversations.js';
import type { MCPClient } from '../mcp/index.js';
import type { SkillManager } from '../skills/index.js';
import type { ToolRunner } from '../tools/index.js';
import type { LLMService } from '../llm/service.js';
import { getModelCapabilities } from '../llm/model-capabilities.js';
import { setupEvalRoutes } from './eval-routes.js';
import type { BrowserSessionManager } from '../browser/index.js';
import type { DesktopSessionManager } from '../desktop/index.js';
import type { TaskManager } from '../tasks/index.js';
import { type RAGProjectService, createRAGProjectRoutes, type IndexingProgress } from '../rag-projects/index.js';
import type { MissionManager } from '../missions/index.js';
import { setupMissionRoutes } from './mission-routes.js';
import { getMessageEventService, setMessageEventServiceChannel } from '../services/message-event-service.js';
import { getUserSettingsService } from '../settings/index.js';
import { OllieBotMCPServer } from '../mcp-server/index.js';
import type { LogBuffer } from '../mcp-server/index.js';
import type { TraceStore } from '../tracing/trace-store.js';

export interface ServerConfig {
  port: number;
  supervisor: SupervisorAgent;
  mcpClient?: MCPClient;
  skillManager?: SkillManager;
  toolRunner?: ToolRunner;
  llmService?: LLMService;
  browserManager?: BrowserSessionManager;
  desktopManager?: DesktopSessionManager;
  taskManager?: TaskManager;
  missionManager?: MissionManager;
  ragProjectService?: RAGProjectService;
  traceStore?: TraceStore;
  // LLM configuration for model capabilities endpoint
  mainProvider?: string;
  mainModel?: string;
  // Voice-to-Text configuration
  voiceProvider?: 'openai' | 'azure_openai';
  voiceModel?: string;
  // Azure OpenAI config (needed for voice proxy)
  azureOpenaiApiKey?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiVersion?: string;
  // OpenAI config (needed for voice proxy)
  openaiApiKey?: string;
  // Security: Network binding (default: localhost only)
  bindAddress?: string;
  // Security: Allowed CORS origins (default: localhost dev servers)
  allowedOrigins?: string[];
  // MCP Server (OllieBot as MCP server)
  mcpServerEnabled?: boolean;
  mcpServerSecret?: string;
  mcpServerAuthDisabled?: boolean;
  logBuffer?: LogBuffer;
  fastProvider?: string;
  fastModel?: string;
}

export class AssistantServer {
  private app: Express;
  private server: Server;
  private wss: WebSocketServer;
  private supervisor: SupervisorAgent;
  private wsChannel: WebSocketChannel;
  private port: number;
  private mcpClient?: MCPClient;
  private skillManager?: SkillManager;
  private toolRunner?: ToolRunner;
  private llmService?: LLMService;
  private browserManager?: BrowserSessionManager;
  private desktopManager?: DesktopSessionManager;
  private taskManager?: TaskManager;
  private missionManager?: MissionManager;
  private missionLeadAgent?: MissionLeadAgent;
  private ragProjectService?: RAGProjectService;
  private traceStore?: TraceStore;
  private mainProvider?: string;
  private mainModel?: string;
  private voiceProvider?: 'openai' | 'azure_openai';
  private voiceModel?: string;
  private azureOpenaiApiKey?: string;
  private azureOpenaiEndpoint?: string;
  private azureOpenaiApiVersion?: string;
  private openaiApiKey?: string;
  private bindAddress: string;
  private allowedOrigins: string[];
  private voiceWss: WebSocketServer;
  private mcpServerEnabled: boolean;
  private mcpServerSecret?: string;
  private mcpServerAuthDisabled?: boolean;
  private logBuffer?: LogBuffer;
  private fastProvider?: string;
  private fastModel?: string;

  constructor(config: ServerConfig) {
    this.port = config.port;
    this.supervisor = config.supervisor;
    this.mcpClient = config.mcpClient;
    this.skillManager = config.skillManager;
    this.toolRunner = config.toolRunner;
    this.llmService = config.llmService;
    this.browserManager = config.browserManager;
    this.desktopManager = config.desktopManager;
    this.taskManager = config.taskManager;
    this.missionManager = config.missionManager;
    this.ragProjectService = config.ragProjectService;
    this.traceStore = config.traceStore;
    this.mainProvider = config.mainProvider;
    this.mainModel = config.mainModel;
    this.voiceProvider = config.voiceProvider;
    this.voiceModel = config.voiceModel;
    this.azureOpenaiApiKey = config.azureOpenaiApiKey;
    this.azureOpenaiEndpoint = config.azureOpenaiEndpoint;
    this.azureOpenaiApiVersion = config.azureOpenaiApiVersion;
    this.openaiApiKey = config.openaiApiKey;
    this.mcpServerEnabled = config.mcpServerEnabled ?? false;
    this.mcpServerSecret = config.mcpServerSecret;
    this.mcpServerAuthDisabled = config.mcpServerAuthDisabled;
    this.logBuffer = config.logBuffer;
    this.fastProvider = config.fastProvider;
    this.fastModel = config.fastModel;

    // Security: Default to localhost-only binding (Layer 1: Network Binding)
    this.bindAddress = config.bindAddress ?? '127.0.0.1';

    // Security: Default allowed origins for local development (Layer 2: CORS)
    this.allowedOrigins = config.allowedOrigins ?? [
      'http://localhost:5173',   // Vite dev server
      'http://127.0.0.1:5173',   // Vite dev server (alternate)
      'http://localhost:3000',   // Same-origin (production build)
      'http://127.0.0.1:3000',   // Same-origin (alternate)
    ];

    // Create Express app
    this.app = express();

    // CORS configuration - restrict to allowed origins only
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, curl, etc.)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (this.allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`[CORS] Blocked request from origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }));
    this.app.use(express.json());

    // Create HTTP server
    this.server = createServer(this.app);

    // Create WebSocket servers with noServer mode for proper multi-path support
    this.wss = new WebSocketServer({ noServer: true });
    this.voiceWss = new WebSocketServer({ noServer: true });

    // Handle HTTP upgrade requests and route to appropriate WebSocket server
    this.server.on('upgrade', (request, socket, head) => {
      const origin = request.headers.origin;
      const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;

      // Verify origin for security
      if (origin && !this.allowedOrigins.includes(origin)) {
        console.warn(`[WebSocket] Blocked connection from origin: ${origin} on path: ${pathname}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      if (pathname === '/voice') {
        this.voiceWss.handleUpgrade(request, socket, head, (ws) => {
          this.voiceWss.emit('connection', ws, request);
        });
      } else if (pathname === '/') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // Create and configure web channel
    this.wsChannel = new WebSocketChannel('web-main');

    // Set the web channel on the global MessageEventService so all agents can use it
    setMessageEventServiceChannel(this.wsChannel);

    // Set the web channel on trace store for real-time log broadcasting
    if (this.traceStore) {
      this.traceStore.setChannel(this.wsChannel);
    }

    // Setup routes
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get model capabilities (for reasoning mode support)
    this.app.get('/api/model-capabilities', (_req: Request, res: Response) => {
      const caps = getModelCapabilities(this.mainProvider || '', this.mainModel || '');
      res.json({
        provider: this.mainProvider,
        model: this.mainModel,
        ...caps,
      });
    });

    // Consolidated startup endpoint - returns all data needed for initial page load
    this.app.get('/api/startup', async (_req: Request, res: Response) => {
      try {
        const db = getDb();

        // 1. Model capabilities
        const modelCaps = getModelCapabilities(this.mainProvider || '', this.mainModel || '');
        const modelCapabilities = {
          provider: this.mainProvider,
          model: this.mainModel,
          ...modelCaps,
        };

        // 2. Conversations
        const rawConversations = db.conversations.findAll({ limit: 50 });
        const conversations = rawConversations.map((c) => {
          const wellKnownMeta = getWellKnownConversationMeta(c.id);
          return {
            ...c,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            title: wellKnownMeta?.title ?? c.title,
          };
        });
        conversations.sort((a, b) => {
          if (a.isWellKnown && !b.isWellKnown) return -1;
          if (!a.isWellKnown && b.isWellKnown) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        // 3. Messages for default `feed` conversation (paginated - last 20)
        const paginatedResult = db.messages.findByConversationIdPaginated(
          WellKnownConversations.FEED, { limit: 20, includeTotal: true });
        const feedMessages = {
          items: paginatedResult.items.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            agentName: m.metadata?.agentName,
            agentEmoji: m.metadata?.agentEmoji,
            agentType: m.metadata?.agentType,
            attachments: m.metadata?.attachments,
            messageType: m.metadata?.type,
            taskId: m.metadata?.taskId,
            taskName: m.metadata?.taskName,
            taskDescription: m.metadata?.taskDescription,
            toolName: m.metadata?.toolName,
            toolSource: m.metadata?.source,
            toolSuccess: m.metadata?.success,
            toolDurationMs: m.metadata?.durationMs,
            toolError: m.metadata?.error,
            toolParameters: m.metadata?.parameters,
            toolResult: m.metadata?.result,
            delegationAgentId: m.metadata?.agentId,
            delegationAgentType: m.metadata?.agentType,
            delegationMission: m.metadata?.mission,
            delegationRationale: m.metadata?.rationale,
            // Reasoning mode (vendor-neutral)
            reasoningMode: m.metadata?.reasoningMode,
            // Agent command (for #Deep Research, #Modify, etc.)
            agentCommand: m.metadata?.agentCommand,
            // Citations
            citations: m.metadata?.citations,
            // Token usage stats
            usage: m.metadata?.usage,
          })),
          pagination: paginatedResult.pagination,
        };

        // 4. Tasks (from TaskManager, not DB)
        const tasks = this.taskManager?.getTasksForApi() || [];

        // 5. Skills
        const skills = this.skillManager
          ? this.skillManager.getAllMetadata().map(skill => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              location: skill.filePath,
            }))
          : [];

        // 6. MCP servers
        let mcps: Array<{ id: string; name: string; enabled: boolean; status: string; transport: string; toolCount: number }> = [];
        if (this.mcpClient) {
          const servers = this.mcpClient.getServers();
          const mcpTools = this.mcpClient.getTools();
          mcps = servers.map(server => ({
            id: server.id,
            name: server.name,
            enabled: server.enabled,
            status: this.mcpClient!.getServerStatus(server.id),
            transport: server.transport || (server.command ? 'stdio' : 'http'),
            toolCount: mcpTools.filter(t => t.serverId === server.id).length,
          }));
        }

        // 7. Tools (organized as tree structure)
        interface ToolInfo {
          name: string;
          description: string;
          inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
        }
        const extractInputs = (schema: Record<string, unknown>): Array<{ name: string; type: string; description: string; required: boolean }> => {
          const properties = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
          const required = (schema.required as string[]) || [];
          if (!properties) return [];
          return Object.entries(properties).map(([name, prop]) => ({
            name,
            type: String(prop.type || 'any'),
            description: prop.description || '',
            required: required.includes(name),
          }));
        };

        const builtin: ToolInfo[] = [];
        const user: ToolInfo[] = [];
        const mcp: Record<string, ToolInfo[]> = {};

        if (this.toolRunner) {
          const allTools = this.toolRunner.getToolsForLLM();
          const mcpServers = this.mcpClient?.getServers() || [];
          const serverNames: Record<string, string> = {};
          for (const server of mcpServers) {
            serverNames[server.id] = server.name;
          }

          for (const tool of allTools) {
            const toolName = tool.name;
            const inputs = extractInputs(tool.input_schema);

            if (toolName.startsWith('user.')) {
              user.push({ name: toolName.replace('user.', ''), description: tool.description, inputs });
            } else if (toolName.startsWith('mcp.')) {
              // mcp.serverId__toolName format
              const nameWithoutPrefix = toolName.replace(/^mcp\./, '');
              const [serverId, ...rest] = nameWithoutPrefix.split('__');
              const mcpToolName = rest.join('__');
              const serverName = serverNames[serverId] || serverId;
              if (!mcp[serverName]) mcp[serverName] = [];
              mcp[serverName].push({ name: mcpToolName, description: tool.description, inputs });
            } else {
              // No prefix = native/builtin tool
              builtin.push({ name: toolName, description: tool.description, inputs });
            }
          }
        }

        // 8. RAG Projects
        let ragProjects: Array<{
          id: string;
          name: string;
          documentCount: number;
          indexedCount: number;
          vectorCount: number;
          lastIndexedAt?: string;
          isIndexing: boolean;
        }> = [];
        if (this.ragProjectService) {
          try {
            const projects = await this.ragProjectService.listProjects();
            ragProjects = projects.map(p => ({
              id: p.id,
              name: p.name,
              documentCount: p.documentCount,
              indexedCount: p.indexedCount,
              vectorCount: p.vectorCount,
              lastIndexedAt: p.lastIndexedAt,
              isIndexing: this.ragProjectService!.isIndexing(p.id),
            }));
          } catch (error) {
            console.warn('[API] Failed to load RAG projects:', error);
          }
        }

        // 9. Agent metadata (for UI display, collapse settings, etc.)
        const registry = getAgentRegistry();
        const agentTemplates = registry.getSpecialistTemplates().map(t => ({
          type: t.type,
          name: t.identity.name,
          emoji: t.identity.emoji,
          description: t.identity.description,
          collapseResponseByDefault: t.collapseResponseByDefault || false,
        }));

        // 10. Command triggers for #menu (agent commands like #Deep Research, #Modify)
        const commandTriggers: Array<{ command: string; agentType: string; agentName: string; agentEmoji: string; description: string }> = [];
        for (const template of registry.getSpecialistTemplates()) {
          if (template.delegation?.commandTrigger) {
            commandTriggers.push({
              command: template.delegation.commandTrigger,
              agentType: template.type,
              agentName: template.identity.name,
              agentEmoji: template.identity.emoji,
              description: template.identity.description,
            });
          }
        }

        res.json({
          modelCapabilities,
          conversations,
          feedMessages,
          tasks,
          skills,
          mcps,
          tools: { builtin, user, mcp },
          ragProjects,
          agentTemplates,
          commandTriggers,
        });
      } catch (error) {
        console.error('[API] Startup data fetch failed:', error);
        res.status(500).json({ error: 'Failed to fetch startup data' });
      }
    });

    // Get agent state
    this.app.get('/api/state', (_req: Request, res: Response) => {
      res.json(this.supervisor.getState());
    });

    // Get active agents
    this.app.get('/api/agents', (_req: Request, res: Response) => {
      const agents = [
        this.supervisor.identity,
        ...this.supervisor.getSubAgents().map((id) => ({ id, role: 'worker' })),
      ];
      res.json(agents);
    });

    // Get MCP servers
    this.app.get('/api/mcps', (_req: Request, res: Response) => {
      if (!this.mcpClient) {
        res.json([]);
        return;
      }

      const servers = this.mcpClient.getServers();
      const tools = this.mcpClient.getTools();

      res.json(servers.map(server => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport || (server.command ? 'stdio' : 'http'),
        toolCount: tools.filter(t => t.serverId === server.id).length,
      })));
    });

    // Toggle MCP server enabled status
    this.app.patch('/api/mcps/:id', async (req: Request, res: Response) => {
      if (!this.mcpClient) {
        res.status(404).json({ error: 'MCP client not configured' });
        return;
      }

      const serverId = req.params.id as string;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled field must be a boolean' });
        return;
      }

      try {
        const success = await this.mcpClient.setServerEnabled(serverId, enabled);
        if (!success) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }

        // Persist the setting to user settings
        const settingsService = getUserSettingsService();
        settingsService.setMcpEnabled(serverId, enabled);

        // Return updated server info
        const servers = this.mcpClient.getServers();
        const server = servers.find(s => s.id === serverId);
        const tools = this.mcpClient.getTools();

        res.json({
          id: server?.id,
          name: server?.name,
          enabled: server?.enabled,
          status: this.mcpClient.getServerStatus(serverId),
          transport: server?.transport || (server?.command ? 'stdio' : 'http'),
          toolCount: tools.filter(t => t.serverId === serverId).length,
        });
      } catch (error) {
        console.error('[API] Failed to toggle MCP server:', error);
        res.status(500).json({ error: 'Failed to toggle MCP server' });
      }
    });

    // Get user settings
    this.app.get('/api/settings', (_req: Request, res: Response) => {
      const settingsService = getUserSettingsService();
      res.json(settingsService.getSettings());
    });

    // Update user settings
    this.app.patch('/api/settings', (req: Request, res: Response) => {
      try {
        const settingsService = getUserSettingsService();
        const updated = settingsService.updateSettings(req.body);
        res.json(updated);
      } catch (error) {
        console.error('[API] Failed to update settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
      }
    });

    // Get skills metadata
    this.app.get('/api/skills', (_req: Request, res: Response) => {
      if (!this.skillManager) {
        res.json([]);
        return;
      }

      const skills = this.skillManager.getAllMetadata();
      res.json(skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        location: skill.filePath,
      })));
    });

    // Get all tools (native + MCP) organized as tree structure
    this.app.get('/api/tools', (_req: Request, res: Response) => {
      if (!this.toolRunner) {
        res.json({ builtin: [], user: [], mcp: {} });
        return;
      }

      // Helper to extract input parameters from JSON schema
      const extractInputs = (schema: Record<string, unknown>): Array<{ name: string; type: string; description: string; required: boolean }> => {
        const properties = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
        const required = (schema.required as string[]) || [];
        if (!properties) return [];

        return Object.entries(properties).map(([name, prop]) => ({
          name,
          type: String(prop.type || 'any'),
          description: prop.description || '',
          required: required.includes(name),
        }));
      };

      const tools = this.toolRunner.getToolsForLLM();

      interface ToolInfo {
        name: string;
        description: string;
        inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
      }

      const builtin: ToolInfo[] = [];
      const user: ToolInfo[] = [];
      const mcp: Record<string, ToolInfo[]> = {};

      // Get MCP server names for grouping
      const mcpServers = this.mcpClient?.getServers() || [];
      const serverNames: Record<string, string> = {};
      for (const server of mcpServers) {
        serverNames[server.id] = server.name;
      }

      for (const tool of tools) {
        const toolName = tool.name;
        const inputs = extractInputs(tool.input_schema);

        if (toolName.startsWith('user.')) {
          // User-defined tool
          user.push({
            name: toolName.replace('user.', ''),
            description: tool.description,
            inputs,
          });
        } else if (toolName.startsWith('mcp.')) {
          // MCP tool: mcp.serverId__toolName
          const nameWithoutPrefix = toolName.replace(/^mcp\./, '');
          const [serverId, ...rest] = nameWithoutPrefix.split('__');
          const mcpToolName = rest.join('__');
          const serverName = serverNames[serverId] || serverId;

          if (!mcp[serverName]) {
            mcp[serverName] = [];
          }
          mcp[serverName].push({
            name: mcpToolName,
            description: tool.description,
            inputs,
          });
        } else {
          // No prefix = built-in native tool
          builtin.push({
            name: toolName,
            description: tool.description,
            inputs,
          });
        }
      }

      res.json({ builtin, user, mcp });
    });

    // Get all conversations
    this.app.get('/api/conversations', (_req: Request, res: Response) => {
      try {
        const db = getDb();
        const conversations = db.conversations.findAll({ limit: 50 });

        // Enhance conversations with well-known metadata and sort
        const enhanced = conversations.map((c) => {
          const wellKnownMeta = getWellKnownConversationMeta(c.id);
          return {
            ...c,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            // Well-known conversations use their fixed title
            title: wellKnownMeta?.title ?? c.title,
          };
        });

        // Sort: well-known conversations first, then by updatedAt
        enhanced.sort((a, b) => {
          if (a.isWellKnown && !b.isWellKnown) return -1;
          if (!a.isWellKnown && b.isWellKnown) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        res.json(enhanced);
      } catch (error) {
        console.error('[API] Failed to fetch conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
      }
    });

    // Get messages for a specific conversation (with pagination support)
    this.app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const conversationId = req.params.id as string;

        // Parse pagination query params
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
        const before = req.query.before as string | undefined;
        const after = req.query.after as string | undefined;
        const includeTotal = req.query.includeTotal === 'true';

        // Helper to transform message for API response
        const transformMessage = (m: ReturnType<typeof db.messages.findById>) => {
          if (!m) return null;
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            agentName: m.metadata?.agentName,
            agentEmoji: m.metadata?.agentEmoji,
            agentType: m.metadata?.agentType,
            // Attachments
            attachments: m.metadata?.attachments,
            // Message type (task_run, tool_event, delegation, etc.)
            messageType: m.metadata?.type,
            // Task run metadata
            taskId: m.metadata?.taskId,
            taskName: m.metadata?.taskName,
            taskDescription: m.metadata?.taskDescription,
            // Tool event metadata
            toolName: m.metadata?.toolName,
            toolSource: m.metadata?.source,
            toolSuccess: m.metadata?.success,
            toolDurationMs: m.metadata?.durationMs,
            toolError: m.metadata?.error,
            toolParameters: m.metadata?.parameters,
            toolResult: m.metadata?.result,
            // Delegation metadata (legacy - agentType above is preferred)
            delegationAgentId: m.metadata?.agentId,
            delegationAgentType: m.metadata?.agentType,
            delegationMission: m.metadata?.mission,
            delegationRationale: m.metadata?.rationale,
            // Reasoning mode (vendor-neutral)
            reasoningMode: m.metadata?.reasoningMode,
            // Citations
            citations: m.metadata?.citations,
            // Agent command (e.g., Deep Research, Modify)
            agentCommand: m.metadata?.agentCommand,
            // Token usage stats
            usage: m.metadata?.usage,
          };
        };

        // Use paginated query
        const result = db.messages.findByConversationIdPaginated(conversationId, {
          limit,
          before,
          after,
          includeTotal,
        });

        res.json({
          items: result.items.map(transformMessage).filter(Boolean),
          pagination: result.pagination,
        });
      } catch (error) {
        console.error('[API] Failed to fetch messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    // Delete all messages in a conversation (hard delete)
    this.app.delete('/api/conversations/:id/messages', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const conversationId = req.params.id as string;

        // Verify conversation exists
        const conversation = db.conversations.findById(conversationId);
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }

        // Delete all messages in the conversation
        const deletedCount = db.messages.deleteByConversationId(conversationId);
        console.log(`[API] Cleared ${deletedCount} messages from conversation ${conversationId}`);

        res.json({ success: true, deletedCount });
      } catch (error) {
        console.error('[API] Failed to clear messages:', error);
        res.status(500).json({ error: 'Failed to clear messages' });
      }
    });

    // Create a new conversation
    this.app.post('/api/conversations', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const { title, channel } = req.body;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const conversation = {
          id,
          title: title || 'New Conversation',
          channel: channel || 'web',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        db.conversations.create(conversation);
        res.json(conversation);
      } catch (error) {
        console.error('[API] Failed to create conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
      }
    });

    // Soft delete a conversation (well-known conversations cannot be deleted)
    this.app.delete('/api/conversations/:id', (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;

        // Prevent deletion of well-known conversations
        if (isWellKnownConversation(id)) {
          res.status(403).json({ error: 'Well-known conversations cannot be deleted' });
          return;
        }

        const db = getDb();
        db.conversations.softDelete(id);
        res.json({ success: true });
      } catch (error) {
        console.error('[API] Failed to delete conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
      }
    });

    // Rename a conversation (well-known conversations cannot be renamed)
    this.app.patch('/api/conversations/:id', (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const { title } = req.body;

        if (!title || typeof title !== 'string') {
          res.status(400).json({ error: 'Title is required' });
          return;
        }

        // Prevent renaming of well-known conversations
        if (isWellKnownConversation(id)) {
          res.status(403).json({ error: 'Well-known conversations cannot be renamed' });
          return;
        }

        const db = getDb();
        const conversation = db.conversations.findById(id);
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }

        const now = new Date().toISOString();
        db.conversations.update(id, {
          title: title.trim().substring(0, 100),
          manuallyNamed: true,
          updatedAt: now,
        });

        res.json({
          success: true,
          conversation: {
            id,
            title: title.trim().substring(0, 100),
            manuallyNamed: true,
            updatedAt: now,
          },
        });
      } catch (error) {
        console.error('[API] Failed to rename conversation:', error);
        res.status(500).json({ error: 'Failed to rename conversation' });
      }
    });

    // Get chat history (for current/active conversation)
    this.app.get('/api/messages', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const limit = parseInt(req.query.limit as string) || 50;

        // Get the most recent conversation
        const conversations = db.conversations.findAll({ limit: 1 });

        if (conversations.length === 0) {
          res.json([]);
          return;
        }

        const messages = db.messages.findByConversationId(conversations[0].id, { limit });
        res.json(messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          agentName: m.metadata?.agentName,
          agentEmoji: m.metadata?.agentEmoji,
          agentType: m.metadata?.agentType,
          // Attachments
          attachments: m.metadata?.attachments,
          // Message type (task_run, tool_event, delegation, etc.)
          messageType: m.metadata?.type,
          // Task run metadata
          taskId: m.metadata?.taskId,
          taskName: m.metadata?.taskName,
          taskDescription: m.metadata?.taskDescription,
          // Tool event metadata
          toolName: m.metadata?.toolName,
          toolSource: m.metadata?.source,
          toolSuccess: m.metadata?.success,
          toolDurationMs: m.metadata?.durationMs,
          toolError: m.metadata?.error,
          toolParameters: m.metadata?.parameters,
          toolResult: m.metadata?.result,
          // Delegation metadata
          delegationAgentId: m.metadata?.agentId,
          delegationAgentType: m.metadata?.agentType,
          delegationMission: m.metadata?.mission,
          delegationRationale: m.metadata?.rationale,
          // Citations
          citations: m.metadata?.citations,
        })));
      } catch (error) {
        console.error('[API] Failed to fetch messages:', error);
        res.json([]);
      }
    });

    // Send a message (REST alternative to WebSocket)
    this.app.post('/api/messages', async (req: Request, res: Response) => {
      try {
        const { content } = req.body;
        if (!content) {
          res.status(400).json({ error: 'Content is required' });
          return;
        }

        const message = {
          id: crypto.randomUUID(),
          channel: 'web-rest',
          role: 'user' as const,
          content,
          createdAt: new Date(),
        };

        await this.supervisor.handleMessage(message);
        res.json({ success: true, messageId: message.id });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Get connected clients count
    this.app.get('/api/clients', (_req: Request, res: Response) => {
      res.json({ count: this.wsChannel.getConnectedClients() });
    });

    // Get active tasks
    this.app.get('/api/tasks', (_req: Request, res: Response) => {
      res.json(this.taskManager?.getTasksForApi() || []);
    });

    // Run a task immediately
    this.app.post('/api/tasks/:id/run', async (req: Request, res: Response) => {
      try {
        const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const task = this.taskManager?.getTaskById(taskId);
        const { conversationId } = req.body || {};

        if (!task) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }

        // Get description and tools from jsonConfig
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';
        const taskTools = (task.jsonConfig as { tools?: Array<{ type: string }> }).tools || [];
        // Extract tool names from tools array
        const allowedToolNames = taskTools
          .map(t => typeof t === 'string' ? t : t.type)
          .filter(Boolean);

        // Emit task_run event via MessageEventService (broadcasts AND persists)
        // Returns the turnId which should be used for all subsequent messages in this turn
        const messageEventService = getMessageEventService();
        const turnId = messageEventService.emitTaskRunEvent(
          {
            taskId: task.id,
            taskName: task.name,
            taskDescription,
          },
          conversationId || null
        );

        // Create a message to trigger the task execution via the supervisor
        // The message content is for the LLM, metadata is for UI display
        // conversationId is passed in metadata - supervisor reads it from there
        const taskMessage = {
          id: crypto.randomUUID(),
          role: 'user' as const,
          content: `Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            turnId, // Pass the turnId from the task_run event
            conversationId: conversationId || undefined, // Conversation context for this task
            // Only allow tools specified in task config (empty = no tool restrictions)
            allowedTools: allowedToolNames.length > 0 ? allowedToolNames : undefined,
          },
        };

        // Mark task as executed (updates lastRun and nextRun)
        if (this.taskManager) {
          this.taskManager.markTaskExecuted(task.id);
        }

        // Send to supervisor (async - don't wait for completion)
        this.supervisor.handleMessage(taskMessage).catch((error) => {
          console.error('[API] Task execution error:', error);
        });

        res.json({ success: true, taskId: task.id, message: 'Task started' });
      } catch (error) {
        console.error('[API] Failed to run task:', error);
        res.status(500).json({ error: 'Failed to run task' });
      }
    });

    // Setup evaluation routes (if llmService and toolRunner are available)
    if (this.llmService && this.toolRunner) {
      setupEvalRoutes(this.app, {
        llmService: this.llmService,
        toolRunner: this.toolRunner,
        channel: this.wsChannel,
      });
      console.log('[Server] Evaluation routes enabled');
    }

    // Setup mission routes (if missionManager is available)
    if (this.missionManager) {
      setupMissionRoutes(this.app, {
        missionManager: this.missionManager,
      });
    }

    // REST endpoints for browser session management
    this.app.delete('/api/browser/sessions/:id', async (req: Request, res: Response) => {
      try {
        const sessionId = req.params.id as string;
        if (!this.browserManager) {
          res.status(404).json({ error: 'Browser manager not configured' });
          return;
        }
        await this.browserManager.closeSession(sessionId);
        res.json({ success: true, sessionId });
      } catch (error) {
        console.error('[API] Failed to close browser session:', error);
        res.status(500).json({ error: 'Failed to close browser session' });
      }
    });

    // REST endpoints for desktop session management
    this.app.delete('/api/desktop/sessions/:id', async (req: Request, res: Response) => {
      try {
        const sessionId = req.params.id as string;
        if (!this.desktopManager) {
          res.status(404).json({ error: 'Desktop manager not configured' });
          return;
        }
        await this.desktopManager.closeSession(sessionId);
        res.json({ success: true, sessionId });
      } catch (error) {
        console.error('[API] Failed to close desktop session:', error);
        res.status(500).json({ error: 'Failed to close desktop session' });
      }
    });

    // ================================================================
    // Traces API routes
    // ================================================================
    if (this.traceStore) {
      const traceStore = this.traceStore;

      // Get traces (list)
      this.app.get('/api/traces/traces', (req: Request, res: Response) => {
        try {
          const limit = parseInt(req.query.limit as string) || 50;
          const conversationId = req.query.conversationId as string | undefined;
          const status = req.query.status as string | undefined;
          const since = req.query.since as string | undefined;
          res.json(traceStore.getTraces({ limit, conversationId, status, since }));
        } catch (error) {
          console.error('[API] Failed to fetch traces:', error);
          res.status(500).json({ error: 'Failed to fetch traces' });
        }
      });

      // Get single trace with all children
      this.app.get('/api/traces/traces/:traceId', (req: Request, res: Response) => {
        try {
          const traceId = req.params.traceId as string;
          const result = traceStore.getFullTrace(traceId);
          if (!result) {
            res.status(404).json({ error: 'Trace not found' });
            return;
          }
          res.json(result);
        } catch (error) {
          console.error('[API] Failed to fetch trace:', error);
          res.status(500).json({ error: 'Failed to fetch trace' });
        }
      });

      // Get LLM calls (list)
      this.app.get('/api/traces/llm-calls', (req: Request, res: Response) => {
        try {
          const limit = parseInt(req.query.limit as string) || 50;
          const traceId = req.query.traceId as string | undefined;
          const spanId = req.query.spanId as string | undefined;
          const workload = req.query.workload as string | undefined;
          const provider = req.query.provider as string | undefined;
          const since = req.query.since as string | undefined;
          const conversationId = req.query.conversationId as string | undefined;
          res.json(traceStore.getLlmCalls({
            limit, traceId, spanId,
            workload: workload as 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice' | undefined,
            provider, since, conversationId,
          }));
        } catch (error) {
          console.error('[API] Failed to fetch LLM calls:', error);
          res.status(500).json({ error: 'Failed to fetch LLM calls' });
        }
      });

      // Get single LLM call
      this.app.get('/api/traces/llm-calls/:callId', (req: Request, res: Response) => {
        try {
          const callId = req.params.callId as string;
          const call = traceStore.getLlmCallById(callId);
          if (!call) {
            res.status(404).json({ error: 'LLM call not found' });
            return;
          }
          res.json(call);
        } catch (error) {
          console.error('[API] Failed to fetch LLM call:', error);
          res.status(500).json({ error: 'Failed to fetch LLM call' });
        }
      });

      // Get tool calls (list)
      this.app.get('/api/traces/tool-calls', (req: Request, res: Response) => {
        try {
          const limit = parseInt(req.query.limit as string) || 50;
          const traceId = req.query.traceId as string | undefined;
          const spanId = req.query.spanId as string | undefined;
          const llmCallId = req.query.llmCallId as string | undefined;
          res.json(traceStore.getToolCalls({ limit, traceId, spanId, llmCallId }));
        } catch (error) {
          console.error('[API] Failed to fetch tool calls:', error);
          res.status(500).json({ error: 'Failed to fetch tool calls' });
        }
      });

      // Get stats
      this.app.get('/api/traces/stats', (req: Request, res: Response) => {
        try {
          const since = req.query.since as string | undefined;
          res.json(traceStore.getStats(since));
        } catch (error) {
          console.error('[API] Failed to fetch trace stats:', error);
          res.status(500).json({ error: 'Failed to fetch trace stats' });
        }
      });

      console.log('[Server] Traces API routes enabled');
    }

    // Setup RAG project routes
    if (this.ragProjectService) {
      const ragRoutes = createRAGProjectRoutes(this.ragProjectService);
      this.app.use('/api/rag', ragRoutes);
      console.log('[Server] RAG project routes enabled');
    }
  }

  async start(): Promise<void> {
    this.wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });

    // Setup voice WebSocket proxy for real-time transcription
    setupVoiceProxy(this.voiceWss, {
      voiceProvider: this.voiceProvider,
      voiceModel: this.voiceModel,
      azureOpenaiApiKey: this.azureOpenaiApiKey,
      azureOpenaiEndpoint: this.azureOpenaiEndpoint,
      azureOpenaiApiVersion: this.azureOpenaiApiVersion,
      openaiApiKey: this.openaiApiKey,
    });

    // Initialize web channel and attach to WebSocket server
    await this.wsChannel.init();
    this.wsChannel.attachToServer(this.wss);

    // Register web channel with supervisor
    this.supervisor.registerChannel(this.wsChannel);

    // Create Mission Lead agent if mission manager and LLM service are available
    if (this.missionManager && this.llmService) {
      const registry = getAgentRegistry();
      this.missionLeadAgent = new MissionLeadAgent(this.llmService, registry);

      // Share the same tool infrastructure as supervisor
      if (this.toolRunner) this.missionLeadAgent.setToolRunner(this.toolRunner);
      if (this.skillManager) this.missionLeadAgent.setSkillManager(this.skillManager);

      // Set mission-specific dependency
      this.missionLeadAgent.setMissionManager(this.missionManager);

      // Register channel for sending (does NOT bind onMessage — our router handles that)
      this.missionLeadAgent.registerChannel(this.wsChannel);

      // Register with global registry and initialize
      registry.registerAgent(this.missionLeadAgent);
      await this.missionLeadAgent.init();

      console.log('[Server] Mission Lead agent initialized');
    }

    // Install message routing: mission conversations → MissionLeadAgent, else → Supervisor
    if (this.missionLeadAgent) {
      const missionLead = this.missionLeadAgent;
      const supervisor = this.supervisor;
      const conversationChannelCache = new Map<string, string | null>();

      this.wsChannel.onMessage(async (message) => {
        const conversationId = message.metadata?.conversationId as string | undefined;

        if (conversationId) {
          // Check cache first
          let channel = conversationChannelCache.get(conversationId);
          if (channel === undefined) {
            // Cache miss — look up conversation metadata
            const db = getDb();
            const conv = db.conversations.findById(conversationId);
            channel = (conv?.metadata?.channel as string) ?? null;
            conversationChannelCache.set(conversationId, channel);
          }

          if (channel === 'mission' || channel === 'pillar') {
            await missionLead.handleMessage(message);
            return;
          }
        }

        // Default: route to supervisor
        await supervisor.handleMessage(message);
      });
    }

    // Attach channel to browser manager if present (for event broadcasting)
    if (this.browserManager) {
      this.browserManager.attachChannel(this.wsChannel);
      // Session close actions are handled via REST endpoint: DELETE /api/browser/sessions/:id
    }

    // Attach channel to desktop manager if present (for event broadcasting)
    if (this.desktopManager) {
      this.desktopManager.attachChannel(this.wsChannel);
      // Session close actions are handled via REST endpoint: DELETE /api/desktop/sessions/:id
    }

    // Listen for task updates and broadcast to frontend
    if (this.taskManager) {
      this.taskManager.on('task:updated', ({ task }) => {
        this.wsChannel.broadcast({
          type: 'task_updated',
          task,
        });
      });
    }

    // Listen for RAG project indexing progress
    if (this.ragProjectService) {
      this.ragProjectService.on('indexing_progress', (progress: IndexingProgress) => {
        // Map internal event names to WebSocket event types
        const eventTypeMap: Record<string, string> = {
          started: 'rag_indexing_started',
          processing: 'rag_indexing_progress',
          completed: 'rag_indexing_completed',
          error: 'rag_indexing_error',
        };

        this.wsChannel.broadcast({
          type: eventTypeMap[progress.status] || 'rag_indexing_progress',
          projectId: progress.projectId,
          totalDocuments: progress.totalDocuments,
          processedDocuments: progress.processedDocuments,
          currentDocument: progress.currentDocument,
          error: progress.error,
          timestamp: progress.timestamp,
        });
      });

      // Listen for project changes
      this.ragProjectService.on('projects_changed', () => {
        this.wsChannel.broadcast({
          type: 'rag_projects_changed',
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Mount MCP server endpoint if enabled
    if (this.mcpServerEnabled && this.logBuffer && this.toolRunner) {
      const mcpServer = new OllieBotMCPServer({
        toolRunner: this.toolRunner,
        mcpClient: this.mcpClient,
        logBuffer: this.logBuffer,
        traceStore: this.traceStore,
        startTime: new Date(),
        getClientCount: () => this.wsChannel.getConnectedClients(),
        runtimeConfig: {
          mainProvider: this.mainProvider || '',
          mainModel: this.mainModel || '',
          fastProvider: this.fastProvider || '',
          fastModel: this.fastModel || '',
          port: this.port,
        },
        auth: {
          secret: this.mcpServerSecret,
          disabled: this.mcpServerAuthDisabled,
        },
      });

      mcpServer.mountRoutes(this.app);
    } else if (this.mcpServerEnabled) {
      console.warn('[MCP Server] Enabled but toolRunner not available — skipping mount');
    }

    // Start listening on configured bind address (default: localhost only)
    return new Promise((resolve) => {
      this.server.listen(this.port, this.bindAddress, () => {
        console.log(`[Server] HTTP server listening on http://${this.bindAddress}:${this.port}`);
        console.log(`[Server] WebSocket server ready on ws://${this.bindAddress}:${this.port}`);
        if (this.bindAddress === '127.0.0.1' || this.bindAddress === 'localhost') {
          console.log('[Server] Security: Accepting connections from localhost only');
        } else if (this.bindAddress === '0.0.0.0') {
          console.warn('[Server] Security: Accepting connections from all interfaces - ensure proper authentication is configured');
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.voiceWss.close(() => {
        this.wss.close(() => {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    });
  }
}
