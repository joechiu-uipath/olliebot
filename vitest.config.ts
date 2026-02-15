import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      // Exclude compiled JavaScript test files in dist/ directory.
      //
      // Why this is necessary:
      // 1. TypeScript compiler (tsc) compiles ALL .ts files to dist/, including test files
      // 2. Vitest's default pattern matches both *.test.ts (source) and *.test.js (compiled)
      // 3. Without this exclusion, vitest runs tests TWICE: once from src/, once from dist/
      // 4. The dist/ versions can become stale if you modify source but don't rebuild
      // 5. This causes confusing failures where src/ tests pass but dist/ tests fail
      //
      // Example of the problem:
      // - You edit src/agents/supervisor.test.ts
      // - You run `npm test` without rebuilding
      // - Vitest runs both src/agents/supervisor.test.ts (updated) and
      //   dist/agents/supervisor.test.js (stale from previous build)
      // - The stale dist/ version fails, even though your changes are correct
      //
      // Alternative fix: Add "exclude": ["**/*.test.ts"] to tsconfig.json to prevent
      // test files from being compiled. However, this breaks IDE features for test files.
      '**/dist/**',
    ],
    coverage: {
      // Exclude non-production code from coverage reporting.
      // Without an explicit `include`, vitest reports coverage only for files
      // actually imported during the test run — this is intentional so the
      // percentage reflects "how well-tested is the code we DO exercise" rather
      // than being diluted by modules with no tests yet.
      exclude: [
        // Test files themselves
        '**/*.test.ts',

        // Test infrastructure — utilities, builders, and helpers used only by tests
        'src/test-helpers/**',

        // MCP debug server — internal dev/debug tool that exposes OllieBot internals
        // over MCP protocol for inspection; not user-facing production code
        'src/mcp-server/**',
      ],
      // 'text' = terminal summary table (always on)
      // 'html' = interactive line-by-line report at coverage/index.html
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
