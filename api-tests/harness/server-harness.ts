/**
 * API Test Server Harness
 *
 * Boots a real AssistantServer with all production components:
 *   - In-memory SQLite database (no disk I/O, fast reset)
 *   - Dynamic port allocation (port 0 → OS picks a free port)
 *   - Dependency simulator from e2e/simulators (no outbound network calls)
 *   - Real SupervisorAgentImpl backed by SimulatorLLMProvider
 *   - Real ToolRunner with all native tools registered
 *   - Real MemoryService, SkillManager, TaskManager, MissionManager, UserToolManager
 *   - Real RAGProjectService with simulator-backed embedding provider
 *
 * Only external network services are stubbed (LLM APIs, search APIs, etc.)
 * via the SimulatorServer. Everything that runs within Node is real.
 *
 * Usage in tests:
 *   const harness = new ServerHarness();
 *   beforeAll(() => harness.start());
 *   afterEach(() => harness.reset());
 *   afterAll(() => harness.stop());
 */

import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { ensureWellKnownConversations } from '../../src/db/well-known-conversations.js';
import { AssistantServer } from '../../src/server/index.js';
import type { ServerConfig } from '../../src/server/index.js';
import { endpoints } from '../../src/config/endpoint-manager.js';
import { SimulatorServer } from '../../e2e/simulators/server.js';
import { LLMService } from '../../src/llm/service.js';
import {
  ToolRunner,
  WebSearchTool,
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
} from '../../src/tools/index.js';
import {
  ReadFrontendCodeTool,
  ModifyFrontendCodeTool,
  CheckFrontendCodeTool,
} from '../../src/self-coding/index.js';
import { MissionManager } from '../../src/missions/manager.js';
import { initMissionSchema } from '../../src/missions/schema.js';
import { getDashboardStore } from '../../src/dashboard/index.js';
import { TraceStore } from '../../src/tracing/trace-store.js';
import { MemoryService } from '../../src/memory/index.js';
import { SkillManager } from '../../src/skills/index.js';
import { TaskManager } from '../../src/tasks/index.js';
import { UserToolManager } from '../../src/tools/user/index.js';
import {
  RAGProjectService,
  OpenAIEmbeddingProvider,
  RagDataManager,
} from '../../src/rag-projects/index.js';
import { MCPClient } from '../../src/mcp/index.js';
import { SupervisorAgentImpl } from '../../src/agents/supervisor.js';
import { AgentRegistry } from '../../src/agents/registry.js';
import { SimulatorLLMProvider } from './simulator-llm-provider.js';
import { ApiClient } from './api-client.js';
import { WsClient } from './ws-client.js';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Port Allocation
// ---------------------------------------------------------------------------

