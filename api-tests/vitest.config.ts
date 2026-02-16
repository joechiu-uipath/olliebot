/**
 * Vitest configuration for API integration tests.
 *
 * Runs against a real AssistantServer with an in-memory SQLite database
 * and simulated dependencies. Each test file gets its own server instance
 * on a dynamically-assigned port so multiple suites (and the dev server)
 * can run in parallel on the same machine.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api-tests/tests/**/*.test.ts'],
    // Each file gets its own isolated fork so server ports don't collide
    isolate: true,
    fileParallelism: true,
    // API tests are slower than unit tests — generous timeout
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage-api',
      // Only measure the API surface — the code these tests are intended to exercise
      include: [
        'src/server/**/*.ts',
        'src/channels/websocket.ts',
        'src/db/index.ts',
        'src/db/well-known-conversations.ts',
        'src/settings/service.ts',
        'src/missions/manager.ts',
        'src/missions/schema.ts',
        'src/evaluation/manager.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/types.ts',
      ],
    },
  },
});
