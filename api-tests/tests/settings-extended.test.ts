/**
 * API Tests — Settings (Extended)
 *
 * Covers meaningful gaps in settings API coverage:
 *   - Partial update preserves unrelated fields
 *   - MCP disable/enable through settings
 *   - Task disable/enable through settings
 *   - Settings merge semantics (array replacement, not append)
 *   - Empty arrays are valid settings values
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Settings — Extended', () => {
  it('partial update preserves unrelated fields', async () => {
    const api = harness.api();

    // Set both fields
    await api.patch('/api/settings', {
      disabled_mcps: ['mcp-a'],
      disabled_tasks: ['task-a'],
    });

    // Update only disabled_mcps
    await api.patch('/api/settings', {
      disabled_mcps: ['mcp-a', 'mcp-b'],
    });

    // disabled_tasks should still be preserved
    const { body } = await api.getJson<{ disabled_mcps: string[]; disabled_tasks: string[] }>(
      '/api/settings',
    );

    expect(body.disabled_mcps).toEqual(['mcp-a', 'mcp-b']);
    expect(body.disabled_tasks).toContain('task-a');
  });

  it('setting empty arrays clears disabled lists', async () => {
    const api = harness.api();

    // Set some values
    await api.patch('/api/settings', {
      disabled_mcps: ['mcp-x', 'mcp-y'],
    });

    // Clear with empty array
    await api.patch('/api/settings', {
      disabled_mcps: [],
    });

    const { body } = await api.getJson<{ disabled_mcps: string[] }>('/api/settings');
    expect(body.disabled_mcps).toEqual([]);
  });

  it('settings update replaces arrays (not appends)', async () => {
    const api = harness.api();

    await api.patch('/api/settings', { disabled_tasks: ['task-1', 'task-2'] });
    await api.patch('/api/settings', { disabled_tasks: ['task-3'] });

    const { body } = await api.getJson<{ disabled_tasks: string[] }>('/api/settings');
    // Should be replaced, not ['task-1', 'task-2', 'task-3']
    expect(body.disabled_tasks).toEqual(['task-3']);
  });

  it('GET /api/settings always returns expected shape', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<Record<string, unknown>>('/api/settings');

    expect(status).toBe(200);
    // Must always have these arrays, even if empty
    expect(Array.isArray(body.disabled_mcps)).toBe(true);
    expect(Array.isArray(body.disabled_tasks)).toBe(true);
  });
});
