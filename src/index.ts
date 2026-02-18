import 'dotenv/config';
import { join } from 'path';
import { validateEnv, buildConfig } from './config/index.js';
import { initDb, closeDb, getDb } from './db/index.js';
import { ensureWellKnownConversations, WellKnownConversations } from './db/well-known-conversations.js';
import { SUPERVISOR_ICON, SUPERVISOR_NAME } from './constants.js';
import { SupervisorAgentImpl, getAgentRegistry } from './agents/index.js';
import {
  LLMService,
  AnthropicProvider,
  GoogleProvider,
  OpenAIProvider,
  AzureOpenAIProvider,
  type LLMProvider,
} from './llm/index.js';
import { ConsoleChannel } from './channels/index.js';
import { AssistantServer } from './server/index.js';
import { MCPClient } from './mcp/index.js';
import type { MCPServerConfig } from './mcp/types.js';
import { SkillManager } from './skills/index.js';
import {
  RAGProjectService,
  GoogleEmbeddingProvider,
  OpenAIEmbeddingProvider,
  AzureOpenAIEmbeddingProvider,
  RagDataManager,
} from './rag-projects/index.js';
import {
  ToolRunner,
  WebSearchTool,
  type WebSearchProvider,
  WebScrapeTool,
  WikipediaSearchTool,
  TakeScreenshotTool,
  CreateImageTool,
  RememberTool,
  ReadAgentSkillTool,
  RunAgentSkillScriptTool,
  HttpClientTool,
  DelegateTool,
  QueryRAGProjectTool,
  SpeakTool,
  GeneratePythonTool,
  RunPythonTool,
  WebsiteCrawlerTool,
  MissionTodoCreateTool,
  MissionTodoUpdateTool,
  MissionTodoCompleteTool,
  MissionMetricRecordTool,
  TurnTodoCreateTool,
  TurnTodoListTool,
  TurnTodoCompleteTool,
} from './tools/index.js';
import {
  ReadFrontendCodeTool,
  ModifyFrontendCodeTool,
  CheckFrontendCodeTool,
} from './self-coding/index.js';
import { TaskManager } from './tasks/index.js';
import { MissionManager, initMissionSchema, validateMissionConversations } from './missions/index.js';
import { TurnTodoRepository } from './todos/index.js';
import { MemoryService } from './memory/index.js';
import { UserToolManager } from './tools/user/index.js';
import {
  BrowserSessionManager,
  loadBrowserConfig,
  BrowserSessionTool,
  BrowserNavigateTool,
  BrowserActionTool,
  BrowserScreenshotTool,
} from './browser/index.js';
import {
  DesktopSessionManager,
  DesktopSessionTool,
  DesktopActionTool,
  DesktopScreenshotTool,
} from './desktop/index.js';
import { getUserSettingsService } from './settings/index.js';
import { LogBuffer } from './mcp-server/index.js';
import { getTraceStore } from './tracing/index.js';

/**
 * Parse MCP server configurations from various formats.
 * Supports:
 * 1. Flat array: [{ id, name, command, args, env, enabled }]
 * 2. Claude Desktop format: [{ mcpServers: { serverId: { command, args, env } } }]
 * 3. Direct Claude Desktop format: { mcpServers: { serverId: { command, args, env } } }
 */
function parseMCPServers(configStr: string): MCPServerConfig[] {
  try {
    const parsed = JSON.parse(configStr);
    const servers: MCPServerConfig[] = [];

    // Handle direct mcpServers object (Claude Desktop format without array wrapper)
    if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
      for (const [serverId, config] of Object.entries(parsed.mcpServers)) {
        const serverConfig = config as Record<string, unknown>;
        servers.push({
          id: serverId,
          name: serverId.charAt(0).toUpperCase() + serverId.slice(1),
          enabled: true,
          transport: 'stdio',
          command: serverConfig.command as string,
          args: serverConfig.args as string[] | undefined,
          env: serverConfig.env as Record<string, string> | undefined,
        });
      }
      return servers;
    }

    // Handle array format
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // Check if item is Claude Desktop format (has mcpServers key)
        if (item && typeof item === 'object' && item.mcpServers) {
          for (const [serverId, config] of Object.entries(item.mcpServers)) {
            const serverConfig = config as Record<string, unknown>;
            servers.push({
              id: serverId,
              name: serverId.charAt(0).toUpperCase() + serverId.slice(1),
              enabled: true,
              transport: 'stdio',
              command: serverConfig.command as string,
              args: serverConfig.args as string[] | undefined,
              env: serverConfig.env as Record<string, string> | undefined,
            });
          }
        } else if (item && typeof item === 'object' && item.id) {
          // Flat format - already has id
          servers.push(item as MCPServerConfig);
        }
      }
      return servers;
    }

    return [];
  } catch (error) {
    console.warn('[MCP] Failed to parse MCP_SERVERS config:', error);
    return [];
  }
}

