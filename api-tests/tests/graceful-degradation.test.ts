/**
 * API Tests — Graceful Degradation
 *
 * Covers server routes returning sensible defaults when optional data
 * directories are empty. The harness boots with real managers pointing
 * at empty temp directories, so these tests verify empty-state behavior.
 *
 * Coverage targets:
 *   - GET /api/skills → builtin skills only (user skills dir is empty)
 *   - GET /api/tools → real native tools (no user tools or MCP tools)
 *   - GET /api/tasks → [] when tasks dir is empty
 *   - PATCH /api/tasks/:id → 404 for nonexistent task
 *   - GET /api/startup → full response with real components
 *   - GET /api/startup → contains agentTemplates and commandTriggers arrays
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Graceful Degradation (empty data directories)', () => {
  it('GET /api/skills returns skills array (may include builtins)', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<unknown[]>('/api/skills');

    expect(status).toBe(HTTP_STATUS.OK);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/tools returns real native tools', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{
      builtin: unknown[];
      user: unknown[];
      mcp: Record<string, unknown>;
    }>('/api/tools');

    expect(status).toBe(HTTP_STATUS.OK);
    // Real native tools are registered
    expect(body.builtin.length).toBeGreaterThan(0);
    // No user tools in empty temp dir
    expect(body.user).toEqual([]);
    // No MCP servers configured
    expect(body.mcp).toEqual({});
  });

  it('GET /api/tasks returns empty array when tasks dir is empty', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<unknown[]>('/api/tasks');

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body).toEqual([]);
  });

  it('PATCH /api/tasks/:id returns 404 for nonexistent task', async () => {
    const api = harness.api();
    const { status } = await api.patchJson<{ error: string }>(
      '/api/tasks/some-task',
      { enabled: false },
    );

    expect(status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('PATCH /api/tasks/:id validates enabled is boolean', async () => {
    const api = harness.api();
    const { status } = await api.patchJson<{ error: string }>(
      '/api/tasks/some-task',
      { enabled: 'yes' },
    );

    // enabled validation returns 400
    expect(status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  describe('startup endpoint aggregation', () => {
    it('GET /api/startup returns all expected top-level keys', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<Record<string, unknown>>(
        '/api/startup',
      );

      expect(status).toBe(HTTP_STATUS.OK);

      // All top-level keys should be present
      expect(body).toHaveProperty('modelCapabilities');
      expect(body).toHaveProperty('conversations');
      expect(body).toHaveProperty('feedMessages');
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('skills');
      expect(body).toHaveProperty('mcps');
      expect(body).toHaveProperty('tools');
      expect(body).toHaveProperty('ragProjects');
      expect(body).toHaveProperty('agentTemplates');
      expect(body).toHaveProperty('commandTriggers');
    });

    it('GET /api/startup returns sensible defaults for empty data dirs', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        tasks: unknown[];
        skills: unknown[];
        mcps: unknown[];
        tools: { builtin: unknown[]; user: unknown[]; mcp: Record<string, unknown> };
        ragProjects: unknown[];
      }>('/api/startup');

      // Empty tasks dir
      expect(body.tasks).toEqual([]);

      // Skills may include builtins
      expect(Array.isArray(body.skills)).toBe(true);

      // No MCP servers
      expect(body.mcps).toEqual([]);

      // Real native tools registered, no user or MCP tools
      expect(body.tools.builtin.length).toBeGreaterThan(0);
      expect(body.tools.user).toEqual([]);
      expect(body.tools.mcp).toEqual({});

      // Empty RAG dir
      expect(body.ragProjects).toEqual([]);
    });

    it('GET /api/startup includes feed messages with pagination', async () => {
      const api = harness.api();
      const { body } = await api.getJson<{
        feedMessages: {
          items: unknown[];
          pagination: { hasOlder: boolean; hasNewer: boolean };
        };
      }>('/api/startup');

      expect(body.feedMessages).toHaveProperty('items');
      expect(body.feedMessages).toHaveProperty('pagination');
      expect(Array.isArray(body.feedMessages.items)).toBe(true);
    });

    it('GET /api/startup conversations include well-known feed at top', async () => {
      const api = harness.api();

      // Create some conversations so list has more than just feed
      await api.post('/api/conversations', { title: 'Extra 1' });
      await api.post('/api/conversations', { title: 'Extra 2' });

      const { body } = await api.getJson<{
        conversations: Array<{ id: string; isWellKnown: boolean }>;
      }>('/api/startup');

      // Feed should be first (well-known sorted to top)
      expect(body.conversations.length).toBeGreaterThanOrEqual(3);
      expect(body.conversations[0].id).toBe('feed');
      expect(body.conversations[0].isWellKnown).toBe(true);
    });
  });
});
