import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
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
import { type RAGProjectService, createRAGProjectRoutes, type IndexingProgress, fuseResults } from '../rag-projects/index.js';
import type { StrategySearchResult } from '../rag-projects/fusion.js';
import type { MissionManager } from '../missions/index.js';
import { setupMissionRoutes } from './mission-routes.js';
import { getDashboardStore, SnapshotEngine, RenderEngine, setupDashboardRoutes } from '../dashboard/index.js';
import { MissionUpdateDashboardTool } from '../tools/native/mission-update-dashboard.js';
import { getMessageEventService, setMessageEventServiceChannel } from '../services/message-event-service.js';
import { getUserSettingsService } from '../settings/index.js';
import { OllieBotMCPServer } from '../mcp-server/index.js';
import type { LogBuffer } from '../mcp-server/index.js';
import type { TraceStore } from '../tracing/trace-store.js';
import type { MessageEmbeddingService, MessageSearchResult, MessageSearchResultSource } from '../message-embeddings/index.js';

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
  // Evaluation directories (for test isolation)
  evaluationsDir?: string;
  resultsDir?: string;
  // Message embedding service for semantic search
  messageEmbeddingService?: MessageEmbeddingService;
}

export class AssistantServer {
  private app: Hono;
  private server: Server | null = null;
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
  private evaluationsDir?: string;
  private resultsDir?: string;
  private messageEmbeddingService?: MessageEmbeddingService;

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
    this.evaluationsDir = config.evaluationsDir;
    this.resultsDir = config.resultsDir;
    this.messageEmbeddingService = config.messageEmbeddingService;

    // Security: Default to localhost-only binding (Layer 1: Network Binding)
    this.bindAddress = config.bindAddress ?? '127.0.0.1';

    // Security: Default allowed origins for local development (Layer 2: CORS)
    this.allowedOrigins = config.allowedOrigins ?? [
      'http://localhost:5173',   // Vite dev server
      'http://127.0.0.1:5173',   // Vite dev server (alternate)
      'http://localhost:3000',   // Same-origin (production build)
      'http://127.0.0.1:3000',   // Same-origin (alternate)
    ];

    // Create Hono app
    this.app = new Hono();

