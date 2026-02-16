/**
 * API Test Server Harness
 *
 * Boots a real AssistantServer with:
 *   - In-memory SQLite database (no disk I/O, fast reset)
 *   - Dynamic port allocation (port 0 → OS picks a free port)
 *   - Dependency simulator from e2e/simulators (no outbound network calls)
 *   - Stub supervisor (no LLM calls, but messages flow through the real server)
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
import type { SupervisorAgent } from '../../src/agents/types.js';
import type { Channel, Message } from '../../src/channels/types.js';
import { endpoints } from '../../src/config/endpoint-manager.js';
import { SimulatorServer } from '../../e2e/simulators/server.js';
import { LLMService } from '../../src/llm/service.js';
import { ToolRunner } from '../../src/tools/runner.js';
import { MissionManager } from '../../src/missions/manager.js';
import { initMissionSchema } from '../../src/missions/schema.js';
import { getDashboardStore } from '../../src/dashboard/index.js';
import { SimulatorLLMProvider } from './simulator-llm-provider.js';
import { ApiClient } from './api-client.js';
import { WsClient } from './ws-client.js';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Stub Supervisor
// ---------------------------------------------------------------------------

/**
 * Minimal supervisor that satisfies the SupervisorAgent interface
 * without making any LLM calls. Captures messages for assertion.
 */
export function createStubSupervisor(): SupervisorAgent & { receivedMessages: Message[] } {
  const receivedMessages: Message[] = [];
  let channel: Channel | null = null;

  const identity = {
    id: 'supervisor-stub',
    name: 'Supervisor',
    emoji: '🤖',
    role: 'supervisor' as const,
    description: 'Stub supervisor for API tests',
  };

  const state = {
    status: 'idle' as const,
    lastActivity: new Date(),
    context: {},
  };

  const capabilities = {
    canSpawnAgents: true,
    canAccessTools: [],
    canUseChannels: ['web'],
    maxConcurrentTasks: 1,
  };

  const config = {
    identity,
    capabilities,
    systemPrompt: 'You are a test stub.',
  };

  return {
    receivedMessages,
    identity,
    state,
    capabilities,
    config,

    // Lifecycle
    async init() {},
    async shutdown() {},

    // Communication — capture messages instead of calling LLM
    async handleMessage(message: Message) {
      receivedMessages.push(message);

      // Echo back a simple response so WS tests can observe server-side streaming
      if (channel) {
        const streamId = `stream-${Date.now()}`;
        const conversationId = (message.metadata?.conversationId as string) ?? undefined;
        channel.startStream(streamId, { conversationId });
        channel.sendStreamChunk(streamId, 'stub-response', conversationId);
        channel.endStream(streamId, { conversationId });
      }
    },
    async sendMessage() {},
    async sendError() {},

    // Inter-agent communication (no-op)
    async receiveFromAgent() {},
    async sendToAgent() {},

    // State
    getState() { return state; },
    updateState(updates) { Object.assign(state, updates); },

    // Sub-agent management
    async spawnAgent() { return 'stub-agent-1'; },
    async terminateAgent() {},
    getSubAgents() { return []; },

    // Task delegation
    async delegateTask(task: string) {
      return {
        id: 'task-stub-1',
        description: task,
        assignedTo: 'stub-agent-1',
        assignedBy: identity.id,
        status: 'completed' as const,
        createdAt: new Date(),
      };
    },
    getTaskStatus() { return undefined; },

    // Channel management
    registerChannel(ch: Channel) {
      channel = ch;
      // Install ourselves as the message handler so WS messages flow through.
      // In the real server this routing is installed by the mission-lead code path;
      // the stub must set it up explicitly.
      ch.onMessage(async (message) => {
        receivedMessages.push(message);

        // Echo back a simple response so WS tests can observe streaming
        const streamId = `stream-${Date.now()}`;
        const cid = (message.metadata?.conversationId as string) ?? undefined;
        ch.startStream(streamId, { conversationId: cid });
        ch.sendStreamChunk(streamId, 'stub-response', cid);
        ch.endStream(streamId, { conversationId: cid });
      });
    },
  };
}

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
  private _supervisor: ReturnType<typeof createStubSupervisor> | null = null;

  /** The dynamic port the server is listening on. */
  get port(): number { return this._port; }

  /** Base URL for HTTP requests (e.g. `http://127.0.0.1:54321`). */
  get baseUrl(): string { return `http://127.0.0.1:${this._port}`; }

  /** WebSocket URL (e.g. `ws://127.0.0.1:54321`). */
  get wsUrl(): string { return `ws://127.0.0.1:${this._port}`; }

  /** Simulator base URL (e.g. `http://localhost:54322`). */
  get simulatorUrl(): string { return `http://localhost:${this._simulatorPort}`; }

  /** Access the stub supervisor to inspect captured messages. */
  get supervisor() { return this._supervisor!; }

  /** Access the dependency simulator server for configuring responses. */
  get simulator() { return this.simulatorServer!; }

  /** Create an ApiClient bound to this harness's base URL. */
  api(): ApiClient { return new ApiClient(this.baseUrl); }

  /** Create a WsClient bound to this harness's WebSocket URL. */
  ws(): WsClient { return new WsClient(this.wsUrl); }

  /**
   * Boot the server:
   *  1. Start the dependency simulator on a dynamic port
   *  2. Route all external service endpoints through the simulator
   *  3. Init in-memory SQLite
   *  4. Seed well-known conversations
   *  5. Pick a free port for the app server
   *  6. Start AssistantServer
   */
  async start(): Promise<void> {
    // 1. Dependency simulator (LLM, search, embedding, etc.)
    this._simulatorPort = await getFreePort();
    this.simulatorServer = new SimulatorServer();
    await this.simulatorServer.start(this._simulatorPort);

    // 2. Route all external service calls through the simulator
    endpoints.enableTestMode(this.simulatorUrl);

    // 3. In-memory database
    await closeDb().catch(() => {});
    await initDb(':memory:');
    ensureWellKnownConversations();

    // 4. Free port for the app server
    this._port = await getFreePort();

    // 5. Stub supervisor
    this._supervisor = createStubSupervisor();

    // 6. Server
    const config: ServerConfig = {
      port: this._port,
      supervisor: this._supervisor,
      bindAddress: '127.0.0.1',
      allowedOrigins: ['*'],
    };

    this.server = new AssistantServer(config);
    await this.server.start();
  }

  /**
   * Reset test state by clearing all database tables and simulator logs.
   * Much faster than tearing down and re-creating the entire server.
   */
  async reset(): Promise<void> {
    const db = getDb();
    // Clear in reverse dependency order
    db.rawExec('DELETE FROM messages');
    db.rawExec('DELETE FROM embeddings');
    db.rawExec('DELETE FROM conversations');

    // Re-seed well-known conversations
    ensureWellKnownConversations();

    // Clear captured messages on the stub supervisor
    if (this._supervisor) {
      this._supervisor.receivedMessages.length = 0;
    }

    // Reset simulator request logs
    if (this.simulatorServer) {
      this.simulatorServer.reset();
    }
  }

  /**
   * Gracefully stop the server, simulator, and close the database.
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
    // Reset endpoint overrides so other test suites aren't affected
    endpoints.reset();
    await closeDb().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Full Server Harness (with LLMService, ToolRunner, MissionManager)
// ---------------------------------------------------------------------------

/**
 * Extended harness that boots the server with real LLMService, ToolRunner,
 * and MissionManager instances. The LLMService is backed by the
 * SimulatorLLMProvider so all LLM calls are absorbed by the simulator.
 *
 * This enables testing of eval-routes and mission-routes which require
 * these dependencies to be wired into the server.
 */
