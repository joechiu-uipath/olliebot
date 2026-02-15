# OllieBot - Personal Support Agent

A multi-channel AI assistant with continuous monitoring, agentic task execution, and browser/desktop automation.

## Tech Stack

- **Runtime**: Node.js with TypeScript (ES2022, ESM modules)
- **Package Manager**: pnpm with workspaces
- **Backend**: Hono + WebSocket server
- **Frontend**: React (JSX, Vite) in `web/` workspace
- **TUI**: React Ink in `tui/` workspace
- **Database**: SQLite via better-sqlite3
- **LLM Providers**: Anthropic, OpenAI, Azure OpenAI, Google
- **Testing**: Vitest

## Project Structure

```
src/
├── agents/           # Multi-agent architecture (supervisor, worker, mission-lead)
├── browser/          # Playwright browser automation with Computer Use
├── channels/         # Communication channels (console, web)
├── citations/        # Source citation extraction
├── db/               # SQLite database layer
├── deep-research/    # Multi-step research orchestration
├── desktop/          # Windows Sandbox + VNC automation
├── evaluation/       # Eval framework for testing agent behavior
├── llm/              # LLM provider abstraction (Anthropic, OpenAI, Google, Azure)
├── mcp/              # MCP client for external tool servers
├── mcp-server/       # OllieBot as MCP server
├── memory/           # Persistent memory service
├── missions/         # Long-running mission management
├── rag-projects/     # Vector embeddings + retrieval
├── self-coding/      # Frontend code modification tools
├── server/           # Hono HTTP + WebSocket server
├── services/         # Shared services
├── settings/         # User settings management
├── skills/           # User-defined skills (markdown-based)
├── tasks/            # Scheduled task execution
├── tools/            # Tool system (native + user-defined + MCP)
├── tracing/          # Execution trace logging
└── utils/            # Shared utilities

web/src/              # React frontend (Vite)
├── components/       # React components
├── contexts/         # React contexts
├── hooks/            # Custom React hooks
├── pages/            # Page components
└── utils/            # Frontend utilities

tui/src/              # Terminal UI (React Ink)

user/                 # User data directory (gitignored)
├── data/             # SQLite database
├── missions/         # Mission definitions (.md)
├── skills/           # Skill definitions (.md)
├── tasks/            # Task definitions (.md)
├── tools/            # User-defined tools (.md)
└── rag/              # RAG project data

sandbox/              # Windows Sandbox automation scripts
```

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start server + web UI concurrently
pnpm dev:server       # Start server only (with hot reload)
pnpm dev:web          # Start web UI only
pnpm dev:console      # Console/CLI mode
pnpm build            # Build all packages
pnpm typecheck        # TypeScript type checking
pnpm test             # Run tests
pnpm test:watch       # Run tests in watch mode
```

## Configuration

Copy `.env.example` to `.env` and configure:
- At least one LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or Azure)
- MAIN_PROVIDER/MAIN_MODEL for primary LLM
- FAST_PROVIDER/FAST_MODEL for cheap/fast tasks
- Optional: web search, image generation, voice, browser automation

## Architecture Notes

### Multi-Agent System
- **Supervisor** (`src/agents/supervisor.ts`): Routes messages, manages context, delegates to workers
- **Worker** (`src/agents/worker.ts`): Executes tool calls in agentic loops
- **MissionLead** (`src/agents/mission-lead.ts`): Manages long-running missions with todos/metrics

### Tool System
Tools are registered in `src/index.ts` via `ToolRunner`:
- **Native tools**: Built-in tools in `src/tools/native/`
- **User tools**: Markdown definitions in `user/tools/` (hot-reloaded)
- **MCP tools**: External tools via MCP protocol

### Browser Automation
Two strategies in `src/browser/strategies/`:
- **computer-use**: Screenshot + coordinate clicking (supports multiple providers)
- **dom**: CSS selector-based interaction

### Desktop Automation (Windows Sandbox)
- Launches Windows Sandbox with VNC server
- `sandbox/setup-vnc.ps1` runs inside sandbox to configure TightVNC
- VNC client in `src/desktop/vnc-client.ts` connects via rfb2 protocol
- See memory file for networking details (sandbox uses Hyper-V NAT)

## Code Conventions

### TypeScript
- Strict mode enabled
- Use ES module imports with `.js` extension in imports
- Prefer `interface` for object shapes, `type` for unions/aliases
- Use Zod for runtime validation of external data

### File Organization
- One main export per file, re-export from `index.ts`
- Colocate tests with source (`.test.ts` suffix)
- Types in `types.ts` within each module

### Error Handling
- Use `err.code` for Node.js socket errors (not just `err.message`)
- Always register 'error' event handlers on EventEmitters
- Clean up AbortSignal listeners after resolve/reject

### Async Patterns
- Use async-mutex for shared resource access
- Prefer Promise-based APIs over callbacks
- Handle cleanup in shutdown handlers

## Testing

```bash
pnpm test                    # Run all tests
pnpm test src/agents         # Run specific directory
pnpm test:watch              # Watch mode
```

Tests use Vitest. Mock external services and LLM calls.

## Common Gotchas

1. **PowerShell UTF-8 BOM**: `Out-File -Encoding UTF8` writes BOM - strip `\uFEFF` before JSON.parse
2. **rfb2 VNC auth**: Hangs on auth failure - listen on raw socket 'close' event
3. **Windows Sandbox networking**: localhost doesn't work - discover sandbox IP from shared folder
4. **Tool message status**: Mark as failed on session close to avoid stuck 'running' state
5. **ESM imports**: Always use `.js` extension even for `.ts` files
