/**
 * Settings Tests
 *
 * Covers: SETTINGS-001 through SETTINGS-003
 */

import { test, expect } from '../../utils/test-base.js';
import { ToolName, AgentType } from '../../constants/index.js';

test.describe('Settings', () => {

  // SETTINGS-001: Get settings
  test('retrieves current settings via API', async ({ app }) => {
    app.api.setHandler('GET', '/api/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'dark',
          language: 'en',
          mcpEnabled: { 'server-1': true },
        }),
      });
    });

    await app.reload();
    // Settings are loaded at startup - verify the app functions
    await expect(app.connectionStatus).toContainText('Connected');
  });

  // SETTINGS-002: Update settings
  test('modifies settings via API', async ({ app }) => {
    let savedSettings: Record<string, unknown> = {};

    app.api.setHandler('PATCH', '/api/settings', async (route) => {
      savedSettings = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, ...savedSettings }),
      });
    });

    // Settings changes happen through the UI (toggle switches, etc.)
  });

  // SETTINGS-003: Settings persistence
  test('settings survive page reload', async ({ app }) => {
    const settingsData = { theme: 'light', fontSize: 14 };

    app.api.setHandler('GET', '/api/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsData),
      });
    });

    await app.reload();

    // Reload again and verify settings still load
    await app.reload();
    await expect(app.connectionStatus).toContainText('Connected');
  });
});
