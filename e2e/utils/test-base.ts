/**
 * Base test setup for all E2E tests.
 *
 * Extends Playwright's test with a custom `app` fixture that:
 * - Creates an OllieBotApp page object with API mocks + WebSocket mock
 * - Navigates to the app
 * - Cleans up after each test
 */

import { test as base } from '@playwright/test';
import { OllieBotApp } from '../pages/app.page.js';
import type { StartupData } from './api-mock.js';

/**
 * Extended test type with `app` fixture.
 *
 * Usage:
 *   import { test, expect } from '../utils/test-base';
 *   test('my test', async ({ app }) => {
 *     await app.chat.sendMessage('Hello');
 *   });
 */
export const test = base.extend<{
  app: OllieBotApp;
  startupData: Partial<StartupData>;
}>({
  // Default startup data can be overridden per-test
  startupData: [{}, { option: true }],

  app: async ({ page, startupData }, use) => {
    const app = new OllieBotApp(page, { startupData });
    await app.goto();
    await use(app);
  },
});

export { expect } from '@playwright/test';