// Configuration - validated at startup via Zod schema
// Throws with clear error messages if invalid env values are provided
const validatedEnv = validateEnv();
const CONFIG = buildConfig(validatedEnv);

function createLLMProvider(provider: string, model: string): LLMProvider {
  switch (provider) {
    case 'google':
      if (!CONFIG.googleApiKey) {
        throw new Error('GOOGLE_API_KEY required for Google provider');
      }
      return new GoogleProvider(CONFIG.googleApiKey, model);

    case 'openai':
      if (!CONFIG.openaiApiKey) {
        throw new Error('OPENAI_API_KEY required for OpenAI provider');
      }
      return new OpenAIProvider(CONFIG.openaiApiKey, model);

    case 'azure_openai':
      if (!CONFIG.azureOpenaiApiKey || !CONFIG.azureOpenaiEndpoint) {
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required for Azure OpenAI provider');
      }
      return new AzureOpenAIProvider({
        apiKey: CONFIG.azureOpenaiApiKey,
        endpoint: CONFIG.azureOpenaiEndpoint,
        deploymentName: model,
        apiVersion: CONFIG.azureOpenaiApiVersion,
      });

    case 'anthropic':
    default:
      if (!CONFIG.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY required for Anthropic provider');
      }
      return new AnthropicProvider(CONFIG.anthropicApiKey, model);
  }
}

function createEmbeddingProvider() {
  switch (CONFIG.embeddingProvider) {
    case 'openai':
      if (!CONFIG.openaiApiKey) {
        throw new Error('OPENAI_API_KEY required for OpenAI embeddings');
      }
      return new OpenAIEmbeddingProvider(CONFIG.openaiApiKey);

    case 'azure_openai':
      if (!CONFIG.azureOpenaiApiKey || !CONFIG.azureOpenaiEndpoint) {
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required for Azure OpenAI embeddings');
      }
      return new AzureOpenAIEmbeddingProvider(
        CONFIG.azureOpenaiApiKey,
        CONFIG.azureOpenaiEndpoint,
        CONFIG.azureOpenaiApiVersion
      );

    case 'google':
    default:
      if (!CONFIG.googleApiKey) {
        return null; // RAG will be disabled
      }
      return new GoogleEmbeddingProvider(CONFIG.googleApiKey);
  }
}