/** Ask the OS for a free TCP port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Failed to get free port'));
      }
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Server Harness
// ---------------------------------------------------------------------------

export class ServerHarness {
  private server: AssistantServer | null = null;
  private simulatorServer: SimulatorServer | null = null;
  private _port = 0;
  private _simulatorPort = 0;

  // Real services
  private _llmService: LLMService | null = null;
  private _toolRunner: ToolRunner | null = null;
  private _missionManager: MissionManager | null = null;
  private _traceStore: TraceStore | null = null;
  private _memoryService: MemoryService | null = null;
  private _skillManager: SkillManager | null = null;
  private _taskManager: TaskManager | null = null;
  private _userToolManager: UserToolManager | null = null;
  private _ragProjectService: RAGProjectService | null = null;
  private _mcpClient: MCPClient | null = null;

  // Temp directory (single root for all file-based services)
  private _tempDir: string | null = null;

  /** The dynamic port the server is listening on. */
  get port(): number { return this._port; }

  /** Base URL for HTTP requests (e.g. `http://127.0.0.1:54321`). */
  get baseUrl(): string { return `http://127.0.0.1:${this._port}`; }

  /** WebSocket URL (e.g. `ws://127.0.0.1:54321`). */
  get wsUrl(): string { return `ws://127.0.0.1:${this._port}`; }

  /** Simulator base URL (e.g. `http://localhost:54322`). */
  get simulatorUrl(): string { return `http://localhost:${this._simulatorPort}`; }

  /** Access the dependency simulator server for configuring responses. */
  get simulator() { return this.simulatorServer!; }

  /** Access real services for direct assertions in tests. */
  get llmService() { return this._llmService!; }
  get toolRunner() { return this._toolRunner!; }
  get missionManager() { return this._missionManager!; }
  get traceStore() { return this._traceStore!; }
  get memoryService() { return this._memoryService!; }
  get skillManager() { return this._skillManager!; }
  get taskManager() { return this._taskManager!; }

  /** Create an ApiClient bound to this harness's base URL. */
  api(): ApiClient { return new ApiClient(this.baseUrl); }

  /** Create a WsClient bound to this harness's WebSocket URL. */
  ws(): WsClient { return new WsClient(this.wsUrl); }

  /**
   * Boot the server with all real production components.
   *
   * Only external network services are stubbed via the SimulatorServer.
   * Everything that runs within Node.js is the real implementation.
   */
  async start(): Promise<void> {
    // 1. Dependency simulator (LLM, search, embedding, etc.)
    this._simulatorPort = await getFreePort();
    this.simulatorServer = new SimulatorServer();
    await this.simulatorServer.start(this._simulatorPort);

    // 2. Route all external service calls through the simulator
    endpoints.enableTestMode(this.simulatorUrl);

    // 3. In-memory database with all schemas
    await closeDb().catch(() => {});
    await initDb(':memory:');
    ensureWellKnownConversations();
    initMissionSchema();
    getDashboardStore().init();

    // 4. Trace store
    this._traceStore = new TraceStore();
    this._traceStore.init();

    // 5. LLM Service (SimulatorLLMProvider → SimulatorServer)
    const provider = new SimulatorLLMProvider(this.simulatorUrl);
    this._llmService = new LLMService({
      main: provider,
      fast: provider,
      traceStore: this._traceStore,
    });

    // 6. Create temp directory tree for all file-based services
    this._tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olliebot-test-'));
    const dirs = {
      missions: path.join(this._tempDir, 'missions'),
      tasks: path.join(this._tempDir, 'tasks'),
      skills: path.join(this._tempDir, 'skills'),
      tools: path.join(this._tempDir, 'tools'),
      memory: path.join(this._tempDir, 'memory'),
      rag: path.join(this._tempDir, 'rag'),
      evaluations: path.join(this._tempDir, 'evaluations'),
      results: path.join(this._tempDir, 'evaluations', 'results'),
    };
    for (const dir of Object.values(dirs)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 7. Memory Service (real, temp dir)
    this._memoryService = new MemoryService(this._tempDir);
    await this._memoryService.init();

    // 8. Skill Manager (real, temp dir for user skills — builtin skills loaded from source)
    this._skillManager = new SkillManager(dirs.skills);
    await this._skillManager.init();

    // 9. MCP Client (real, empty — no external MCP servers in tests)
    this._mcpClient = new MCPClient();

    // 10. RAG Project Service (real, with simulator-backed embedding provider)
    const embeddingProvider = new OpenAIEmbeddingProvider(
      'test-api-key',
      'text-embedding-3-small',
      `${this.simulatorUrl}/embedding/v1`,
    );
    this._ragProjectService = new RAGProjectService(dirs.rag, embeddingProvider);
    await this._ragProjectService.init();
    this._ragProjectService.setSummarizationProvider({
      summarize: async (content: string, prompt: string): Promise<string> => {
        const response = await this._llmService!.quickGenerate([
          { role: 'user', content: `${prompt}\n\n${content}` },
        ], { maxTokens: 200 }, 'RAG Indexer');
        return response.content.trim();
      },
    });

    // 11. Tool Runner with all native tools (mirrors src/index.ts registration)
    this._toolRunner = new ToolRunner({
      mcpClient: this._mcpClient,
      traceStore: this._traceStore,
    });

    this._toolRunner.registerNativeTool(new WikipediaSearchTool());
    this._toolRunner.registerNativeTool(new HttpClientTool());
    this._toolRunner.registerNativeTool(new DelegateTool());
    this._toolRunner.registerNativeTool(new WebSearchTool({
      provider: 'serper',
      apiKey: 'test-api-key',
    }));
    this._toolRunner.registerNativeTool(new WebScrapeTool({ llmService: this._llmService }));
    this._toolRunner.registerNativeTool(new WebsiteCrawlerTool({
      ragService: this._ragProjectService,
      ragDir: dirs.rag,
    }));
    this._toolRunner.registerNativeTool(new TakeScreenshotTool());
    this._toolRunner.registerNativeTool(new CreateImageTool({
      apiKey: 'test-api-key',
      provider: 'openai',
      model: 'dall-e-3',
    }));
    this._toolRunner.registerNativeTool(new RememberTool(this._memoryService));
    this._toolRunner.registerNativeTool(new GeneratePythonTool({ llmService: this._llmService }));
    this._toolRunner.registerNativeTool(new RunPythonTool());
    this._toolRunner.registerNativeTool(new SpeakTool({
      apiKey: 'test-api-key',
      provider: 'openai',
      model: 'tts-1',
      voice: 'alloy',
    }));
    this._toolRunner.registerNativeTool(new ReadAgentSkillTool(this._skillManager));
    this._toolRunner.registerNativeTool(new RunAgentSkillScriptTool(this._skillManager));
    this._toolRunner.registerNativeTool(new ReadFrontendCodeTool());
    this._toolRunner.registerNativeTool(new ModifyFrontendCodeTool());
    this._toolRunner.registerNativeTool(new CheckFrontendCodeTool());
    this._toolRunner.registerNativeTool(new QueryRAGProjectTool(this._ragProjectService));

    // 12. User Tool Manager (real, watches temp dir — starts empty)
    this._userToolManager = new UserToolManager({
      toolsDir: dirs.tools,
      llmService: this._llmService,
    });
    await this._userToolManager.init();
    for (const tool of this._userToolManager.getToolsForRegistration()) {
      this._toolRunner.registerUserTool(tool);
    }

    // 13. Task Manager (real, temp dir, scheduler disabled)
    this._taskManager = new TaskManager({
      tasksDir: dirs.tasks,
      llmService: this._llmService,
      schedulerInterval: 999_999,
    });
    await this._taskManager.init();

    // 14. Mission Manager (real, temp dir, scheduler disabled)
    this._missionManager = new MissionManager({
      missionsDir: dirs.missions,
      llmService: this._llmService,
      schedulerInterval: 999_999,
    });
    await this._missionManager.init();

    // Register mission tools (depends on mission manager)
    this._toolRunner.registerNativeTool(new MissionTodoCreateTool(this._missionManager));
    this._toolRunner.registerNativeTool(new MissionTodoUpdateTool(this._missionManager));
    this._toolRunner.registerNativeTool(new MissionTodoCompleteTool(this._missionManager));
    this._toolRunner.registerNativeTool(new MissionMetricRecordTool(this._missionManager));

    // 15. Real Supervisor Agent
    const registry = new AgentRegistry();
    const supervisor = new SupervisorAgentImpl(this._llmService, registry);
    supervisor.setToolRunner(this._toolRunner);
    supervisor.setMemoryService(this._memoryService);
    supervisor.setSkillManager(this._skillManager);
    supervisor.setExcludedSkillSources(['builtin']);

    const ragDataManager = new RagDataManager(this._ragProjectService);
    supervisor.setRagDataManager(ragDataManager);

    registry.registerAgent(supervisor);
    await supervisor.init();

    // 16. Server with all dependencies
    this._port = await getFreePort();
    const config: ServerConfig = {
      port: this._port,
      supervisor,
      bindAddress: '127.0.0.1',
      allowedOrigins: ['*'],
      llmService: this._llmService,
      toolRunner: this._toolRunner,
      missionManager: this._missionManager,
      traceStore: this._traceStore,
      skillManager: this._skillManager,
      taskManager: this._taskManager,
      ragProjectService: this._ragProjectService,
      evaluationsDir: dirs.evaluations,
      resultsDir: dirs.results,
    };

    this.server = new AssistantServer(config);
    await this.server.start();
  }

  /**
   * Reset test state by clearing all database tables and simulator logs.
   * Much faster than tearing down and re-creating the entire server.
   */
  async reset(): Promise<void> {
    // Disconnect all WebSocket clients to ensure clean state
    if (this.server) {
      this.server.disconnectAllClients();
    }

    const db = getDb();
    db.rawExec('DELETE FROM pillar_metric_history');
    db.rawExec('DELETE FROM pillar_strategies');
    db.rawExec('DELETE FROM mission_todos');
    db.rawExec('DELETE FROM pillar_metrics');
    db.rawExec('DELETE FROM pillars');
    db.rawExec('DELETE FROM missions');
    db.rawExec('DELETE FROM dashboard_snapshots');

    // Clear trace tables (reverse dependency order)
    db.rawExec('DELETE FROM token_reductions');
    db.rawExec('DELETE FROM tool_calls');
    db.rawExec('DELETE FROM llm_calls');
    db.rawExec('DELETE FROM trace_spans');
    db.rawExec('DELETE FROM traces');

    // Clear core tables
    db.rawExec('DELETE FROM messages');
    db.rawExec('DELETE FROM embeddings');
    db.rawExec('DELETE FROM conversations');

    // Re-seed well-known conversations
    ensureWellKnownConversations();

    // Reset simulator request logs
    if (this.simulatorServer) {
      this.simulatorServer.reset();
    }
  }

  /**
   * Gracefully stop the server, simulator, close managers, and clean up.
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
    if (this.simulatorServer) {
      await this.simulatorServer.stop();
      this.simulatorServer = null;
    }

    // Close file-watching managers
    await this._taskManager?.close().catch(() => {});
    await this._missionManager?.close().catch(() => {});
    await this._userToolManager?.close().catch(() => {});
    await this._skillManager?.close().catch(() => {});
    await this._ragProjectService?.close().catch(() => {});

    // Reset endpoint overrides
    endpoints.reset();
    await closeDb().catch(() => {});

    // Clean up temp directory
    if (this._tempDir) {
      fs.rmSync(this._tempDir, { recursive: true, force: true });
      this._tempDir = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Seed Helpers (for use in tests that need mission data)
// ---------------------------------------------------------------------------

export interface SeedMissionData {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  status?: 'active' | 'paused' | 'archived';
  cadence?: string;
}

export interface SeedPillarData {
  id?: string;
  missionId: string;
  slug: string;
  name: string;
  description?: string;
}

export interface SeedMetricData {
  id?: string;
  pillarId: string;
  slug: string;
  name: string;
  type?: string;
  unit?: string;
  current?: number;
}

export interface SeedTodoData {
  id?: string;
  pillarId: string;
  missionId: string;
  title: string;
  status?: string;
  priority?: string;
}

export function seedMission(data: SeedMissionData) {
  const db = getDb();
  const id = data.id ?? `m-${data.slug}`;
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO missions (id, slug, name, description, status, mdFile, jsonConfig, conversationId, cadence, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.slug, data.name, data.description ?? '', data.status ?? 'active',
     `${data.slug}.md`, '{}', `conv-${data.slug}`, data.cadence ?? null, now, now],
  );
  return id;
}

export function seedPillar(data: SeedPillarData) {
  const db = getDb();
  const id = data.id ?? `p-${data.slug}`;
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO pillars (id, missionId, slug, name, description, status, conversationId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.missionId, data.slug, data.name, data.description ?? '',
     'active', `conv-${data.slug}`, now, now],
  );
  return id;
}

export function seedMetric(data: SeedMetricData) {
  const db = getDb();
  const id = data.id ?? `met-${data.slug}`;
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO pillar_metrics (id, pillarId, slug, name, type, unit, current, target, trend, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.pillarId, data.slug, data.name, data.type ?? 'numeric',
     data.unit ?? '', data.current ?? null, '{}', 'unknown', now],
  );
  return id;
}

export function seedTodo(data: SeedTodoData) {
  const db = getDb();
  const id = data.id ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO mission_todos (id, pillarId, missionId, title, description, justification, completionCriteria, status, priority, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.pillarId, data.missionId, data.title, '', '', '',
     data.status ?? 'pending', data.priority ?? 'medium', now],
  );
  return id;
}
