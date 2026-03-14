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
import { ServerHarness } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const harness = new ServerHarness();

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
        await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

        // Send a user message
        ws.send({
          type: 'message',
          content: 'What is 2+2?',
        });

        // Wait for stream_end — this means the supervisor called the LLM
        // and streamed the full response back
        const endEvent = await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
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
        await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

        ws.send({
          type: 'message',
          content: 'Tell me about TypeScript',
        });

        await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
      } finally {
        await ws.close();
      }

      // Give a moment for trace to be finalized
      await new Promise(resolve => waitFor(TIMEOUTS.SHORT).then(resolve));

      // Verify a trace was created
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        triggerType: string;
        status: string;
        llmCallCount: number;
      }>>('/api/traces/traces');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBeGreaterThanOrEqual(1);

      const trace = body[0];
      expect(trace.triggerType).toBe('user_message');
      expect(trace.status).toBe('completed');
    });

    it('records LLM calls in the trace store', async () => {
      const ws = harness.ws();
      await ws.connect();

      try {
        await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

        ws.send({
          type: 'message',
          content: 'Hello, world!',
        });

        await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => waitFor(TIMEOUTS.SHORT).then(resolve));

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

      expect(status).toBe(HTTP_STATUS.OK);
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
        await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

        ws.send({
          type: 'message',
          content: 'Save this to history',
        });

        await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => waitFor(TIMEOUTS.STANDARD).then(resolve));

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

      expect(status).toBe(HTTP_STATUS.OK);
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

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.status).toBe('idle');
    });

    it('GET /api/agents lists the real supervisor', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        id: string;
        name: string;
        role: string;
      }>>('/api/agents');

      expect(status).toBe(HTTP_STATUS.OK);
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
        await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

        ws.send({
          type: 'message',
          content: 'Trace test message',
        });

        await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
      } finally {
        await ws.close();
      }

      await new Promise(resolve => waitFor(TIMEOUTS.SHORT).then(resolve));

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

      expect(status).toBe(HTTP_STATUS.OK);

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
