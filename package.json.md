# package.json Documentation

This document explains the purpose and use case for each script and devDependency in the root `package.json`.

## Scripts

### Development Scripts

| Script | Purpose |
|--------|---------|
| `dev` | **Primary development command.** Runs both the backend server and web UI concurrently. Output is color-coded (blue for server, green for web). Use this for normal full-stack development. |
| `dev:server` | Runs only the backend server with hot reload. Watches `src/` and `.env` for changes. The `--inspect` flag enables Node.js debugger on port 9229. Use when working on backend-only changes. |
| `dev:server-proxy` | Same as `dev:server` but routes traffic through a local HTTP proxy (port 8888). Useful for debugging API calls with tools like Fiddler, Charles, or mitmproxy. Disables TLS verification for proxy MITM. |
| `dev:console` | Runs OllieBot in console/CLI mode without starting the web server. Direct terminal interaction with the bot. |
| `dev:web` | Runs only the Vite dev server for the web UI (port 5173). Proxies API/WebSocket requests to backend. Use when working on frontend-only changes (requires backend running separately). |
| `dev:tui` | Runs the Terminal User Interface (React Ink). Alternative to web UI for terminal-based interaction. |

### Build Scripts

| Script | Purpose |
|--------|---------|
| `build` | **Full production build.** Builds server, web UI, and TUI sequentially. Run before deployment. |
| `build:server` | Compiles TypeScript server code to `dist/`. Output is ES modules targeting ES2022. |
| `build:web` | Builds the web UI via Vite. Output goes to `web/dist/` for static serving. |
| `build:tui` | Compiles TUI TypeScript to `tui/dist/`. |

### Utility Scripts

| Script | Purpose |
|--------|---------|
| `start` | Runs the compiled production server. Requires `build:server` first. |
| `typecheck` | Type-checks the codebase without emitting files. Fast way to catch type errors. Run in CI or before commits. |
| `migrate:json-to-sqlite` | One-time migration script to move data from legacy JSON storage to SQLite. Only needed during initial migration. |
| `test` | Runs all tests once with Vitest. Use in CI or for final verification. |
| `test:watch` | Runs Vitest in watch mode. Re-runs affected tests on file changes. Use during active development. |

---

## DevDependencies

### Type Definitions

| Package | Status | Purpose |
|---------|--------|---------|
| `@types/better-sqlite3` | ✅ Used | TypeScript definitions for `better-sqlite3`. Required for type-safe SQLite operations in `src/db/`. |
| `@types/cors` | ✅ Used | TypeScript definitions for `cors` middleware. Used in Express server setup. |
| `@types/express` | ✅ Used | TypeScript definitions for Express.js. Essential for typed request/response handlers in `src/server/`. |
| `@types/html-to-text` | ✅ Used | TypeScript definitions for `html-to-text`. Used in content extraction utilities. |
| `@types/multer` | ✅ Used | TypeScript definitions for `multer` file upload middleware. Used in `src/rag-projects/routes.ts`. |
| `@types/node` | ✅ Used | TypeScript definitions for Node.js built-in modules (fs, path, http, etc.). Essential for any Node.js TypeScript project. |
| `@types/pngjs` | ✅ Used | TypeScript definitions for `pngjs`. Used in screenshot processing for desktop/browser automation. |
| `@types/uuid` | ✅ Used | TypeScript definitions for `uuid`. Used throughout for generating unique IDs. |
| `@types/ws` | ✅ Used | TypeScript definitions for `ws` WebSocket library. Used in server WebSocket handling. |

### Build & Development Tools

| Package | Status | Purpose |
|---------|--------|---------|
| `typescript` | ✅ Essential | TypeScript compiler. Core dependency for type checking and building the project. |
| `tsx` | ✅ Used | TypeScript execution engine. Runs `.ts` files directly without pre-compilation. Used in all `dev:*` scripts for fast iteration. Faster than `ts-node`. |
| `nodemon` | ✅ Used | File watcher that restarts the server on changes. Used in `dev:server` scripts for hot reload during development. |
| `concurrently` | ✅ Used | Runs multiple commands in parallel with labeled output. Used in `dev` script to run server and web UI together. |
| `cross-env` | ✅ Used | Sets environment variables cross-platform (Windows/Unix). Used in `dev:server-proxy` to set proxy environment variables. |
| `vite` | ✅ Used | Vite build tool. Used by `web/` workspace. Placed in root for workspace hoisting (see note below). |
| `@vitejs/plugin-react` | ✅ Used | Vite plugin for React with Fast Refresh. Used in `web/vite.config.js`. Placed in root for workspace hoisting. |

### Testing

| Package | Status | Purpose |
|---------|--------|---------|
| `vitest` | ✅ Used | Test runner compatible with Vite. Used for all unit and integration tests. Fast, ESM-native, and Jest-compatible API. |

---

## Notes

### Workspace Structure & Hoisting

This is a pnpm monorepo with two workspaces:
- `web/` - React frontend (Vite)
- `tui/` - Terminal UI (React Ink)

**Workspace hoisting** means placing dependencies in the root `package.json` so they install into the top-level `node_modules/` rather than each workspace's own `node_modules/`. Benefits:

1. **Single source of truth** - One copy of each package, avoiding version mismatches between workspaces
2. **Faster installs** - No duplicate downloads or disk usage
3. **Simpler debugging** - All dependencies in one predictable location
4. **Shared tooling** - Build tools like Vite, TypeScript, and test runners work consistently across all workspaces

Dependencies like `vite`, `@vitejs/plugin-react`, `react-markdown`, `prismjs`, `rehype-*`, and `remark-*` are placed in root even though they're primarily used by the `web/` workspace. This keeps `node_modules/` centralized at the project root.