    // CORS configuration - restrict to allowed origins only
    this.app.use('*', cors({
      origin: (origin) => {
        // Allow requests with no origin (same-origin, curl, etc.)
        if (!origin) return '*';
        if (this.allowedOrigins.includes(origin)) {
          return origin;
        }
        console.warn(`[CORS] Blocked request from origin: ${origin}`);
        return null;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }));

    // Create WebSocket servers for manual handling (voice and main chat)
    this.wss = new WebSocketServer({ noServer: true });
    this.voiceWss = new WebSocketServer({ noServer: true });

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
    this.app.get('/health', (c) => {
      return c.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get model capabilities (for reasoning mode support)
    this.app.get('/api/model-capabilities', (c) => {
      const caps = getModelCapabilities(this.mainProvider || '', this.mainModel || '');
      return c.json({
        provider: this.mainProvider,
        model: this.mainModel,
        ...caps,
      });
    });

    // Consolidated startup endpoint - returns all data needed for initial page load
    this.app.get('/api/startup', async (c) => {
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
        const conversations = rawConversations.map((conv) => {
          const wellKnownMeta = getWellKnownConversationMeta(conv.id);
          return {
            ...conv,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            title: wellKnownMeta?.title ?? conv.title,
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

        return c.json({
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
        return c.json({ error: 'Failed to fetch startup data' }, 500);
      }
    });

    // Get agent state
    this.app.get('/api/state', (c) => {
      return c.json(this.supervisor.getState());
    });

    // Get active agents
    this.app.get('/api/agents', (c) => {
      const agents = [
        this.supervisor.identity,
        ...this.supervisor.getSubAgents().map((id) => ({ id, role: 'worker' })),
      ];
      return c.json(agents);
    });

    // Get MCP servers
    this.app.get('/api/mcps', (c) => {
      if (!this.mcpClient) {
        return c.json([]);
      }

      const servers = this.mcpClient.getServers();
      const tools = this.mcpClient.getTools();

      return c.json(servers.map(server => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport || (server.command ? 'stdio' : 'http'),
        toolCount: tools.filter(t => t.serverId === server.id).length,
      })));
    });

    // Toggle MCP server enabled status
    this.app.patch('/api/mcps/:id', async (c) => {
      if (!this.mcpClient) {
        return c.json({ error: 'MCP client not configured' }, 404);
      }

      const serverId = c.req.param('id');
      const body = await c.req.json();
      const { enabled } = body;

      if (typeof enabled !== 'boolean') {
        return c.json({ error: 'enabled field must be a boolean' }, 400);
      }

      try {
        const success = await this.mcpClient.setServerEnabled(serverId, enabled);
        if (!success) {
          return c.json({ error: 'Server not found' }, 404);
        }

        // Persist the setting to user settings
        const settingsService = getUserSettingsService();
        settingsService.setMcpEnabled(serverId, enabled);

        // Return updated server info
        const servers = this.mcpClient.getServers();
        const server = servers.find(s => s.id === serverId);
        const tools = this.mcpClient.getTools();

        return c.json({
          id: server?.id,
          name: server?.name,
          enabled: server?.enabled,
          status: this.mcpClient.getServerStatus(serverId),
          transport: server?.transport || (server?.command ? 'stdio' : 'http'),
          toolCount: tools.filter(t => t.serverId === serverId).length,
        });
      } catch (error) {
        console.error('[API] Failed to toggle MCP server:', error);
        return c.json({ error: 'Failed to toggle MCP server' }, 500);
      }
    });

    // Get user settings
    this.app.get('/api/settings', (c) => {
      const settingsService = getUserSettingsService();
      return c.json(settingsService.getSettings());
    });

    // Update user settings
    this.app.patch('/api/settings', async (c) => {
      try {
        const body = await c.req.json();
        const settingsService = getUserSettingsService();
        const updated = settingsService.updateSettings(body);
        return c.json(updated);
      } catch (error) {
        console.error('[API] Failed to update settings:', error);
        return c.json({ error: 'Failed to update settings' }, 500);
      }
    });

    // Get skills metadata
    this.app.get('/api/skills', (c) => {
      if (!this.skillManager) {
        return c.json([]);
      }

      const skills = this.skillManager.getAllMetadata();
      return c.json(skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        location: skill.filePath,
      })));
    });

    // Get all tools (native + MCP) organized as tree structure
    this.app.get('/api/tools', (c) => {
      if (!this.toolRunner) {
        return c.json({ builtin: [], user: [], mcp: {} });
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

      return c.json({ builtin, user, mcp });
    });

    // Get all conversations
    this.app.get('/api/conversations', (c) => {
      try {
        const db = getDb();
        const conversations = db.conversations.findAll({ limit: 50 });

        // Enhance conversations with well-known metadata and sort
        const enhanced = conversations.map((conv) => {
          const wellKnownMeta = getWellKnownConversationMeta(conv.id);
          return {
            ...conv,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            // Well-known conversations use their fixed title
            title: wellKnownMeta?.title ?? conv.title,
          };
        });

        // Sort: well-known conversations first, then by updatedAt
        enhanced.sort((a, b) => {
          if (a.isWellKnown && !b.isWellKnown) return -1;
          if (!a.isWellKnown && b.isWellKnown) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        return c.json(enhanced);
      } catch (error) {
        console.error('[API] Failed to fetch conversations:', error);
        return c.json({ error: 'Failed to fetch conversations' }, 500);
      }
    });

    // Get messages for a specific conversation (with pagination support)
    this.app.get('/api/conversations/:id/messages', (c) => {
      try {
        const db = getDb();
        const conversationId = c.req.param('id');

        // Parse pagination query params
        const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20'), 1), 100);
        const before = c.req.query('before');
        const after = c.req.query('after');
        const around = c.req.query('around'); // Message ID to center results around
        const includeTotal = c.req.query('includeTotal') === 'true';

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
            toolFiles: m.metadata?.files,
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

        // Handle "around" mode - load messages centered around a specific message
        if (around) {
          const targetMessage = db.messages.findById(around);
          if (!targetMessage || targetMessage.conversationId !== conversationId) {
            // Target message not found, fall back to normal pagination
            const result = db.messages.findByConversationIdPaginated(conversationId, {
              limit,
              includeTotal,
            });
            return c.json({
              items: result.items.map(transformMessage).filter(Boolean),
              pagination: result.pagination,
              targetIndex: -1, // Indicate target not found
            });
          }

          // Encode cursor for the target message
          const targetCursor = Buffer.from(JSON.stringify({
            createdAt: targetMessage.createdAt,
            id: targetMessage.id,
          })).toString('base64url');

          // Fetch messages before the target (older)
          const halfLimit = Math.floor(limit / 2);
          const beforeResult = db.messages.findByConversationIdPaginated(conversationId, {
            limit: halfLimit,
            before: targetCursor,
          });

          // Fetch messages after the target (newer), including the target itself
          const afterResult = db.messages.findByConversationIdPaginated(conversationId, {
            limit: limit - halfLimit,
            after: targetCursor,
          });

          // Combine: older messages + target + newer messages
          // The "after" query doesn't include the cursor message, so we need to add the target
          const combinedItems = [
            ...beforeResult.items,
            targetMessage,
            ...afterResult.items,
          ];

          // Sort by createdAt to ensure proper order
          combinedItems.sort((a, b) => {
            const timeCompare = a.createdAt.localeCompare(b.createdAt);
            return timeCompare !== 0 ? timeCompare : a.id.localeCompare(b.id);
          });

          // Find target index in combined results
          const targetIndex = combinedItems.findIndex(m => m.id === around);

          // Calculate pagination for combined results
          const oldestCursor = combinedItems.length > 0
            ? Buffer.from(JSON.stringify({ createdAt: combinedItems[0].createdAt, id: combinedItems[0].id })).toString('base64url')
            : null;
          const newestCursor = combinedItems.length > 0
            ? Buffer.from(JSON.stringify({ createdAt: combinedItems[combinedItems.length - 1].createdAt, id: combinedItems[combinedItems.length - 1].id })).toString('base64url')
            : null;

          return c.json({
            items: combinedItems.map(transformMessage).filter(Boolean),
            pagination: {
              hasOlder: beforeResult.pagination.hasOlder,
              hasNewer: afterResult.pagination.hasNewer,
              oldestCursor,
              newestCursor,
              totalCount: includeTotal ? db.messages.countByConversationId(conversationId) : undefined,
            },
            targetIndex, // Index of the target message in the results
          });
        }

        // Use paginated query
        const result = db.messages.findByConversationIdPaginated(conversationId, {
          limit,
          before,
          after,
          includeTotal,
        });

        return c.json({
          items: result.items.map(transformMessage).filter(Boolean),
          pagination: result.pagination,
        });
      } catch (error) {
        console.error('[API] Failed to fetch messages:', error);
        return c.json({ error: 'Failed to fetch messages' }, 500);
      }
    });

    // Delete all messages in a conversation (hard delete)
    this.app.delete('/api/conversations/:id/messages', (c) => {
      try {
        const db = getDb();
        const conversationId = c.req.param('id');

        // Verify conversation exists
        const conversation = db.conversations.findById(conversationId);
        if (!conversation) {
          return c.json({ error: 'Conversation not found' }, 404);
        }

        // Delete all messages in the conversation
        const deletedCount = db.messages.deleteByConversationId(conversationId);
        console.log(`[API] Cleared ${deletedCount} messages from conversation ${conversationId}`);

        return c.json({ success: true, deletedCount });
      } catch (error) {
        console.error('[API] Failed to clear messages:', error);
        return c.json({ error: 'Failed to clear messages' }, 500);
      }
    });

    // Create a new conversation
    this.app.post('/api/conversations', async (c) => {
      try {
        const db = getDb();
        const body = await c.req.json();
        const { title, channel } = body;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const conversation = {
          id,
          title: title || 'New Conversation',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          metadata: channel ? { channel } : undefined,
        };

        db.conversations.create(conversation);
        return c.json(conversation);
      } catch (error) {
        console.error('[API] Failed to create conversation:', error);
        return c.json({ error: 'Failed to create conversation' }, 500);
      }
    });

    // Soft delete a conversation (well-known conversations cannot be deleted)
    this.app.delete('/api/conversations/:id', async (c) => {
      try {
        const id = c.req.param('id');

        // Prevent deletion of well-known conversations
        if (isWellKnownConversation(id)) {
          return c.json({ error: 'Well-known conversations cannot be deleted' }, 403);
        }

        const db = getDb();
        db.conversations.softDelete(id);

        // Purge message embeddings for this conversation
        if (this.messageEmbeddingService) {
          await this.messageEmbeddingService.deleteByConversationId(id);
        }

        return c.json({ success: true });
      } catch (error) {
        console.error('[API] Failed to delete conversation:', error);
        return c.json({ error: 'Failed to delete conversation' }, 500);
      }
    });

    // Rename a conversation (well-known conversations cannot be renamed)
    this.app.patch('/api/conversations/:id', async (c) => {
      try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { title } = body;

        if (!title || typeof title !== 'string') {
          return c.json({ error: 'Title is required' }, 400);
        }

        // Prevent renaming of well-known conversations
        if (isWellKnownConversation(id)) {
          return c.json({ error: 'Well-known conversations cannot be renamed' }, 403);
        }

        const db = getDb();
        const conversation = db.conversations.findById(id);
        if (!conversation) {
          return c.json({ error: 'Conversation not found' }, 404);
        }

        const now = new Date().toISOString();
        db.conversations.update(id, {
          title: title.trim().substring(0, 100),
          manuallyNamed: true,
          updatedAt: now,
        });

        return c.json({
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
        return c.json({ error: 'Failed to rename conversation' }, 500);
      }
    });

    // Search messages across all conversations
    // Supports mode=fts (default), mode=semantic, mode=hybrid
    this.app.get('/api/messages/search', async (c) => {
      try {
        const db = getDb();
        const query = c.req.query('q') || '';
        const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20'), 1), 100);
        const before = c.req.query('before');
        const includeTotal = c.req.query('includeTotal') === 'true';
        const mode = (c.req.query('mode') || 'fts') as 'fts' | 'semantic' | 'hybrid';

        if (!query.trim()) {
          return c.json({
            items: [],
            pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
          });
        }

        // ── FTS-only mode (default, backward compatible) ──
        if (mode === 'fts') {
          const result = db.messages.search(query, {
            limit,
            before: before || undefined,
            roles: ['user', 'assistant'],
            includeTotal,
          });

          return c.json({
            items: result.items.map(m => ({
              id: m.id,
              conversationId: m.conversationId,
              conversationTitle: m.conversationTitle,
              role: m.role,
              snippet: m.snippet,
              createdAt: m.createdAt,
              score: m.rank,
              sources: [{ source: 'fts', score: m.rank }] as MessageSearchResultSource[],
            })),
            pagination: result.pagination,
          });
        }

        // ── Semantic-only mode ──
        if (mode === 'semantic') {
          if (!this.messageEmbeddingService) {
            return c.json({ error: 'Semantic search not available (no embedding provider configured)' }, 503);
          }

          const results = await this.messageEmbeddingService.search(query, limit);
          return c.json({
            items: results,
            pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
          });
        }

        // ── Hybrid mode: FTS + semantic, fused with RRF ──
        if (!this.messageEmbeddingService) {
          // Fall back to FTS-only if no embedding service
          const result = db.messages.search(query, {
            limit,
            before: before || undefined,
            roles: ['user', 'assistant'],
            includeTotal,
          });

          return c.json({
            items: result.items.map(m => ({
              id: m.id,
              conversationId: m.conversationId,
              conversationTitle: m.conversationTitle,
              role: m.role,
              snippet: m.snippet,
              createdAt: m.createdAt,
              score: m.rank,
              sources: [{ source: 'fts', score: m.rank }] as MessageSearchResultSource[],
            })),
            pagination: result.pagination,
          });
        }

        // Run FTS and semantic search in parallel
        const [ftsResult, semanticResults] = await Promise.all([
          Promise.resolve(db.messages.search(query, {
            limit: limit * 2, // Over-fetch for fusion
            roles: ['user', 'assistant'],
          })),
          this.messageEmbeddingService.search(query, limit * 2),
        ]);

        // Map FTS results to StrategySearchResult format for fusion.
        // Use messageId as the common ID for merging.
        const ftsForFusion: StrategySearchResult = {
          strategyId: 'fts',
          results: ftsResult.items.map((m, idx) => ({
            id: m.id, // messageId
            documentPath: m.conversationId,
            text: m.snippet,
            score: 1.0 / (idx + 1), // Normalize BM25 rank to a 0-1 score for display
            chunkIndex: 0,
            contentType: 'text' as const,
            metadata: {
              conversationId: m.conversationId,
              conversationTitle: m.conversationTitle,
              role: m.role,
              createdAt: m.createdAt,
              snippet: m.snippet,
              ftsRank: m.rank,
            },
          })),
        };

        const semanticForFusion: StrategySearchResult = {
          strategyId: 'semantic',
          results: semanticResults.map((m) => ({
            id: m.messageId,
            documentPath: m.conversationId,
            text: m.text,
            score: m.score,
            chunkIndex: 0,
            contentType: 'text' as const,
            metadata: {
              conversationId: m.conversationId,
              conversationTitle: m.conversationTitle,
              role: m.role,
              createdAt: m.createdAt,
              snippet: m.snippet,
              semanticSources: m.sources,
            },
          })),
        };

        // Fuse with RRF — FTS weight 1.0, semantic weight 0.8
        const fused = fuseResults(
          [ftsForFusion, semanticForFusion],
          [
            { type: 'fts' as never, weight: 1.0, enabled: true },
            { type: 'semantic' as never, weight: 0.8, enabled: true },
          ],
          'rrf',
          limit
        );

        // Build final results with merged sources
        const hybridItems: MessageSearchResult[] = fused.map((r) => {
          const meta = r.metadata as Record<string, unknown>;
          const sources: MessageSearchResultSource[] = [];

          // Collect provenance from each strategy that contributed
          for (const ss of r.strategyScores) {
            if (ss.strategyId === 'fts') {
              sources.push({
                source: 'fts',
                score: (meta?.ftsRank as number) ?? ss.score,
              });
            } else if (ss.strategyId === 'semantic') {
              // Propagate per-strategy semantic sources if available
              const semanticSources = meta?.semanticSources as MessageSearchResultSource[] | undefined;
              if (semanticSources && semanticSources.length > 0) {
                sources.push(...semanticSources);
              } else {
                sources.push({ source: 'semantic', score: ss.score });
              }
            }
          }

          return {
            messageId: r.id,
            conversationId: (meta?.conversationId as string) || r.documentPath,
            conversationTitle: (meta?.conversationTitle as string) || '',
            role: (meta?.role as string) || '',
            text: r.text,
            snippet: (meta?.snippet as string) || r.text.slice(0, 64),
            createdAt: (meta?.createdAt as string) || '',
            score: r.fusedScore,
            sources,
          };
        });

        return c.json({
          items: hybridItems,
          pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
        });
      } catch (error) {
        console.error('[API] Search failed:', error);
        return c.json({ error: 'Search failed' }, 500);
      }
    });

    // Get chat history (for current/active conversation)
    this.app.get('/api/messages', (c) => {
      try {
        const db = getDb();
        const limit = parseInt(c.req.query('limit') || '50');

        // Get the most recent conversation
        const conversations = db.conversations.findAll({ limit: 1 });

        if (conversations.length === 0) {
          return c.json([]);
        }

        const messages = db.messages.findByConversationId(conversations[0].id, { limit });
        return c.json(messages.map(m => ({
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
          toolFiles: m.metadata?.files,
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
        return c.json([]);
      }
    });

    // Send a message (REST alternative to WebSocket)
    this.app.post('/api/messages', async (c) => {
      try {
        const body = await c.req.json();
        const { content } = body;
        if (!content) {
          return c.json({ error: 'Content is required' }, 400);
        }

        const message = {
          id: crypto.randomUUID(),
          channel: 'web-rest',
          role: 'user' as const,
          content,
          createdAt: new Date(),
        };

        await this.supervisor.handleMessage(message);
        return c.json({ success: true, messageId: message.id });
      } catch (error) {
        return c.json({ error: String(error) }, 500);
      }
    });

    // Get connected clients count
    this.app.get('/api/clients', (c) => {
      return c.json({ count: this.wsChannel.getConnectedClients() });
    });

    // Get active tasks
    this.app.get('/api/tasks', (c) => {
      return c.json(this.taskManager?.getTasksForApi() || []);
    });

    // Toggle task enabled/disabled status
    this.app.patch('/api/tasks/:id', async (c) => {
      const taskId = c.req.param('id');
      const body = await c.req.json();
      const { enabled } = body || {};

      if (!this.taskManager) {
        return c.json({ error: 'Task manager not initialized' }, 500);
      }

      if (typeof enabled !== 'boolean') {
        return c.json({ error: 'enabled must be a boolean' }, 400);
      }

      const success = this.taskManager.setTaskEnabled(taskId, enabled);
      if (!success) {
        return c.json({ error: 'Task not found' }, 404);
      }

      // Return updated task info
      const tasks = this.taskManager.getTasksForApi();
      const task = tasks.find(t => t.id === taskId);
      return c.json(task || { id: taskId, enabled });
    });

    // Run a task immediately
    this.app.post('/api/tasks/:id/run', async (c) => {
      try {
        const taskId = c.req.param('id');
        const task = this.taskManager?.getTaskById(taskId);
        const body = await c.req.json().catch(() => ({}));
        const { conversationId } = body || {};

        if (!task) {
          return c.json({ error: 'Task not found' }, 404);
        }

        // Get description and tools from jsonConfig
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';
        const taskTools = (task.jsonConfig as { tools?: Array<{ type: string }> }).tools || [];
        // Extract tool names from tools array
        const allowedToolNames = taskTools
          .map(t => typeof t === 'string' ? t : t.type)
          .filter(Boolean);

        // Emit task_run event via MessageEventService (broadcasts AND persists)
        // Returns the Message object to pass to supervisor.handleMessage()
        // This follows the same pattern as delegation - message-event layer handles
        // both broadcast and persistence, ensuring a single source of truth.
        const messageEventService = getMessageEventService();
        const taskMessage = messageEventService.emitTaskRunEvent(
          {
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            content: `[Scheduled Task] Execute the "${task.name}" task now.\n\nTask configuration:\n${JSON.stringify(task.jsonConfig, null, 2)}`,
            allowedTools: allowedToolNames.length > 0 ? allowedToolNames : undefined,
          },
          conversationId || null
        );

        // Mark task as executed (updates lastRun and nextRun)
        if (this.taskManager) {
          this.taskManager.markTaskExecuted(task.id);
        }

        // Send to supervisor (async - don't wait for completion)
        this.supervisor.handleMessage(taskMessage).catch((error) => {
          console.error('[API] Task execution error:', error);
        });

        return c.json({ success: true, taskId: task.id, message: 'Task started' });
      } catch (error) {
        console.error('[API] Failed to run task:', error);
        return c.json({ error: 'Failed to run task' }, 500);
      }
    });

    // Setup evaluation routes (if llmService and toolRunner are available)
    if (this.llmService && this.toolRunner) {
      setupEvalRoutes(this.app, {
        llmService: this.llmService,
        toolRunner: this.toolRunner,
        channel: this.wsChannel,
        evaluationsDir: this.evaluationsDir,
        resultsDir: this.resultsDir,
      });
      console.log('[Server] Evaluation routes enabled');
    }

    // Setup mission routes (if missionManager is available)
    if (this.missionManager) {
      setupMissionRoutes(this.app, {
        missionManager: this.missionManager,
        llmService: this.llmService,
      });
    }

    // Setup dashboard routes (if llmService and traceStore are available)
    if (this.llmService && this.traceStore) {
      const dashboardStore = getDashboardStore();
      dashboardStore.init();
      const snapshotEngine = new SnapshotEngine(this.traceStore);
      const renderEngine = new RenderEngine(this.llmService, dashboardStore);
      setupDashboardRoutes(this.app, {
        dashboardStore,
        snapshotEngine,
        renderEngine,
      });

      // Register dashboard update tool (requires missionManager + dashboard components)
      if (this.missionManager && this.toolRunner) {
        this.toolRunner.registerNativeTool(new MissionUpdateDashboardTool({
          missionManager: this.missionManager,
          dashboardStore,
          renderEngine,
          snapshotEngine,
        }));
        console.log('[Server] Dashboard update tool registered (mission_update_dashboard)');
      }
    }

    // REST endpoints for browser session management
    this.app.delete('/api/browser/sessions/:id', async (c) => {
      try {
        const sessionId = c.req.param('id');
        if (!this.browserManager) {
          return c.json({ error: 'Browser manager not configured' }, 404);
        }
        await this.browserManager.closeSession(sessionId);
        return c.json({ success: true, sessionId });
      } catch (error) {
        console.error('[API] Failed to close browser session:', error);
        return c.json({ error: 'Failed to close browser session' }, 500);
      }
    });

    // REST endpoints for desktop session management
    this.app.delete('/api/desktop/sessions/:id', async (c) => {
      try {
        const sessionId = c.req.param('id');
        if (!this.desktopManager) {
          return c.json({ error: 'Desktop manager not configured' }, 404);
        }
        await this.desktopManager.closeSession(sessionId);
        return c.json({ success: true, sessionId });
      } catch (error) {
        console.error('[API] Failed to close desktop session:', error);
        return c.json({ error: 'Failed to close desktop session' }, 500);
      }
    });

    // ================================================================
    // Traces API routes
    // ================================================================
    if (this.traceStore) {
      const traceStore = this.traceStore;

      // Get traces (list)
      this.app.get('/api/traces/traces', (c) => {
        try {
          const limit = parseInt(c.req.query('limit') || '50');
          const conversationId = c.req.query('conversationId');
          const status = c.req.query('status');
          const since = c.req.query('since');
          return c.json(traceStore.getTraces({ limit, conversationId, status, since }));
        } catch (error) {
          console.error('[API] Failed to fetch traces:', error);
          return c.json({ error: 'Failed to fetch traces' }, 500);
        }
      });

      // Get single trace with all children
      this.app.get('/api/traces/traces/:traceId', (c) => {
        try {
          const traceId = c.req.param('traceId');
          const result = traceStore.getFullTrace(traceId);
          if (!result) {
            return c.json({ error: 'Trace not found' }, 404);
          }
          return c.json(result);
        } catch (error) {
          console.error('[API] Failed to fetch trace:', error);
          return c.json({ error: 'Failed to fetch trace' }, 500);
        }
      });

      // Get LLM calls (list)
      this.app.get('/api/traces/llm-calls', (c) => {
        try {
          const limit = parseInt(c.req.query('limit') || '50');
          const traceId = c.req.query('traceId');
          const spanId = c.req.query('spanId');
          const workload = c.req.query('workload');
          const provider = c.req.query('provider');
          const since = c.req.query('since');
          const conversationId = c.req.query('conversationId');
          return c.json(traceStore.getLlmCalls({
            limit, traceId, spanId,
            workload: workload as 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice' | undefined,
            provider, since, conversationId,
          }));
        } catch (error) {
          console.error('[API] Failed to fetch LLM calls:', error);
          return c.json({ error: 'Failed to fetch LLM calls' }, 500);
        }
      });

      // Get single LLM call
      this.app.get('/api/traces/llm-calls/:callId', (c) => {
        try {
          const callId = c.req.param('callId');
          const call = traceStore.getLlmCallById(callId);
          if (!call) {
            return c.json({ error: 'LLM call not found' }, 404);
          }
          return c.json(call);
        } catch (error) {
          console.error('[API] Failed to fetch LLM call:', error);
          return c.json({ error: 'Failed to fetch LLM call' }, 500);
        }
      });

      // Get tool calls (list)
      this.app.get('/api/traces/tool-calls', (c) => {
        try {
          const limit = parseInt(c.req.query('limit') || '50');
          const traceId = c.req.query('traceId');
          const spanId = c.req.query('spanId');
          const llmCallId = c.req.query('llmCallId');
          return c.json(traceStore.getToolCalls({ limit, traceId, spanId, llmCallId }));
        } catch (error) {
          console.error('[API] Failed to fetch tool calls:', error);
          return c.json({ error: 'Failed to fetch tool calls' }, 500);
        }
      });

      // Get stats
      this.app.get('/api/traces/stats', (c) => {
        try {
          const since = c.req.query('since');
          const stats = traceStore.getStats(since);
          // Include whether token reduction is currently enabled
          const tokenReductionEnabled = this.llmService?.isTokenReductionEnabled() ?? false;
          return c.json({ ...stats, tokenReductionEnabled });
        } catch (error) {
          console.error('[API] Failed to fetch trace stats:', error);
          return c.json({ error: 'Failed to fetch trace stats' }, 500);
        }
      });

      console.log('[Server] Traces API routes enabled');
    }

    // Setup RAG project routes
    if (this.ragProjectService) {
      const ragRoutes = createRAGProjectRoutes(this.ragProjectService);
      this.app.route('/api/rag', ragRoutes);
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

      // Listen for mission cycle events and generate dashboards
      this.missionManager.on('mission:cycle:due', async ({ mission }) => {
        console.log(`[Server] Mission cycle triggered for "${mission.name}"`);
        try {
          await this.generateMissionDashboard(mission.slug);
          // Update lastCycleAt
          this.missionManager!.updateMission(mission.slug, {});
          console.log(`[Server] Mission cycle completed for "${mission.name}"`);
        } catch (error) {
          console.error(`[Server] Mission cycle failed for "${mission.name}":`, error);
        }
      });
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
            console.log(`[Router] Routing to Mission Lead (channel=${channel})`);
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

    // Start the server with @hono/node-server
    const nodeServer = serve({
      fetch: this.app.fetch,
      port: this.port,
      hostname: this.bindAddress,
    });

    // Get the underlying HTTP server for WebSocket upgrade handling
    this.server = nodeServer as unknown as Server;

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

    console.log(`[Server] HTTP server listening on http://${this.bindAddress}:${this.port}`);
    console.log(`[Server] WebSocket server ready on ws://${this.bindAddress}:${this.port}`);
    if (this.bindAddress === '127.0.0.1' || this.bindAddress === 'localhost') {
      console.log('[Server] Security: Accepting connections from localhost only');
    } else if (this.bindAddress === '0.0.0.0') {
      console.warn('[Server] Security: Accepting connections from all interfaces - ensure proper authentication is configured');
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.voiceWss.close(() => {
        this.wss.close(() => {
          if (this.server) {
            this.server.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Disconnect all WebSocket clients without stopping the server.
   * Used for test isolation between test cases.
   */
  disconnectAllClients(): void {
    this.wsChannel.disconnectAllClients();
  }

  /**
   * Generate a mission dashboard HTML file from current mission data.
   */
  private async generateMissionDashboard(missionSlug: string): Promise<void> {
    if (!this.missionManager) return;

    const mission = this.missionManager.getMissionBySlug(missionSlug);
    if (!mission) {
      console.error(`[Dashboard] Mission not found: ${missionSlug}`);
      return;
    }

    const pillars = this.missionManager.getPillarsByMission(mission.id);
    const pillarData = pillars.map(p => {
      const metrics = this.missionManager!.getMetricsByPillar(p.id);
      const todos = this.missionManager!.getTodosByPillar(p.id);
      return {
        name: p.name,
        slug: p.slug,
        description: p.description,
        metrics: metrics.map(m => ({
          name: m.name,
          current: m.current,
          target: typeof m.target === 'string' ? JSON.parse(m.target) : m.target,
          status: m.status,
          trend: m.trend,
          unit: m.unit,
          type: m.type,
        })),
        todosByStatus: {
          pending: todos.filter(t => t.status === 'pending').length,
          in_progress: todos.filter(t => t.status === 'in_progress').length,
          completed: todos.filter(t => t.status === 'completed').length,
          backlog: todos.filter(t => t.status === 'backlog').length,
        },
      };
    });

    // Generate HTML dashboard
    const html = this.renderMissionDashboardHtml(mission, pillarData);

    // Ensure directory exists - derive from existing dashboard path method
    const missionDashboardPath = this.missionManager.getMissionDashboardPath(missionSlug);
    const { mkdirSync, writeFileSync } = await import('fs');
    const { dirname } = await import('path');
    const dashboardDir = dirname(missionDashboardPath);
    mkdirSync(dashboardDir, { recursive: true });

    // Write mission dashboard
    const dashboardPath = `${dashboardDir}/mission.html`;
    writeFileSync(dashboardPath, html, 'utf-8');
    console.log(`[Dashboard] Generated mission dashboard: ${dashboardPath}`);

    // Also generate pillar dashboards
    for (const pillar of pillarData) {
      const pillarHtml = this.renderPillarDashboardHtml(mission, pillar);
      const pillarPath = `${dashboardDir}/${pillar.slug}.html`;
      writeFileSync(pillarPath, pillarHtml, 'utf-8');
      console.log(`[Dashboard] Generated pillar dashboard: ${pillarPath}`);
    }
  }

  private renderMissionDashboardHtml(mission: { name: string; description: string; status: string }, pillars: Array<{ name: string; slug: string; metrics: Array<{ name: string; current: number | null; status: string; trend: string; unit: string; type: string }>; todosByStatus: { pending: number; in_progress: number; completed: number; backlog: number } }>): string {
    const timestamp = new Date().toLocaleString();

    // Format duration values from seconds to human-readable
    const formatDuration = (seconds: number): string => {
      if (seconds >= 3600) {
        const hours = seconds / 3600;
        return hours % 1 === 0 ? `${hours}` : hours.toFixed(1);
      }
      if (seconds >= 60) {
        const mins = seconds / 60;
        return mins % 1 === 0 ? `${mins}` : mins.toFixed(1);
      }
      return `${seconds}`;
    };

    const formatMetricValue = (m: { current: number | null; type: string }): string => {
      if (m.current === null) return '—';
      if (m.type === 'duration') return formatDuration(m.current);
      return String(m.current);
    };

    const totalMetrics = pillars.reduce((sum, p) => sum + p.metrics.length, 0);
    const onTargetCount = pillars.reduce((sum, p) => sum + p.metrics.filter(m => m.status === 'on_target').length, 0);
    const totalTodos = pillars.reduce((sum, p) => sum + p.todosByStatus.pending + p.todosByStatus.in_progress + p.todosByStatus.completed + p.todosByStatus.backlog, 0);
    const activeTodos = pillars.reduce((sum, p) => sum + p.todosByStatus.in_progress, 0);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${mission.name} - Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { overflow-x: hidden; }
    body { background: #0f1117; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 100%; overflow-x: hidden; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #1a1d24; border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: #3a3d44; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #4a4d54; }
    .header { margin-bottom: 24px; }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header .meta { color: #888; font-size: 14px; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status.active { background: #22c55e33; color: #22c55e; }
    .status.paused { background: #eab30833; color: #eab308; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .kpi-card { background: #1a1d24; border-radius: 8px; padding: 16px 20px; min-width: 150px; flex: 1; }
    .kpi-card .label { font-size: 12px; color: #888; margin-bottom: 4px; }
    .kpi-card .value { font-size: 28px; font-weight: 600; }
    .kpi-card .value.green { color: #22c55e; }
    .kpi-card .value.yellow { color: #eab308; }
    .kpi-card .value.red { color: #ef4444; }
    .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .pillar-card { background: #1a1d24; border-radius: 8px; padding: 20px; }
    .pillar-card h3 { font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .health-dot { width: 10px; height: 10px; border-radius: 50%; }
    .health-dot.green { background: #22c55e; }
    .health-dot.yellow { background: #eab308; }
    .health-dot.red { background: #ef4444; }
    .health-dot.unknown { background: #666; }
    .metrics-list { margin-bottom: 12px; }
    .metric-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2a2d34; font-size: 13px; }
    .metric-row:last-child { border-bottom: none; }
    .metric-name { color: #aaa; }
    .metric-value { font-weight: 500; }
    .trend { font-size: 12px; }
    .trend.improving { color: #22c55e; }
    .trend.degrading { color: #ef4444; }
    .trend.stable { color: #888; }
    .todos-summary { font-size: 13px; color: #888; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${mission.name} <span class="status ${mission.status}">${mission.status}</span></h1>
    <p class="meta">Generated: ${timestamp}</p>
    <p style="margin-top: 8px; color: #aaa;">${mission.description || ''}</p>
  </div>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="label">Pillars</div>
      <div class="value">${pillars.length}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Total Metrics</div>
      <div class="value">${totalMetrics}</div>
    </div>
    <div class="kpi-card">
      <div class="label">On Target</div>
      <div class="value ${onTargetCount === totalMetrics ? 'green' : onTargetCount > 0 ? 'yellow' : 'red'}">${onTargetCount}/${totalMetrics}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Active TODOs</div>
      <div class="value">${activeTodos}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Total TODOs</div>
      <div class="value">${totalTodos}</div>
    </div>
  </div>

  <div class="pillars">
    ${pillars.map(p => {
      const improving = p.metrics.filter(m => m.trend === 'improving').length;
      const degrading = p.metrics.filter(m => m.trend === 'degrading').length;
      const health = degrading > p.metrics.length / 2 ? 'red' : improving >= p.metrics.length / 2 ? 'green' : p.metrics.length === 0 ? 'unknown' : 'yellow';
      return `
    <div class="pillar-card">
      <h3><span class="health-dot ${health}"></span> ${p.name}</h3>
      <div class="metrics-list">
        ${p.metrics.slice(0, 4).map(m => `
        <div class="metric-row">
          <span class="metric-name">${m.name}</span>
          <span class="metric-value">${formatMetricValue(m)} <span class="trend ${m.trend}">${m.trend === 'improving' ? '↗' : m.trend === 'degrading' ? '↘' : m.trend === 'stable' ? '→' : '?'}</span></span>
        </div>`).join('')}
      </div>
      <div class="todos-summary">TODOs: ${p.todosByStatus.in_progress} active, ${p.todosByStatus.pending} pending</div>
    </div>`;
    }).join('')}
  </div>
</body>
</html>`;
  }

  private renderPillarDashboardHtml(mission: { name: string }, pillar: { name: string; description?: string; metrics: Array<{ name: string; current: number | null; target: { operator?: string; value?: number }; status: string; trend: string; unit: string; type: string }>; todosByStatus: { pending: number; in_progress: number; completed: number; backlog: number } }): string {
    const timestamp = new Date().toLocaleString();
    const formatTarget = (t: { operator?: string; value?: number }) => t?.operator && t?.value !== undefined ? `${t.operator} ${t.value}` : '—';

    // Format duration values from seconds to human-readable
    const formatDuration = (seconds: number): string => {
      if (seconds >= 3600) {
        const hours = seconds / 3600;
        return hours % 1 === 0 ? `${hours}` : hours.toFixed(1);
      }
      if (seconds >= 60) {
        const mins = seconds / 60;
        return mins % 1 === 0 ? `${mins}` : mins.toFixed(1);
      }
      return `${seconds}`;
    };

    const formatMetricValue = (m: { current: number | null; type: string; unit: string }): string => {
      if (m.current === null) return '—';
      if (m.type === 'duration') return formatDuration(m.current);
      return String(m.current);
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pillar.name} - ${mission.name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { overflow-x: hidden; }
    body { background: #0f1117; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 100%; overflow-x: hidden; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #1a1d24; border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: #3a3d44; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #4a4d54; }
    .header { margin-bottom: 24px; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header .breadcrumb { color: #888; font-size: 14px; margin-bottom: 8px; }
    .header .description { color: #aaa; }
    table { width: 100%; border-collapse: collapse; background: #1a1d24; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #2a2d34; }
    th { background: #22252d; font-weight: 600; font-size: 12px; text-transform: uppercase; color: #888; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .status-badge.on_target { background: #22c55e33; color: #22c55e; }
    .status-badge.warning { background: #eab30833; color: #eab308; }
    .status-badge.off_target { background: #ef444433; color: #ef4444; }
    .status-badge.unknown { background: #66666633; color: #888; }
    .trend { font-size: 14px; }
    .trend.improving { color: #22c55e; }
    .trend.degrading { color: #ef4444; }
    .trend.stable { color: #888; }
    .trend.unknown { color: #666; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
    .kpi-card { background: #1a1d24; border-radius: 8px; padding: 16px 20px; min-width: 120px; }
    .kpi-card .label { font-size: 12px; color: #888; margin-bottom: 4px; }
    .kpi-card .value { font-size: 24px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div class="breadcrumb">${mission.name} / Pillar</div>
    <h1>${pillar.name}</h1>
    <p class="description">${pillar.description || ''}</p>
    <p style="color: #666; font-size: 12px; margin-top: 8px;">Generated: ${timestamp}</p>
  </div>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="label">Total Metrics</div>
      <div class="value">${pillar.metrics.length}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Active TODOs</div>
      <div class="value">${pillar.todosByStatus.in_progress}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Pending</div>
      <div class="value">${pillar.todosByStatus.pending}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Completed</div>
      <div class="value">${pillar.todosByStatus.completed}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Current</th>
        <th>Target</th>
        <th>Status</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody>
      ${pillar.metrics.map(m => `
      <tr>
        <td>${m.name}</td>
        <td>${formatMetricValue(m)}${m.unit ? ' ' + m.unit : ''}</td>
        <td>${formatTarget(m.target)}</td>
        <td><span class="status-badge ${m.status}">${m.status.replace('_', ' ')}</span></td>
        <td><span class="trend ${m.trend}">${m.trend === 'improving' ? '↗ Improving' : m.trend === 'degrading' ? '↘ Degrading' : m.trend === 'stable' ? '→ Stable' : '? Unknown'}</span></td>
      </tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;
  }
}