export class FullServerHarness extends ServerHarness {
  private _llmService: LLMService | null = null;
  private _toolRunner: ToolRunner | null = null;
  private _missionManager: MissionManager | null = null;
  private _missionsDir: string | null = null;

  get llmService() { return this._llmService!; }
  get toolRunner() { return this._toolRunner!; }
  get missionManager() { return this._missionManager!; }

  async start(): Promise<void> {
    // 1. Dependency simulator
    this['_simulatorPort'] = await getFreePort();
    this['simulatorServer'] = new SimulatorServer();
    await this['simulatorServer'].start(this['_simulatorPort']);

    // 2. Route all external service calls through the simulator
    endpoints.enableTestMode(this.simulatorUrl);

    // 3. In-memory database
    await closeDb().catch(() => {});
    await initDb(':memory:');
    ensureWellKnownConversations();

    // 4. Mission schema (creates missions, pillars, metrics, etc. tables)
    initMissionSchema();

    // 4b. Dashboard schema (required by mission-routes dashboard endpoints)
    getDashboardStore().init();

    // 5. LLM provider backed by simulator
    const provider = new SimulatorLLMProvider(this.simulatorUrl);
    this._llmService = new LLMService({
      main: provider,
      fast: provider,
    });

    // 6. Tool runner (no tools registered — routes return empty)
    this._toolRunner = new ToolRunner();

    // 7. Mission manager with a temporary directory
    this._missionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olliebot-missions-'));
    this._missionManager = new MissionManager({
      missionsDir: this._missionsDir,
      llmService: this._llmService,
      schedulerInterval: 999_999, // Don't auto-schedule in tests
    });
    await this._missionManager.init();

    // 8. Free port + stub supervisor
    this['_port'] = await getFreePort();
    this['_supervisor'] = createStubSupervisor();

    // 9. Server with full dependencies
    const config: ServerConfig = {
      port: this['_port'],
      supervisor: this['_supervisor']!,
      bindAddress: '127.0.0.1',
      allowedOrigins: ['*'],
      llmService: this._llmService,
      toolRunner: this._toolRunner,
      missionManager: this._missionManager,
    };

    this['server'] = new AssistantServer(config);
    await this['server']!.start();
  }

  async reset(): Promise<void> {
    const db = getDb();
    // Clear mission tables (reverse dependency order)
    db.rawExec('DELETE FROM pillar_metric_history');
    db.rawExec('DELETE FROM pillar_strategies');
    db.rawExec('DELETE FROM mission_todos');
    db.rawExec('DELETE FROM pillar_metrics');
    db.rawExec('DELETE FROM pillars');
    db.rawExec('DELETE FROM missions');
    db.rawExec('DELETE FROM dashboard_snapshots');

    // Delegate to parent for standard tables
    await super.reset();
  }

  async stop(): Promise<void> {
    await super.stop();

    // Clean up temp directory
    if (this._missionsDir) {
      fs.rmSync(this._missionsDir, { recursive: true, force: true });
      this._missionsDir = null;
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
