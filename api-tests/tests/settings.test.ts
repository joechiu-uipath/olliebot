/**
 * API Tests — Settings
 *
 * Covers:
 *   SETTINGS-001  Get settings
 *   SETTINGS-002  Update settings
 *   SETTINGS-003  Settings persistence (within session)
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Settings', () => {
  // ---------------------------------------------------------------------------
  // Core CRUD
  // ---------------------------------------------------------------------------

  // SETTINGS-001
  it('GET /api/settings returns current settings', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{ disabled_mcps: string[]; disabled_tasks: string[] }>(
      '/api/settings',
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('disabled_mcps');
    expect(body).toHaveProperty('disabled_tasks');
    expect(Array.isArray(body.disabled_mcps)).toBe(true);
    expect(Array.isArray(body.disabled_tasks)).toBe(true);
  });

  // SETTINGS-002
  it('PATCH /api/settings updates settings', async () => {
    const api = harness.api();
    const { status, body } = await api.patchJson<{ disabled_mcps: string[] }>(
      '/api/settings',
      { disabled_mcps: ['server-a', 'server-b'] },
    );

    expect(status).toBe(200);
    expect(body.disabled_mcps).toEqual(['server-a', 'server-b']);
  });

  // SETTINGS-003
  it('updated settings persist across requests', async () => {
    const api = harness.api();

    // Update
    await api.patch('/api/settings', { disabled_tasks: ['task-x'] });

    // Read back
    const { body } = await api.getJson<{ disabled_tasks: string[] }>('/api/settings');
    expect(body.disabled_tasks).toContain('task-x');
  });

  // ---------------------------------------------------------------------------
  // Partial updates & merge semantics
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Response shape
  // ---------------------------------------------------------------------------

  it('GET /api/settings always returns expected shape', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<Record<string, unknown>>('/api/settings');

    expect(status).toBe(200);
    // Must always have these arrays, even if empty
    expect(Array.isArray(body.disabled_mcps)).toBe(true);
    expect(Array.isArray(body.disabled_tasks)).toBe(true);
  });
});
