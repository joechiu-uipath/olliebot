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
});