async function main(): Promise<void> {
  // Install log buffer early so all boot logs are captured (before any console.log)
  const logBuffer = new LogBuffer();
  if (CONFIG.mcpServerEnabled) {
    logBuffer.install();
  }

  console.log(`${SUPERVISOR_ICON} ${SUPERVISOR_NAME} Starting...\n`);

  // Validate at least one API key is available
  const hasApiKey =
    CONFIG.anthropicApiKey ||
    CONFIG.googleApiKey ||
    CONFIG.openaiApiKey ||
    (CONFIG.azureOpenaiApiKey && CONFIG.azureOpenaiEndpoint);

  if (!hasApiKey) {
    console.error('Error: At least one LLM API key is required');
    console.error('Set one of: ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, or AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT');
    process.exit(1);
  }

  // Initialize database
  console.log('[Init] Initializing database...');
  await initDb(CONFIG.dbPath);
  ensureWellKnownConversations();

  // Initialize trace store for execution logging
  const traceStore = getTraceStore();
  traceStore.init();
  console.log('[Init] Trace store initialized');

  // Initialize LLM service with Main and Fast providers
  console.log('[Init] Initializing LLM service...');
  const mainProvider = createLLMProvider(CONFIG.mainProvider, CONFIG.mainModel);
  const fastProvider = createLLMProvider(CONFIG.fastProvider, CONFIG.fastModel);

  const userSettings = getUserSettingsService();

  const llmService = new LLMService({
    main: mainProvider,
    fast: fastProvider,
    traceStore,
    tokenReduction: LLMService.buildTokenReductionConfig(process.env),
  });
  await llmService.init();

  console.log(`[Init] Main LLM: ${CONFIG.mainProvider}/${CONFIG.mainModel}`);
  console.log(`[Init] Fast LLM: ${CONFIG.fastProvider}/${CONFIG.fastModel}`);

  // Initialize Memory Service and Skill Manager in parallel (both independent, file-based)
  console.log('[Init] Initializing memory service and skill manager...');
  const memoryService = new MemoryService(process.cwd());
  const skillManager = new SkillManager(CONFIG.skillsDir);
  await Promise.all([
    memoryService.init(),
    skillManager.init(),
  ]);
  console.log('[Init] Memory service and skill manager initialized');

  // Initialize MCP Client
  console.log('[Init] Initializing MCP client...');
  const mcpClient = new MCPClient();

  // Register MCP servers in parallel for faster startup
  const disabledMcps = userSettings.getDisabledMcps();
  const mcpServers = parseMCPServers(CONFIG.mcpServers);
  if (mcpServers.length > 0) {
    await Promise.all(
      mcpServers.map(async (serverConfig) => {
        try {
          if (disabledMcps.includes(serverConfig.id)) {
            serverConfig.enabled = false;
            console.log(`[Init] MCP server ${serverConfig.id} is disabled by user settings`);
          }
          await mcpClient.registerServer(serverConfig);
        } catch (error) {
          console.warn(`[Init] Failed to register MCP server ${serverConfig.id}:`, error);
        }
      })
    );
  }
  console.log(`[Init] Registered ${mcpClient.getServers().length} MCP servers`);

  // Initialize RAG Project Service (folder-based RAG with vector storage)
  let ragProjectService: RAGProjectService | null = null;
  const embeddingProvider = createEmbeddingProvider();
  if (embeddingProvider) {
    console.log(`[Init] Initializing RAG project service with ${CONFIG.embeddingProvider} embeddings...`);
    ragProjectService = new RAGProjectService(CONFIG.ragDir, embeddingProvider);
    await ragProjectService.init();

    // Set up summarization provider using fast LLM
    ragProjectService.setSummarizationProvider({
      async summarize(content: string, prompt: string): Promise<string> {
        const response = await llmService.quickGenerate([
          { role: 'user', content: `${prompt}\n\n${content}` },
        ], { maxTokens: 200 }, 'RAG Indexer');
        return response.content.trim();
      },
    });
    console.log('[Init] RAG summarization provider configured');
  } else {
    console.log('[Init] RAG project service disabled (no embedding provider configured)');
  }

  // Initialize Tool Runner
  console.log('[Init] Initializing tool runner...');
  const toolRunner = new ToolRunner({
    mcpClient,
    traceStore,
  });

  // Register native tools
  toolRunner.registerNativeTool(new WikipediaSearchTool());
  toolRunner.registerNativeTool(new HttpClientTool());
  toolRunner.registerNativeTool(new DelegateTool());

  // Web search (requires API key)
  if (CONFIG.webSearchApiKey) {
    // Google Custom Search requires searchEngineId
    if (CONFIG.webSearchProvider === 'google_custom_search' && !CONFIG.googleCustomSearchEngineId) {
      console.error('[Init] Web search disabled: google_custom_search provider requires GOOGLE_CUSTOM_SEARCH_ENGINE_ID');
      console.error('[Init] GOOGLE_CUSTOM_SEARCH_ENGINE_ID env value:', process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID ? '(set)' : '(not set)');
    } else {
      toolRunner.registerNativeTool(
        new WebSearchTool({
          provider: CONFIG.webSearchProvider,
          apiKey: CONFIG.webSearchApiKey,
          searchEngineId: CONFIG.googleCustomSearchEngineId || undefined,
        })
      );
      console.log(`[Init] Web search enabled (${CONFIG.webSearchProvider})`);
    }
  }

  // Web scraping (uses LLM for summarization)
  toolRunner.registerNativeTool(new WebScrapeTool({ llmService }));

  // Website crawler (display-only result — full URL list shown in UI, summary sent to LLM)
  // Passes RAG service to enable automatic content saving to RAG projects
  toolRunner.registerNativeTool(new WebsiteCrawlerTool({
    ragService: ragProjectService ?? undefined,
    ragDir: CONFIG.ragDir,
  }));

  toolRunner.registerNativeTool(new TakeScreenshotTool());

  // Image generation (requires API key based on provider)
  const imageApiKey = CONFIG.imageGenProvider === 'azure_openai'
    ? CONFIG.azureOpenaiApiKey
    : CONFIG.openaiApiKey;
  console.log(`[Init] Image generation: provider=${CONFIG.imageGenProvider}, hasApiKey=${!!imageApiKey}`);
  if (imageApiKey) {
    toolRunner.registerNativeTool(
      new CreateImageTool({
        apiKey: imageApiKey,
        provider: CONFIG.imageGenProvider,
        model: CONFIG.imageGenModel,
        azureEndpoint: CONFIG.azureOpenaiEndpoint,
        azureApiVersion: CONFIG.azureOpenaiApiVersion,
      })
    );
  } else {
    console.log('[Init] CreateImageTool not registered: no API key configured');
  }

  // Memory tool (always available)
  toolRunner.registerNativeTool(new RememberTool(memoryService));

  // Python tools (code generation and execution with Pyodide)
  toolRunner.registerNativeTool(new GeneratePythonTool({ llmService }));
  toolRunner.registerNativeTool(new RunPythonTool());
  console.log('[Init] Python tools enabled (generate_python + run_python with Plotly support)');

  // Speak tool (TTS - requires API key based on provider)
  const voiceApiKey = CONFIG.voiceProvider === 'azure_openai'
    ? CONFIG.azureOpenaiApiKey
    : CONFIG.openaiApiKey;
  if (voiceApiKey) {
    toolRunner.registerNativeTool(
      new SpeakTool({
        apiKey: voiceApiKey,
        provider: CONFIG.voiceProvider,
        model: CONFIG.voiceModel,
        voice: CONFIG.voiceVoice,
        azureEndpoint: CONFIG.azureOpenaiEndpoint,
        azureApiVersion: CONFIG.azureOpenaiApiVersion,
      })
    );
    console.log(`[Init] Speak tool enabled (provider: ${CONFIG.voiceProvider}, model: ${CONFIG.voiceModel}, voice: ${CONFIG.voiceVoice})`);
  } else {
    console.log('[Init] SpeakTool not registered: no API key configured for voice provider');
  }

  // Skill tools (for Agent Skills spec)
  toolRunner.registerNativeTool(new ReadAgentSkillTool(skillManager));
  toolRunner.registerNativeTool(new RunAgentSkillScriptTool(skillManager));

  // Self-modifying code tools (for frontend code modification)
  toolRunner.registerNativeTool(new ReadFrontendCodeTool());
  toolRunner.registerNativeTool(new ModifyFrontendCodeTool());
  toolRunner.registerNativeTool(new CheckFrontendCodeTool());
  console.log('[Init] Frontend code tools enabled (read + modify + check)');

  // Initialize Browser Session Manager
  console.log('[Init] Initializing browser session manager...');
  const browserConfig = loadBrowserConfig();
  const browserManager = new BrowserSessionManager({
    defaultConfig: browserConfig,
    llmService,
  });

  // Register browser tools
  toolRunner.registerNativeTool(new BrowserSessionTool(browserManager));
  toolRunner.registerNativeTool(new BrowserNavigateTool(browserManager));
  toolRunner.registerNativeTool(new BrowserActionTool(browserManager));
  toolRunner.registerNativeTool(new BrowserScreenshotTool(browserManager));
  console.log('[Init] Browser tools registered');

  // Initialize Desktop Session Manager
  console.log('[Init] Initializing desktop session manager...');
  const desktopManager = new DesktopSessionManager();

  // Register desktop tools
  toolRunner.registerNativeTool(new DesktopSessionTool(desktopManager));
  toolRunner.registerNativeTool(new DesktopActionTool(desktopManager));
  toolRunner.registerNativeTool(new DesktopScreenshotTool(desktopManager));
  console.log('[Init] Desktop tools registered');

  // Register RAG project query tool (if service is available)
  if (ragProjectService) {
    toolRunner.registerNativeTool(new QueryRAGProjectTool(ragProjectService));
    console.log('[Init] RAG query tool registered');
  }

  // Initialize User Tool Manager (watches user/tools for .md tool definitions)
  console.log('[Init] Initializing user tool manager...');
  const userToolManager = new UserToolManager({
    toolsDir: CONFIG.userToolsDir,
    llmService,
  });
  await userToolManager.init();

  // Register user-defined tools
  for (const tool of userToolManager.getToolsForRegistration()) {
    toolRunner.registerUserTool(tool);
  }

  // Hot-reload: re-register tools when they change
  userToolManager.on('tool:updated', (definition) => {
    const tool = userToolManager.getTool(definition.name);
    if (tool) {
      toolRunner.registerUserTool(tool);
      console.log(`[UserTool] Hot-reloaded: ${definition.name}`);
    }
  });

  userToolManager.on('tool:added', (definition) => {
    const tool = userToolManager.getTool(definition.name);
    if (tool) {
      toolRunner.registerUserTool(tool);
      console.log(`[UserTool] Registered new tool: ${definition.name}`);
    }
  });

  console.log(`[Init] Tool runner initialized with ${toolRunner.getToolsForLLM().length} tools`);

  // Initialize Task Manager and Mission Manager in parallel (both file-based, independent)
  console.log('[Init] Initializing task and mission managers...');
  initMissionSchema();
  const taskManager = new TaskManager({
    tasksDir: CONFIG.tasksDir,
    llmService,
  });
  const missionManager = new MissionManager({
    missionsDir: CONFIG.missionsDir,
    llmService,
  });
  await Promise.all([
    taskManager.init(),
    missionManager.init(),
  ]);
  console.log('[Init] Task and mission managers initialized');

  // Validate all well-known mission conversations exist (non-blocking)
  validateMissionConversations();

  // Register mission tools (requires mission manager)
  toolRunner.registerNativeTool(new MissionTodoCreateTool(missionManager));
  toolRunner.registerNativeTool(new MissionTodoUpdateTool(missionManager));
  toolRunner.registerNativeTool(new MissionTodoCompleteTool(missionManager));
  toolRunner.registerNativeTool(new MissionMetricRecordTool(missionManager));
  console.log('[Init] Mission tools registered (todo_create, todo_update, todo_complete, metric_record)');

  // Register turn TODO tools (supervisor-only task planning)
  const turnTodoRepository = new TurnTodoRepository();
  toolRunner.registerNativeTool(new TurnTodoCreateTool(turnTodoRepository));
  toolRunner.registerNativeTool(new TurnTodoListTool(turnTodoRepository));
  toolRunner.registerNativeTool(new TurnTodoCompleteTool(turnTodoRepository));
  console.log('[Init] Turn TODO tools registered (create_todo, list_todo, complete_todo)');

  // Create supervisor agent (multi-agent architecture)
  console.log('[Init] Creating supervisor agent...');
  const registry = getAgentRegistry();
  const supervisor = new SupervisorAgentImpl(llmService, registry);

  // Set tool runner, memory service, and skill manager on supervisor
  supervisor.setToolRunner(toolRunner);
  supervisor.setMemoryService(memoryService);
  supervisor.setSkillManager(skillManager);
  // Exclude builtin skills from supervisor - these are for specialists only
  supervisor.setExcludedSkillSources(['builtin']);

  // Set RAG data manager on supervisor (if RAG service is available)
  if (ragProjectService) {
    const ragDataManager = new RagDataManager(ragProjectService);
    supervisor.setRagDataManager(ragDataManager);
    console.log('[Init] RAG data manager configured');
  }

  // Register with global agent registry
  registry.registerAgent(supervisor);

  // Initialize supervisor
  await supervisor.init();

  // Determine mode based on command line args
  const mode = process.argv[2] || 'server';

  if (mode === 'console') {
    // Console mode - CLI interface
    console.log('[Init] Starting in console mode...');
    const consoleChannel = new ConsoleChannel();

    // Navigation state for console UI - tracks which conversation the user is viewing
    // This is separate from supervisor's request-scoped conversation handling
    const navigationState = {
      currentConversationId: null as string | null,
    };

    // Wire up conversation provider for console commands
    consoleChannel.setConversationProvider({
      listConversations: (limit = 20) => {
        const db = getDb();
        return db.conversations.findAll({ limit });
      },
      getMessages: (conversationId: string, limit = 10) => {
        const db = getDb();
        const messages = db.messages.findByConversationId(conversationId, { limit: 100 });
        // Return last N messages (findByConversationId returns oldest first)
        return messages.slice(-limit).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
      },
      getCurrentConversationId: () => navigationState.currentConversationId,
      setConversationId: (id) => { navigationState.currentConversationId = id; },
      startNewConversation: () => { navigationState.currentConversationId = null; },
    });

    // Wire up system provider for tasks, tools, MCP
    consoleChannel.setSystemProvider({
      getTasks: () => taskManager.getTasksForApi(),
      getTools: () => {
        const tools = toolRunner.getToolsForLLM();
        const mcpServers = mcpClient?.getServers() || [];
        const serverNames: Record<string, string> = {};
        for (const server of mcpServers) {
          serverNames[server.id] = server.name;
        }

        const builtin: Array<{ name: string; description: string }> = [];
        const user: Array<{ name: string; description: string }> = [];
        const mcp: Record<string, Array<{ name: string; description: string }>> = {};

        for (const tool of tools) {
          const toolName = tool.name;
          if (toolName.startsWith('user.')) {
            user.push({
              name: toolName.replace('user.', ''),
              description: tool.description,
            });
          } else if (toolName.startsWith('mcp.')) {
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
            });
          } else {
            // No prefix = native/builtin tool
            builtin.push({
              name: toolName,
              description: tool.description,
            });
          }
        }
        return { builtin, user, mcp };
      },
      getMcpServers: () => {
        if (!mcpClient) return [];
        const servers = mcpClient.getServers();
        const tools = mcpClient.getTools();
        return servers.map(server => ({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          transport: server.transport || (server.command ? 'stdio' : 'http'),
          toolCount: tools.filter(t => t.serverId === server.id).length,
        }));
      },
    });

    await consoleChannel.init();
    supervisor.registerChannel(consoleChannel);

    // Listen for scheduled tasks in console mode too
    taskManager.on('task:due', async ({ task }) => {
      console.log(`\n[Scheduler] Running scheduled task: ${task.name}`);
      try {
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';
        const taskTools = (task.jsonConfig as { tools?: Array<{ type: string }> }).tools || [];
        // Extract tool names from tools array
        const allowedToolNames = taskTools
          .map(t => typeof t === 'string' ? t : t.type)
          .filter(Boolean);

        // Create a task message for the supervisor
        const taskMessage = {
          id: crypto.randomUUID(),
          channel: consoleChannel.id,
          role: 'user' as const,
          content: `[Scheduled Task] Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            scheduled: true,
            conversationId: WellKnownConversations.FEED,
            // Only allow tools specified in task config (empty = no tool restrictions)
            allowedTools: allowedToolNames.length > 0 ? allowedToolNames : undefined,
          },
        };

        taskManager.markTaskExecuted(task.id);
        await supervisor.handleMessage(taskMessage);
      } catch (error) {
        console.error(`[Scheduler] Error running scheduled task "${task.name}":`, error);
      }
    });

    // Start the task scheduler
    taskManager.startScheduler();
  } else {
    // Server mode - HTTP + WebSocket
    console.log('[Init] Starting in server mode...');
    const server = new AssistantServer({
      port: CONFIG.port,
      supervisor,
      mcpClient,
      skillManager,
      toolRunner,
      llmService,
      browserManager,
      desktopManager,
      taskManager,
      missionManager,
      ragProjectService: ragProjectService || undefined,
      traceStore,
      mainProvider: CONFIG.mainProvider,
      mainModel: CONFIG.mainModel,
      voiceProvider: CONFIG.voiceProvider,
      voiceModel: CONFIG.voiceModel,
      azureOpenaiApiKey: CONFIG.azureOpenaiApiKey,
      azureOpenaiEndpoint: CONFIG.azureOpenaiEndpoint,
      azureOpenaiApiVersion: CONFIG.azureOpenaiApiVersion,
      openaiApiKey: CONFIG.openaiApiKey,
      // MCP Server configuration
      mcpServerEnabled: CONFIG.mcpServerEnabled,
      mcpServerSecret: CONFIG.mcpServerSecret,
      mcpServerAuthDisabled: CONFIG.mcpServerAuthDisabled,
      logBuffer,
      fastProvider: CONFIG.fastProvider,
      fastModel: CONFIG.fastModel,
    });
    await server.start();

    // Listen for scheduled tasks that are due
    taskManager.on('task:due', async ({ task }) => {
      console.log(`[Scheduler] Running scheduled task: ${task.name}`);
      try {
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';
        const taskTools = (task.jsonConfig as { tools?: Array<{ type: string }> }).tools || [];
        // Extract tool names from tools array
        const allowedToolNames = taskTools
          .map(t => typeof t === 'string' ? t : t.type)
          .filter(Boolean);

        // Create a task message for the supervisor
        // Route to the well-known `feed` conversation for background tasks
        const taskMessage = {
          id: crypto.randomUUID(),
          channel: 'web-main',  // Use web channel so responses are visible in UI
          role: 'user' as const,
          content: `[Scheduled Task] Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            scheduled: true,
            conversationId: WellKnownConversations.FEED,  // Route to feed conversation
            // Only allow tools specified in task config (empty = no tool restrictions)
            allowedTools: allowedToolNames.length > 0 ? allowedToolNames : undefined,
          },
        };

        // Mark the task as executed (updates lastRun and nextRun)
        taskManager.markTaskExecuted(task.id);

        // Send to supervisor
        await supervisor.handleMessage(taskMessage);
      } catch (error) {
        console.error(`[Scheduler] Error running scheduled task "${task.name}":`, error);
      }
    });

    // Start the task scheduler (after event listeners are set up)
    taskManager.startScheduler();

    console.log(`
✅ ${SUPERVISOR_NAME} ready!

  🌐 Web UI:     http://localhost:${CONFIG.port}
  📡 WebSocket:  ws://localhost:${CONFIG.port}
  📚 API:        http://localhost:${CONFIG.port}/api

  📁 Config:     ${CONFIG.tasksDir}
  🗄️ Database:   ${CONFIG.dbPath}
  🧠 Main LLM:   ${CONFIG.mainProvider}/${CONFIG.mainModel}
  ⚡ Fast LLM:   ${CONFIG.fastProvider}/${CONFIG.fastModel}
     Img Gen:    ${CONFIG.imageGenProvider}/${CONFIG.imageGenModel}
     Voice:      ${CONFIG.voiceProvider}/${CONFIG.voiceModel}
  Deep Research: ${CONFIG.deepResearchProvider}/${CONFIG.deepResearchModel} 

  ${SUPERVISOR_ICON} Supervisor: ${supervisor.identity.emoji} ${supervisor.identity.name}
`);
  }

  // Handle shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n[Shutdown] Gracefully shutting down...');
    await registry.shutdown();
    await browserManager.shutdown();
    await desktopManager.closeAllSessions();
    await taskManager.close();
    await missionManager.close();
    await userToolManager.close();
    await skillManager.close();
    if (ragProjectService) {
      await ragProjectService.close();
    }
    await closeDb();
    console.log('[Shutdown] Complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
