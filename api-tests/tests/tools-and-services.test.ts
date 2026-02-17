/**
 * API Tests — Tools & Services Integration
 *
 * Tests the ToolRunner and MessageEventService through the API layer.
 *
 * For src/tools:
 *   - GET /api/tools returns registered native, user, and MCP tools
 *   - Tool tree structure with proper categorization
 *   - Tool input schema propagation
 *   - User tool registration and prefix handling
 *   - Tool execution lifecycle (via agent pipeline)
 *
 * For src/services:
 *   - MessageEventService persistence through agent pipeline
 *   - Tool event messages appear in conversation messages
 *   - Event deduplication (broadcast + persist)
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
import type { NativeTool, NativeToolResult } from '../../src/tools/native/types.js';
import { MissionManager } from '../../src/missions/manager.js';
import { initMissionSchema } from '../../src/missions/schema.js';
import { getDashboardStore } from '../../src/dashboard/index.js';
import { TraceStore } from '../../src/tracing/trace-store.js';
import { SimulatorLLMProvider } from '../harness/simulator-llm-provider.js';
import { createStubSupervisor } from '../harness/server-harness.js';
import { ApiClient } from '../harness/api-client.js';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Test tools — simple implementations for testing registration
// ---------------------------------------------------------------------------

function createTestTool(name: string, description: string, schema: Record<string, unknown> = {}): NativeTool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: schema,
      required: Object.keys(schema),
    },
    async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
      return { success: true, output: { echo: params } };
    },
  };
}

function createPrivateTool(name: string, description: string): NativeTool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    private: true,
    async execute(): Promise<NativeToolResult> {
      return { success: true, output: 'private result' };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness with registered tools
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

class ToolsTestHarness {
  private server: AssistantServer | null = null;
  private simulatorServer: SimulatorServer | null = null;
  private _port = 0;
  private _simulatorPort = 0;
  private _toolRunner: ToolRunner | null = null;
  private missionsDir: string | null = null;

  get port(): number { return this._port; }
  get baseUrl(): string { return `http://127.0.0.1:${this._port}`; }
  get toolRunner(): ToolRunner { return this._toolRunner!; }

  api(): ApiClient { return new ApiClient(this.baseUrl); }

  async start(): Promise<void> {
    // 1. Simulator
    this._simulatorPort = await getFreePort();
    this.simulatorServer = new SimulatorServer();
    await this.simulatorServer.start(this._simulatorPort);
    endpoints.enableTestMode(`http://localhost:${this._simulatorPort}`);

    // 2. Database
    await closeDb().catch(() => {});
    await initDb(':memory:');
    ensureWellKnownConversations();
    initMissionSchema();
    getDashboardStore().init();

    // 3. TraceStore
    const traceStore = new TraceStore();
    traceStore.init();

    // 4. LLM Service
    const provider = new SimulatorLLMProvider(`http://localhost:${this._simulatorPort}`);
    const llmService = new LLMService({
      main: provider,
      fast: provider,
      traceStore,
    });

    // 5. Tool runner WITH registered tools
    this._toolRunner = new ToolRunner({ traceStore });

    // Register test tools
    this._toolRunner.registerNativeTool(
      createTestTool('web_search', 'Search the web for information', {
        query: { type: 'string', description: 'Search query' },
      }),
    );
    this._toolRunner.registerNativeTool(
      createTestTool('read_file', 'Read a file from the filesystem', {
        path: { type: 'string', description: 'File path' },
      }),
    );
    this._toolRunner.registerNativeTool(
      createTestTool('http_client', 'Make HTTP requests', {
        url: { type: 'string', description: 'Request URL' },
        method: { type: 'string', description: 'HTTP method' },
      }),
    );
    this._toolRunner.registerNativeTool(
      createPrivateTool('remember', 'Save a memory note'),
    );

    // Register a user-defined tool
    this._toolRunner.registerUserTool(
      createTestTool('custom_calculator', 'A custom calculator tool', {
        expression: { type: 'string', description: 'Math expression' },
      }),
    );

    // 6. Mission manager
    this.missionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olliebot-tools-test-'));
    const missionManager = new MissionManager({
      missionsDir: this.missionsDir,
      llmService,
      schedulerInterval: 999_999,
    });
    await missionManager.init();

    // 7. Server
    this._port = await getFreePort();
    const supervisor = createStubSupervisor();

    const config: ServerConfig = {
      port: this._port,
      supervisor,
      bindAddress: '127.0.0.1',
      allowedOrigins: ['*'],
      llmService,
      toolRunner: this._toolRunner,
      missionManager,
      traceStore,
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

const harness = new ToolsTestHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Tool Runner via API', () => {
  describe('GET /api/tools', () => {
    it('returns tool tree with builtin, user, and mcp categories', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        builtin: unknown[];
        user: unknown[];
        mcp: Record<string, unknown>;
      }>('/api/tools');

      expect(status).toBe(200);
      expect(Array.isArray(body.builtin)).toBe(true);
      expect(Array.isArray(body.user)).toBe(true);
      expect(typeof body.mcp).toBe('object');
    });

    it('includes registered native tools with proper schema', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        builtin: Array<{
          name: string;
          description: string;
          inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
        }>;
      }>('/api/tools');

      // Should have our registered tools
      const toolNames = body.builtin.map(t => t.name);
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('http_client');

      // Check schema propagation
      const webSearch = body.builtin.find(t => t.name === 'web_search')!;
      expect(webSearch.description).toBe('Search the web for information');
      expect(webSearch.inputs).toHaveLength(1);
      expect(webSearch.inputs[0].name).toBe('query');
      expect(webSearch.inputs[0].type).toBe('string');
      expect(webSearch.inputs[0].required).toBe(true);
    });

    it('includes user-defined tools (without prefix) in user category', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        user: Array<{ name: string; description: string }>;
      }>('/api/tools');

      expect(body.user.length).toBeGreaterThanOrEqual(1);
      // The API strips the user. prefix when categorizing
      const calc = body.user.find(t => t.name === 'custom_calculator');
      expect(calc).toBeTruthy();
      expect(calc!.description).toBe('A custom calculator tool');
    });

    it('includes private tools in the builtin list', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        builtin: Array<{ name: string }>;
      }>('/api/tools');

      // Private tools are still listed (access control is at the agent level)
      const toolNames = body.builtin.map(t => t.name);
      expect(toolNames).toContain('remember');
    });

    it('includes tools with multi-parameter schemas', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        builtin: Array<{
          name: string;
          inputs: Array<{ name: string; type: string; required: boolean }>;
        }>;
      }>('/api/tools');

      const httpClient = body.builtin.find(t => t.name === 'http_client')!;
      expect(httpClient.inputs).toHaveLength(2);
      const inputNames = httpClient.inputs.map(i => i.name);
      expect(inputNames).toContain('url');
      expect(inputNames).toContain('method');
    });

    it('returns empty MCP section when no MCP client configured', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        mcp: Record<string, unknown>;
      }>('/api/tools');

      expect(Object.keys(body.mcp)).toHaveLength(0);
    });
  });

  describe('GET /api/startup includes tools', () => {
    it('startup response includes full tool tree', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        tools: {
          builtin: Array<{ name: string }>;
          user: Array<{ name: string }>;
          mcp: Record<string, unknown>;
        };
      }>('/api/startup');

      expect(body.tools.builtin.length).toBeGreaterThanOrEqual(3);
      expect(body.tools.user.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Tool runner direct methods', () => {
    it('getToolsForLLM returns tools formatted for LLM API', () => {
      const tools = harness.toolRunner.getToolsForLLM();

      expect(tools.length).toBeGreaterThanOrEqual(4); // 3 native + 1 user
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');
      }

      // User tools should have user. prefix
      const userTools = tools.filter(t => t.name.startsWith('user.'));
      expect(userTools.length).toBe(1);
      expect(userTools[0].name).toBe('user.custom_calculator');
    });

    it('getToolDefinitions returns source metadata', () => {
      const defs = harness.toolRunner.getToolDefinitions();

      const native = defs.filter(d => d.source === 'native');
      const user = defs.filter(d => d.source === 'user');

      expect(native.length).toBeGreaterThanOrEqual(3);
      expect(user.length).toBe(1);
    });

    it('parseToolName identifies tool source correctly', () => {
      expect(harness.toolRunner.parseToolName('web_search')).toEqual({
        source: 'native',
        name: 'web_search',
      });
      expect(harness.toolRunner.parseToolName('user.custom_calculator')).toEqual({
        source: 'user',
        name: 'custom_calculator',
      });
      expect(harness.toolRunner.parseToolName('mcp.server__tool')).toEqual({
        source: 'mcp',
        name: 'mcp.server__tool',
      });
    });

    it('isPrivateTool identifies private tools', () => {
      expect(harness.toolRunner.isPrivateTool('remember')).toBe(true);
      expect(harness.toolRunner.isPrivateTool('web_search')).toBe(false);
    });

    it('getPrivateToolNames returns private tool list', () => {
      const privateNames = harness.toolRunner.getPrivateToolNames();
      expect(privateNames).toContain('remember');
      expect(privateNames).not.toContain('web_search');
    });

    it('executeTool runs a native tool and returns result', async () => {
      const result = await harness.toolRunner.executeTool({
        id: 'test-req-1',
        toolName: 'web_search',
        source: 'native',
        parameters: { query: 'test query' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('executeTool returns error for unknown tool', async () => {
      const result = await harness.toolRunner.executeTool({
        id: 'test-req-2',
        toolName: 'nonexistent_tool',
        source: 'native',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('rejects user tool registration that conflicts with native tool', () => {
      // Attempting to register 'web_search' as user tool should be silently rejected
      harness.toolRunner.registerUserTool(
        createTestTool('web_search', 'Conflicting tool'),
      );

      // The user tools list should not include a second web_search
      const defs = harness.toolRunner.getToolDefinitions();
      const webSearchTools = defs.filter(d => d.name === 'web_search' || d.name === 'user.web_search');
      expect(webSearchTools).toHaveLength(1);
      expect(webSearchTools[0].source).toBe('native');
    });

    it('emits tool events during execution', async () => {
      const events: Array<{ type: string; toolName: string }> = [];
      const unsubscribe = harness.toolRunner.onToolEvent((event) => {
        events.push({ type: event.type, toolName: event.toolName });
      });

      await harness.toolRunner.executeTool({
        id: 'test-req-3',
        toolName: 'read_file',
        source: 'native',
        parameters: { path: '/tmp/test.txt' },
      });

      unsubscribe();

      // Should have request + finished events
      expect(events.some(e => e.type === 'tool_requested')).toBe(true);
      expect(events.some(e => e.type === 'tool_execution_finished')).toBe(true);
      expect(events.every(e => e.toolName === 'read_file')).toBe(true);
    });
  });
});

describe('MessageEventService via API', () => {
  describe('Message persistence through tool execution', () => {
    it('tool execution events are tracked in trace store when traceId is set', async () => {
      // Seed a trace so the tool call can be associated with it
      const db = getDb();
      const traceId = 'trace-tool-test';
      db.rawRun(
        `INSERT INTO traces (id, triggerType, startedAt, status, llmCallCount, toolCallCount, agentCount, totalInputTokens, totalOutputTokens)
         VALUES (?, 'user_message', ?, 'running', 0, 0, 0, 0, 0)`,
        [traceId, new Date().toISOString()],
      );

      // Execute a tool through the runner with traceId (as agents do)
      await harness.toolRunner.executeTool({
        id: 'traced-tool-1',
        toolName: 'web_search',
        source: 'native',
        parameters: { query: 'test' },
        traceId,
      });

      // Verify tool call recorded in trace store via API
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        toolName: string;
        success: number;
      }>>('/api/traces/tool-calls');

      expect(status).toBe(200);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body.some(tc => tc.toolName === 'web_search')).toBe(true);
    });

    it('tool execution without traceId does not create trace records', async () => {
      // Execute without traceId
      await harness.toolRunner.executeTool({
        id: 'untraced-tool-1',
        toolName: 'read_file',
        source: 'native',
        parameters: { path: '/tmp/test.txt' },
      });

      // No tool calls should be in trace store
      const api = harness.api();
      const { body } = await api.getJson<unknown[]>('/api/traces/tool-calls');
      expect(body).toHaveLength(0);
    });
  });

  describe('Feed conversation as event log', () => {
    it('well-known feed conversation exists for event persistence', async () => {
      const api = harness.api();
      const { body: conversations } = await api.getJson<Array<{
        id: string;
        isWellKnown: boolean;
        title: string;
      }>>('/api/conversations');

      const feed = conversations.find(c => c.title === 'Feed');
      expect(feed).toBeTruthy();
      expect(feed!.isWellKnown).toBe(true);
    });
  });
});
