/**
 * API Tests — Agent Pipeline
 *
 * Tests the full message → supervisor → LLM → response pipeline using a
 * real SupervisorAgentImpl backed by the SimulatorLLMProvider. This exercises:
 *
 *   - src/agents/supervisor.ts  (message handling, streaming response, trace management)
 *   - src/agents/base-agent.ts  (system prompt building, conversation history, message saving)
 *   - src/agents/registry.ts    (template loading, specialist types, command triggers)
 *   - src/llm/service.ts        (generate, generateWithToolsStream, tracing integration)
 *
 * Uses WebSocket to observe streamed responses from the supervisor, and REST
 * endpoints to verify traces and conversation messages were recorded.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { initDb, closeDb } from '../../src/db/index.js';
import { ensureWellKnownConversations } from '../../src/db/well-known-conversations.js';
import { AssistantServer } from '../../src/server/index.js';
import type { ServerConfig } from '../../src/server/index.js';
import { endpoints } from '../../src/config/endpoint-manager.js';
import { SimulatorServer } from '../../e2e/simulators/server.js';
import { LLMService } from '../../src/llm/service.js';
import { ToolRunner } from '../../src/tools/runner.js';
import { MissionManager } from '../../src/missions/manager.js';
import { initMissionSchema } from '../../src/missions/schema.js';
import { getDashboardStore } from '../../src/dashboard/index.js';
import { TraceStore } from '../../src/tracing/trace-store.js';
import { SimulatorLLMProvider } from '../harness/simulator-llm-provider.js';
import { SupervisorAgentImpl } from '../../src/agents/supervisor.js';
import { AgentRegistry } from '../../src/agents/registry.js';
import { ApiClient } from '../harness/api-client.js';
import { WsClient } from '../harness/ws-client.js';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Agent Pipeline Harness
// ---------------------------------------------------------------------------

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

class AgentPipelineHarness {
  private server: AssistantServer | null = null;
  private simulatorServer: SimulatorServer | null = null;
  private _port = 0;
  private _simulatorPort = 0;
  private traceStore: TraceStore | null = null;
  private llmService: LLMService | null = null;
  private toolRunner: ToolRunner | null = null;
  private missionManager: MissionManager | null = null;
  private missionsDir: string | null = null;

  get port(): number { return this._port; }
  get baseUrl(): string { return `http://127.0.0.1:${this._port}`; }
  get wsUrl(): string { return `ws://127.0.0.1:${this._port}`; }
  get simulatorUrl(): string { return `http://localhost:${this._simulatorPort}`; }

  api(): ApiClient { return new ApiClient(this.baseUrl); }
  ws(): WsClient { return new WsClient(this.wsUrl); }

  async start(): Promise<void> {
    // 1. Simulator
    this._simulatorPort = await getFreePort();
    this.simulatorServer = new SimulatorServer();
    await this.simulatorServer.start(this._simulatorPort);
    endpoints.enableTestMode(this.simulatorUrl);

    // 2. Database
    await closeDb().catch(() => {});
    await initDb(':memory:');
    ensureWellKnownConversations();
    initMissionSchema();
    getDashboardStore().init();

    // 3. TraceStore
    this.traceStore = new TraceStore();
    this.traceStore.init();

    // 4. LLM Service with tracing
    const provider = new SimulatorLLMProvider(this.simulatorUrl);
    this.llmService = new LLMService({
      main: provider,
      fast: provider,
      traceStore: this.traceStore,
    });

    // 5. Tool runner (empty — supervisor responds without tools)
    this.toolRunner = new ToolRunner();

    // 6. Mission manager
    this.missionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olliebot-agent-pipeline-'));
    this.missionManager = new MissionManager({
      missionsDir: this.missionsDir,
      llmService: this.llmService,
      schedulerInterval: 999_999,
    });
    await this.missionManager.init();

    // 7. Real Supervisor (the key difference from FullServerHarness)
    const registry = new AgentRegistry();
    const supervisor = new SupervisorAgentImpl(this.llmService, registry);
    supervisor.setToolRunner(this.toolRunner);
    await supervisor.init();

    // 8. Server
    this._port = await getFreePort();
    const config: ServerConfig = {
      port: this._port,
      supervisor,
      bindAddress: '127.0.0.1',
      allowedOrigins: ['*'],
      llmService: this.llmService,
      toolRunner: this.toolRunner,
      missionManager: this.missionManager,
      traceStore: this.traceStore,
    };

    this.server = new AssistantServer(config);
    await this.server.start();
  }

  async reset(): Promise<void> {
    const db = getDb();
    db.rawExec('DELETE FROM pillar_metric_history');
    db.rawExec('DELETE FROM pillar_strategies');
    db.rawExec('DELETE FROM mission_todos');
    db.rawExec('DELETE FROM pillar_metrics');
    db.rawExec('DELETE FROM pillars');
    db.rawExec('DELETE FROM missions');
    db.rawExec('DELETE FROM dashboard_snapshots');
    db.rawExec('DELETE FROM token_reductions');
    db.rawExec('DELETE FROM tool_calls');
    db.rawExec('DELETE FROM llm_calls');
    db.rawExec('DELETE FROM trace_spans');
    db.rawExec('DELETE FROM traces');
    db.rawExec('DELETE FROM messages');
    db.rawExec('DELETE FROM embeddings');
    db.rawExec('DELETE FROM conversations');
    ensureWellKnownConversations();
    if (this.simulatorServer) this.simulatorServer.reset();
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
    if (this.simulatorServer) {
      await this.simulatorServer.stop();
      this.simulatorServer = null;
    }
    endpoints.reset();
    await closeDb().catch(() => {});
    if (this.missionsDir) {
      fs.rmSync(this.missionsDir, { recursive: true, force: true });
      this.missionsDir = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const harness = new AgentPipelineHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Agent Pipeline', () => {
  describe('WebSocket message → supervisor → LLM → streamed response', () => {
    it('processes a user message through the real supervisor and streams a response', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        // Wait for connected event
        await ws.waitForEvent('connected', 3_000);

        // Send a user message
        ws.send({
          type: 'message',
          content: 'What is 2+2?',
        });

        // Wait for stream_end — this means the supervisor called the LLM
        // and streamed the full response back
        const endEvent = await ws.waitForEvent('stream_end', 15_000);
        expect(endEvent).toBeTruthy();

        // Verify we got stream chunks
        const chunks = ws.eventsOfType('stream_chunk');
        expect(chunks.length).toBeGreaterThanOrEqual(1);
      } finally {
        await ws.close();
      }
    });

    it('creates a trace for the processed message', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        await ws.waitForEvent('connected', 3_000);

        ws.send({
          type: 'message',
          content: 'Tell me about TypeScript',
        });

        await ws.waitForEvent('stream_end', 15_000);
      } finally {
        await ws.close();
      }

      // Give a moment for trace to be finalized
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify a trace was created
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        triggerType: string;
        status: string;
        llmCallCount: number;
      }>>('/api/traces/traces');

      expect(status).toBe(200);
      expect(body.length).toBeGreaterThanOrEqual(1);

      const trace = body[0];
      expect(trace.triggerType).toBe('user_message');
      expect(trace.status).toBe('completed');
    });

    it('records LLM calls in the trace store', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        await ws.waitForEvent('connected', 3_000);

        ws.send({
          type: 'message',
          content: 'Hello, world!',
        });

        await ws.waitForEvent('stream_end', 15_000);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Check LLM calls were recorded
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        provider: string;
        model: string;
        workload: string;
        inputTokens: number;
        outputTokens: number;
      }>>('/api/traces/llm-calls');

      expect(status).toBe(200);
      expect(body.length).toBeGreaterThanOrEqual(1);

      const call = body[0];
      expect(call.provider).toBe('anthropic');
      expect(call.model).toBe('claude-simulator');
      expect(call.inputTokens).toBeGreaterThan(0);
      expect(call.outputTokens).toBeGreaterThan(0);
    });

    it('saves messages to the conversation', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        await ws.waitForEvent('connected', 3_000);

        ws.send({
          type: 'message',
          content: 'Save this to history',
        });

        await ws.waitForEvent('stream_end', 15_000);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Find all conversations — the supervisor creates or reuses one
      const api = harness.api();
      const { body: conversations } = await api.getJson<Array<{
        id: string;
        title: string;
      }>>('/api/conversations');

      // Look for a conversation that has our messages
      let foundUserMsg = false;
      let foundAssistantMsg = false;

      for (const conv of conversations) {
        const { body } = await api.getJson<{
          items: Array<{ role: string; content: string }>;
          pagination: object;
        }>(`/api/conversations/${conv.id}/messages`);

        if (body.items?.some(m => m.role === 'user' && m.content === 'Save this to history')) {
          foundUserMsg = true;
        }
        if (body.items?.some(m => m.role === 'assistant')) {
          foundAssistantMsg = true;
        }
      }

      expect(foundUserMsg).toBe(true);
      expect(foundAssistantMsg).toBe(true);
    });
  });

  describe('REST message endpoint with real supervisor', () => {
    it('POST /api/messages processes and returns success', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{
        success: boolean;
        messageId: string;
      }>('/api/messages', { content: 'Quick question via REST' });

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.messageId).toBeTruthy();
    });
  });

  describe('Agent state and metadata', () => {
    it('GET /api/state reflects supervisor status', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        status: string;
        lastActivity: string;
      }>('/api/state');

      expect(status).toBe(200);
      expect(body.status).toBe('idle');
    });

    it('GET /api/agents lists the real supervisor', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        name: string;
        role: string;
      }>>('/api/agents');

      expect(status).toBe(200);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].role).toBe('supervisor');
      // Real supervisor should have its configured identity
      expect(body[0].name).toBeTruthy();
    });

    it('GET /api/startup includes agent templates from registry', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        agentTemplates: Array<{ type: string; name: string; emoji: string }>;
        commandTriggers: Array<{ command: string; agentType: string }>;
      }>('/api/startup');

      // Should have specialist templates from JSON configs
      expect(body.agentTemplates.length).toBeGreaterThan(0);

      // Common specialist types should be present
      const types = body.agentTemplates.map(t => t.type);
      expect(types).toContain('researcher');
      expect(types).toContain('coder');
    });
  });

  describe('Trace integration through agent pipeline', () => {
    it('full trace has spans with agent info', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        await ws.waitForEvent('connected', 3_000);

        ws.send({
          type: 'message',
          content: 'Trace test message',
        });

        await ws.waitForEvent('stream_end', 15_000);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Get the trace
      const api = harness.api();
      const { body: traces } = await api.getJson<Array<{ id: string }>>('/api/traces/traces');
      expect(traces.length).toBeGreaterThanOrEqual(1);

      // Get full trace detail
      const { status, body } = await api.getJson<{
        trace: { id: string; triggerType: string; status: string };
        spans: Array<{ agentId: string; agentName: string; agentType: string }>;
        llmCalls: Array<{ id: string; provider: string; callerAgentName: string }>;
        toolCalls: unknown[];
      }>(`/api/traces/traces/${traces[0].id}`);

      expect(status).toBe(200);

      // Trace should be completed
      expect(body.trace.status).toBe('completed');

      // Should have at least one span for the supervisor
      expect(body.spans.length).toBeGreaterThanOrEqual(1);
      expect(body.spans[0].agentType).toBe('supervisor-main');

      // LLM calls should have agent context
      expect(body.llmCalls.length).toBeGreaterThanOrEqual(1);
      expect(body.llmCalls[0].provider).toBe('anthropic');
    });
  });
});
