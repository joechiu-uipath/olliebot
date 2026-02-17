/**
 * API Tests — Server Core Routes
 *
 * Covers server endpoints that are not covered by other specialized test files.
 * Uses FullServerHarness to ensure tools, model capabilities, and startup
 * aggregation work end-to-end.
 *
 * Tests exercise:
 *   - GET /api/startup (consolidated data endpoint)
 *   - GET /api/model-capabilities (model info)
 *   - GET /api/state (agent state)
 *   - GET /api/agents (active agents)
 *   - GET /api/tools (tool tree structure)
 *   - GET /api/skills (skills metadata)
 *   - GET /api/mcps (MCP servers)
 *   - GET /api/tasks (scheduled tasks)
 *   - GET /api/clients (connected WS clients)
 *   - DELETE /api/browser/sessions/:id (without browserManager)
 *   - DELETE /api/desktop/sessions/:id (without desktopManager)
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { FullServerHarness } from '../harness/index.js';

const harness = new FullServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Server Core Routes', () => {
  describe('GET /api/startup', () => {
    it('returns consolidated startup data', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        modelCapabilities: { provider: string | undefined; model: string | undefined };
        conversations: Array<{ id: string }>;
        feedMessages: { items: unknown[]; pagination: object };
        tasks: unknown[];
        skills: unknown[];
        mcps: unknown[];
        tools: { builtin: unknown[]; user: unknown[]; mcp: Record<string, unknown> };
        ragProjects: unknown[];
        agentTemplates: Array<{ type: string; name: string; emoji: string }>;
        commandTriggers: unknown[];
      }>('/api/startup');

      expect(status).toBe(200);

      // Model capabilities should be present (may be undefined providers in test)
      expect(body).toHaveProperty('modelCapabilities');

      // Conversations (well-known ones should exist)
      expect(Array.isArray(body.conversations)).toBe(true);
      expect(body.conversations.length).toBeGreaterThan(0);

      // Feed messages structure
      expect(body.feedMessages).toHaveProperty('items');
      expect(body.feedMessages).toHaveProperty('pagination');
      expect(Array.isArray(body.feedMessages.items)).toBe(true);

      // Tools tree structure (toolRunner is present in FullServerHarness)
      expect(body.tools).toHaveProperty('builtin');
      expect(body.tools).toHaveProperty('user');
      expect(body.tools).toHaveProperty('mcp');
      expect(Array.isArray(body.tools.builtin)).toBe(true);

      // Agent templates come from the global registry
      expect(Array.isArray(body.agentTemplates)).toBe(true);

      // Command triggers
      expect(Array.isArray(body.commandTriggers)).toBe(true);

      // Tasks (taskManager not set in harness, should be empty)
      expect(body.tasks).toEqual([]);

      // Skills (skillManager not set, should be empty)
      expect(body.skills).toEqual([]);

      // MCPs (mcpClient not set, should be empty)
      expect(body.mcps).toEqual([]);

      // RAG projects (ragProjectService not set, should be empty)
      expect(body.ragProjects).toEqual([]);
    });
  });

  describe('GET /api/model-capabilities', () => {
    it('returns model capabilities object', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        provider: string | undefined;
        model: string | undefined;
        supportsReasoningEffort: boolean;
        reasoningEfforts: string[];
      }>('/api/model-capabilities');

      expect(status).toBe(200);
      expect(body).toHaveProperty('supportsReasoningEffort');
      expect(body).toHaveProperty('reasoningEfforts');
    });
  });

  describe('GET /api/state', () => {
    it('returns agent state', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        status: string;
        lastActivity: string;
      }>('/api/state');

      expect(status).toBe(200);
      expect(body.status).toBe('idle');
    });
  });

  describe('GET /api/agents', () => {
    it('returns agent list with supervisor', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; name: string; role: string }>>('/api/agents');

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // At least the supervisor stub should be present
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]).toHaveProperty('id');
    });
  });

  describe('GET /api/tools', () => {
    it('returns tool tree structure', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{
        builtin: Array<{ name: string; description: string; inputs: unknown[] }>;
        user: unknown[];
        mcp: Record<string, unknown>;
      }>('/api/tools');

      expect(status).toBe(200);
      expect(Array.isArray(body.builtin)).toBe(true);
      expect(Array.isArray(body.user)).toBe(true);
      expect(typeof body.mcp).toBe('object');

      // Builtin tools should have proper shape
      if (body.builtin.length > 0) {
        expect(body.builtin[0]).toHaveProperty('name');
        expect(body.builtin[0]).toHaveProperty('description');
        expect(body.builtin[0]).toHaveProperty('inputs');
      }
    });
  });

  describe('GET /api/skills', () => {
    it('returns empty array when skillManager is not configured', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/skills');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('GET /api/mcps', () => {
    it('returns empty array when mcpClient is not configured', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/mcps');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('PATCH /api/mcps/:id', () => {
    it('returns 404 when mcpClient is not configured', async () => {
      const res = await fetch(`${harness.baseUrl}/api/mcps/some-server`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not configured');
    });
  });

  describe('GET /api/tasks', () => {
    it('returns empty array when taskManager is not configured', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/tasks');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('returns 500 when taskManager is not configured', async () => {
      const res = await fetch(`${harness.baseUrl}/api/tasks/some-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Task manager');
    });
  });

  describe('GET /api/clients', () => {
    it('returns connected clients count', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ count: number }>('/api/clients');

      expect(status).toBe(200);
      expect(typeof body.count).toBe('number');
      // No WS connections in REST-only test
      expect(body.count).toBe(0);
    });
  });

  describe('DELETE /api/browser/sessions/:id', () => {
    it('returns 404 when browserManager is not configured', async () => {
      const res = await fetch(`${harness.baseUrl}/api/browser/sessions/some-session`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not configured');
    });
  });

  describe('DELETE /api/desktop/sessions/:id', () => {
    it('returns 404 when desktopManager is not configured', async () => {
      const res = await fetch(`${harness.baseUrl}/api/desktop/sessions/some-session`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not configured');
    });
  });

  describe('POST /api/messages (REST message send)', () => {
    it('returns 400 when content is missing', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/messages',
        {},
      );

      expect(status).toBe(400);
      expect(body.error).toContain('Content is required');
    });

    it('accepts a message and returns success', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ success: boolean; messageId: string }>(
        '/api/messages',
        { content: 'Hello from API test' },
      );

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.messageId).toBeTruthy();
    });
  });

  describe('DELETE /api/conversations/:id/messages', () => {
    it('returns 404 for nonexistent conversation', async () => {
      const res = await fetch(`${harness.baseUrl}/api/conversations/nonexistent/messages`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });
});
