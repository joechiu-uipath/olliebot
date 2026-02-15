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
      '**/e2e/**',
    ],
  },
});
