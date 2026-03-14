/**
 * API Tests — Tools & Services Integration
 *
 * Tests the ToolRunner and MessageEventService through the API layer
 * using the real ServerHarness with all native tools registered.
 *
 * For src/tools:
 *   - GET /api/tools returns registered native, user, and MCP tools
 *   - Tool tree structure with proper categorization
 *   - Tool input schema propagation
 *   - User tool registration and prefix handling
 *   - Tool execution lifecycle (via tool runner)
 *
 * For src/services:
 *   - MessageEventService persistence through agent pipeline
 *   - Tool event messages appear in conversation messages
 *   - Event deduplication (broadcast + persist)
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';
import { getDb } from '../../src/db/index.js';
import type { NativeTool, NativeToolResult } from '../../src/tools/native/types.js';

// ---------------------------------------------------------------------------
// Test helpers for user tool registration tests
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const harness = new ServerHarness();

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

      expect(status).toBe(HTTP_STATUS.OK);
      expect(Array.isArray(body.builtin)).toBe(true);
      expect(Array.isArray(body.user)).toBe(true);
      expect(typeof body.mcp).toBe('object');
    });

    it('includes real native tools with proper schema', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        builtin: Array<{
          name: string;
          description: string;
          inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
        }>;
      }>('/api/tools');

      // Should have real registered tools
      const toolNames = body.builtin.map(t => t.name);
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('http_client');
      expect(toolNames).toContain('wikipedia_search');

      // Check schema propagation on a real tool
      const webSearch = body.builtin.find(t => t.name === 'web_search')!;
      expect(webSearch.description).toBeTruthy();
      expect(webSearch.inputs.length).toBeGreaterThanOrEqual(1);
      expect(webSearch.inputs.some(i => i.name === 'query')).toBe(true);
    });

    it('includes private tools in the builtin list', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        builtin: Array<{ name: string }>;
      }>('/api/tools');

      // The real remember tool is private
      const toolNames = body.builtin.map(t => t.name);
      expect(toolNames).toContain('remember');
    });

    it('returns empty user section when no user tools are defined', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        user: Array<{ name: string }>;
      }>('/api/tools');

      // No user tools defined in temp dir
      expect(body.user).toHaveLength(0);
    });

    it('returns empty MCP section when no MCP servers configured', async () => {
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

      // Real tools are registered — should have many builtin tools
      expect(body.tools.builtin.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Tool runner direct methods', () => {
    it('getToolsForLLM returns tools formatted for LLM API', () => {
      const tools = harness.toolRunner.getToolsForLLM();

      // Real harness has all native tools
      expect(tools.length).toBeGreaterThanOrEqual(15);
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');
      }
    });

    it('getToolDefinitions returns source metadata', () => {
      const defs = harness.toolRunner.getToolDefinitions();

      const native = defs.filter(d => d.source === 'native');
      expect(native.length).toBeGreaterThanOrEqual(15);
    });

    it('parseToolName identifies tool source correctly', () => {
      expect(harness.toolRunner.parseToolName('web_search')).toEqual({
        source: 'native',
        name: 'web_search',
      });
      expect(harness.toolRunner.parseToolName('mcp.server__tool')).toEqual({
        source: 'mcp',
        name: 'mcp.server__tool',
      });
    });

    it('isPrivateTool identifies private tools', () => {
      // Frontend code tools are marked as private
      expect(harness.toolRunner.isPrivateTool('read_frontend_code')).toBe(true);
      expect(harness.toolRunner.isPrivateTool('web_search')).toBe(false);
    });

    it('getPrivateToolNames returns private tool list', () => {
      const privateNames = harness.toolRunner.getPrivateToolNames();
      expect(privateNames).toContain('read_frontend_code');
      expect(privateNames).not.toContain('web_search');
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

      // Execute remember tool (works locally, no network calls)
      await harness.toolRunner.executeTool({
        id: 'test-req-3',
        toolName: 'remember',
        source: 'native',
        parameters: { content: 'test memory entry' },
      });

      unsubscribe();

      // Should have request + finished events
      expect(events.some(e => e.type === 'tool_requested')).toBe(true);
      expect(events.some(e => e.type === 'tool_execution_finished')).toBe(true);
      expect(events.every(e => e.toolName === 'remember')).toBe(true);
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

      // Execute remember tool (works locally) with traceId
      await harness.toolRunner.executeTool({
        id: 'traced-tool-1',
        toolName: 'remember',
        source: 'native',
        parameters: { content: 'traced memory entry' },
        traceId,
      });

      // Verify tool call recorded in trace store via API
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        toolName: string;
        success: number;
      }>>('/api/traces/tool-calls');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body.some(tc => tc.toolName === 'remember')).toBe(true);
    });

    it('tool execution without traceId does not create trace records', async () => {
      // Execute without traceId
      await harness.toolRunner.executeTool({
        id: 'untraced-tool-1',
        toolName: 'remember',
        source: 'native',
        parameters: { content: 'untraced memory entry' },
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
