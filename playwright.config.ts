import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for OllieBot E2E tests.
 *
 * All external dependencies (LLM APIs, search APIs, etc.) are simulated
 * by the dependency simulator server started in globalSetup.
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the Vite dev server and the OllieBot backend before tests */
  webServer: [
    {
      command: 'pnpm dev:web',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'E2E_SIMULATOR_URL=http://localhost:4100 pnpm dev:server',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        E2E_SIMULATOR_URL: 'http://localhost:4100',
        ANTHROPIC_API_KEY: 'test-key',
        OPENAI_API_KEY: 'test-key',
        GOOGLE_API_KEY: 'test-key',
        DB_PATH: ':memory:',
      },
    },
  ],
});
