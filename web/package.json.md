# web/package.json Documentation

This document explains the purpose of each setting and dependency in the web workspace's `package.json`.

## Package Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| `name` | `olliebot-web` | Workspace package name. Used by pnpm for `--filter` commands (e.g., `pnpm --filter olliebot-web dev`). |
| `private` | `true` | Prevents accidental npm publish. This is an internal workspace, not a public package. |
| `version` | `0.1.0` | Internal version tracking. Not published, so mainly for reference. |
| `type` | `module` | Enables ES modules (import/export syntax). Required for Vite and modern JavaScript tooling. |

## Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Starts Vite dev server with hot module replacement (HMR). Runs on port 5173, proxies API calls to backend. |
| `build` | Production build via Vite. Outputs optimized bundle to `dist/` for static serving. |
| `preview` | Serves the production build locally for testing before deployment. |

## Dependencies

| Package | Status | Purpose |
|---------|--------|---------|
| `react` | ✅ Used | Core React library for building UI components. Version 19.x includes new features like React Compiler support. |
| `react-dom` | ✅ Used | React renderer for web/DOM. Required for any React web application. |
| `react-router-dom` | ✅ Used | Client-side routing. Used in `App.jsx`, `main.jsx`, and page components for navigation between views. |
| `react-syntax-highlighter` | ✅ Used | Syntax highlighting for code blocks. Used in `CodeBlock.jsx` and `EvalJsonEditor.jsx` for displaying formatted code. |
| `react-virtuoso` | ✅ Used | Virtualized list rendering for performance. Used in `App.jsx` and `AgentChat.jsx` to efficiently render long message lists without DOM bloat. |

## DevDependencies

| Package | Status | Purpose |
|---------|--------|---------|
| `@types/react` | ✅ Used | TypeScript definitions for React. Provides IDE intellisense and type checking even in JSX files. |
| `@types/react-dom` | ✅ Used | TypeScript definitions for ReactDOM. Complements `@types/react` for DOM-specific APIs. |
| `babel-plugin-react-compiler` | ✅ Used | React Compiler (experimental). Automatically memoizes components and hooks, reducing manual `useMemo`/`useCallback` usage. Configured in `vite.config.js`. |

## Notes

### Dependencies in Root package.json

The following packages are used by the web workspace but hoisted to the root `package.json` for centralized `node_modules`:

- `vite` - Build tool
- `@vitejs/plugin-react` - Vite React plugin
- `react-markdown` - Markdown rendering
- `prismjs` - Syntax highlighting themes
- `rehype-raw`, `rehype-sanitize` - HTML processing
- `remark-gfm` - GitHub Flavored Markdown

See root `package.json.md` for explanation of workspace hoisting.

### React Compiler

The React Compiler (`babel-plugin-react-compiler`) is enabled in `vite.config.js` with custom configuration:
- Skips `App.jsx` due to ref usage patterns the compiler misidentifies
- Logs compilation success/failure during development

This is an experimental feature from React 19 that auto-optimizes renders.
