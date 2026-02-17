/**
 * API Tests — Trace Routes
 *
 * Covers the tracing REST API endpoints using the ServerHarness.
 * Uses TraceStore directly to seed trace data, then queries via REST.
 *
 * Tests exercise:
 *   - Trace listing with filters (conversationId, status, since)
 *   - Single trace detail (full trace with spans, LLM calls, tool calls)
 *   - LLM call listing with filters (workload, provider, traceId)
 *   - Single LLM call detail
 *   - Tool call listing with filters
 *   - Stats endpoint (aggregated trace statistics)
 *   - 404 for unknown resources
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/index.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

// ---------------------------------------------------------------------------
// Seed helpers — insert trace data directly into SQLite
// ---------------------------------------------------------------------------

function seedTrace(opts: {
  id: string;
  conversationId?: string;
  triggerType?: string;
  triggerContent?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  llmCallCount?: number;
  toolCallCount?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}) {
  const db = getDb();
  const now = opts.startedAt ?? new Date().toISOString();
  db.rawRun(
    `INSERT INTO traces (id, conversationId, turnId, triggerType, triggerContent, startedAt, completedAt, durationMs, llmCallCount, toolCallCount, agentCount, totalInputTokens, totalOutputTokens, status)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      opts.id,
      opts.conversationId ?? null,
      opts.triggerType ?? 'user_message',
      opts.triggerContent ?? null,
      now,
      opts.completedAt ?? null,
      opts.durationMs ?? null,
      opts.llmCallCount ?? 0,
      opts.toolCallCount ?? 0,
      opts.totalInputTokens ?? 0,
      opts.totalOutputTokens ?? 0,
      opts.status ?? 'completed',
    ],
  );
}

function seedSpan(opts: {
  id: string;
  traceId: string;
  agentId?: string;
  agentName?: string;
  agentType?: string;
  status?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO trace_spans (id, traceId, parentSpanId, agentId, agentName, agentEmoji, agentType, agentRole, mission, startedAt, status)
     VALUES (?, ?, NULL, ?, ?, '🤖', ?, 'supervisor', NULL, ?, ?)`,
    [opts.id, opts.traceId, opts.agentId ?? 'agent-1', opts.agentName ?? 'Supervisor', opts.agentType ?? 'supervisor', now, opts.status ?? 'completed'],
  );
}

function seedLlmCall(opts: {
  id: string;
  traceId?: string;
  spanId?: string;
  workload?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  conversationId?: string;
  status?: string;
  startedAt?: string;
}) {
  const db = getDb();
  const now = opts.startedAt ?? new Date().toISOString();
  db.rawRun(
    `INSERT INTO llm_calls (id, traceId, spanId, workload, provider, model, startedAt, inputTokens, outputTokens, conversationId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.traceId ?? null,
      opts.spanId ?? null,
      opts.workload ?? 'main',
      opts.provider ?? 'anthropic',
      opts.model ?? 'claude-3-sonnet',
      now,
      opts.inputTokens ?? 100,
      opts.outputTokens ?? 50,
      opts.conversationId ?? null,
      opts.status ?? 'completed',
    ],
  );
}

function seedToolCall(opts: {
  id: string;
  traceId?: string;
  spanId?: string;
  llmCallId?: string;
  toolName?: string;
  source?: string;
  success?: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO tool_calls (id, traceId, spanId, llmCallId, toolName, source, startedAt, success)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.traceId ?? null,
      opts.spanId ?? null,
      opts.llmCallId ?? null,
      opts.toolName ?? 'web_search',
      opts.source ?? 'native',
      now,
      opts.success ?? 1,
    ],
  );
}

describe('Trace Routes', () => {
  describe('GET /api/traces/traces', () => {
    it('returns empty array when no traces exist', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/traces/traces');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns seeded traces', async () => {
      seedTrace({ id: 'trace-1', triggerType: 'user_message', triggerContent: 'Hello' });
      seedTrace({ id: 'trace-2', triggerType: 'task_run' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; triggerType: string }>>('/api/traces/traces');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
      // Most recent first
      const ids = body.map(t => t.id);
      expect(ids).toContain('trace-1');
      expect(ids).toContain('trace-2');
    });

    it('filters by conversationId', async () => {
      seedTrace({ id: 'trace-a', conversationId: 'conv-1' });
      seedTrace({ id: 'trace-b', conversationId: 'conv-2' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/traces?conversationId=conv-1');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('trace-a');
    });

    it('filters by status', async () => {
      seedTrace({ id: 'trace-ok', status: 'completed' });
      seedTrace({ id: 'trace-err', status: 'error' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/traces?status=error');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('trace-err');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        seedTrace({ id: `trace-limit-${i}` });
      }

      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/traces/traces?limit=2');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
    });
  });

  describe('GET /api/traces/traces/:traceId', () => {
    it('returns full trace with spans, llm calls, and tool calls', async () => {
      seedTrace({ id: 'trace-full', triggerType: 'user_message', llmCallCount: 1, toolCallCount: 1 });
      seedSpan({ id: 'span-1', traceId: 'trace-full', agentName: 'Supervisor' });
      seedLlmCall({ id: 'llm-1', traceId: 'trace-full', spanId: 'span-1' });
      seedToolCall({ id: 'tool-1', traceId: 'trace-full', spanId: 'span-1', llmCallId: 'llm-1' });

      const api = harness.api();
      const { status, body } = await api.getJson<{
        trace: { id: string };
        spans: Array<{ id: string }>;
        llmCalls: Array<{ id: string }>;
        toolCalls: Array<{ id: string }>;
      }>('/api/traces/traces/trace-full');

      expect(status).toBe(200);
      expect(body.trace.id).toBe('trace-full');
      expect(body.spans).toHaveLength(1);
      expect(body.spans[0].id).toBe('span-1');
      expect(body.llmCalls).toHaveLength(1);
      expect(body.llmCalls[0].id).toBe('llm-1');
      expect(body.toolCalls).toHaveLength(1);
      expect(body.toolCalls[0].id).toBe('tool-1');
    });

    it('returns 404 for unknown trace', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/traces/traces/nonexistent');
      expect(status).toBe(404);
    });
  });

  describe('GET /api/traces/llm-calls', () => {
    it('returns empty array when no LLM calls exist', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/traces/llm-calls');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns seeded LLM calls', async () => {
      seedLlmCall({ id: 'llm-a', provider: 'anthropic', model: 'claude-3-sonnet', inputTokens: 200, outputTokens: 100 });
      seedLlmCall({ id: 'llm-b', provider: 'openai', model: 'gpt-4', inputTokens: 300, outputTokens: 150 });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; provider: string }>>('/api/traces/llm-calls');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
    });

    it('filters by workload', async () => {
      seedLlmCall({ id: 'llm-main', workload: 'main' });
      seedLlmCall({ id: 'llm-fast', workload: 'fast' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/llm-calls?workload=fast');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('llm-fast');
    });

    it('filters by provider', async () => {
      seedLlmCall({ id: 'llm-anth', provider: 'anthropic' });
      seedLlmCall({ id: 'llm-oai', provider: 'openai' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/llm-calls?provider=openai');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('llm-oai');
    });

    it('filters by traceId', async () => {
      seedTrace({ id: 'trace-x' });
      seedLlmCall({ id: 'llm-x1', traceId: 'trace-x' });
      seedLlmCall({ id: 'llm-orphan' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/llm-calls?traceId=trace-x');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('llm-x1');
    });
  });

  describe('GET /api/traces/llm-calls/:callId', () => {
    it('returns single LLM call by ID', async () => {
      seedLlmCall({ id: 'llm-detail', provider: 'anthropic', model: 'claude-3-haiku', inputTokens: 500, outputTokens: 250 });

      const api = harness.api();
      const { status, body } = await api.getJson<{ id: string; provider: string; model: string; inputTokens: number }>('/api/traces/llm-calls/llm-detail');

      expect(status).toBe(200);
      expect(body.id).toBe('llm-detail');
      expect(body.provider).toBe('anthropic');
      expect(body.model).toBe('claude-3-haiku');
      expect(body.inputTokens).toBe(500);
    });

    it('returns 404 for unknown LLM call', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/traces/llm-calls/nonexistent');
      expect(status).toBe(404);
    });
  });

  describe('GET /api/traces/tool-calls', () => {
    it('returns empty array when no tool calls exist', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/traces/tool-calls');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns seeded tool calls', async () => {
      seedToolCall({ id: 'tc-1', toolName: 'web_search', source: 'native', success: 1 });
      seedToolCall({ id: 'tc-2', toolName: 'read_file', source: 'native', success: 0 });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; toolName: string }>>('/api/traces/tool-calls');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
    });

    it('filters by traceId', async () => {
      seedTrace({ id: 'trace-tc' });
      seedToolCall({ id: 'tc-linked', traceId: 'trace-tc', toolName: 'web_search' });
      seedToolCall({ id: 'tc-unlinked', toolName: 'read_file' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/tool-calls?traceId=trace-tc');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('tc-linked');
    });

    it('filters by llmCallId', async () => {
      seedLlmCall({ id: 'llm-for-tc' });
      seedToolCall({ id: 'tc-from-llm', llmCallId: 'llm-for-tc' });
      seedToolCall({ id: 'tc-standalone' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/traces/tool-calls?llmCallId=llm-for-tc');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('tc-from-llm');
    });
  });

  describe('GET /api/traces/stats', () => {
    it('returns zeroed stats when no data exists', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        totalTraces: number;
        totalLlmCalls: number;
        totalToolCalls: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        tokenReductionEnabled: boolean;
      }>('/api/traces/stats');

      expect(status).toBe(200);
      expect(body.totalTraces).toBe(0);
      expect(body.totalLlmCalls).toBe(0);
      expect(body.totalToolCalls).toBe(0);
      expect(body.totalInputTokens).toBe(0);
      expect(body.totalOutputTokens).toBe(0);
      expect(typeof body.tokenReductionEnabled).toBe('boolean');
    });

    it('returns aggregated stats from seeded data', async () => {
      seedTrace({ id: 'trace-s1', totalInputTokens: 500, totalOutputTokens: 200, status: 'completed' });
      seedTrace({ id: 'trace-s2', totalInputTokens: 300, totalOutputTokens: 100, status: 'completed' });
      seedLlmCall({ id: 'llm-s1' });
      seedLlmCall({ id: 'llm-s2' });
      seedLlmCall({ id: 'llm-s3' });
      seedToolCall({ id: 'tc-s1' });

      const api = harness.api();
      const { status, body } = await api.getJson<{
        totalTraces: number;
        totalLlmCalls: number;
        totalToolCalls: number;
        totalInputTokens: number;
        totalOutputTokens: number;
      }>('/api/traces/stats');

      expect(status).toBe(200);
      expect(body.totalTraces).toBe(2);
      expect(body.totalLlmCalls).toBe(3);
      expect(body.totalToolCalls).toBe(1);
      expect(body.totalInputTokens).toBe(800);
      expect(body.totalOutputTokens).toBe(300);
    });
  });
});
