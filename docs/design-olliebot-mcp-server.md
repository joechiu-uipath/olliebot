# OllieBot MCP Server - Technical Design

## Overview

Expose OllieBot's internal functionality as an MCP (Model Context Protocol) server, primarily for development diagnostics. This allows external MCP clients (Claude Desktop, Claude Code, other LLM tools) to inspect, query, and interact with a running OllieBot instance.

---

## Tool Inventory

### Category 1: Logs & Observability

| Tool | Description | Wraps |
|------|-------------|-------|
| `server_log` | Read recent Node.js console output (timestamped, circular buffer). Supports filtering by level (log/warn/error) and substring grep. | New — requires console interception |
| `web_log` | Read browser-side `console.*` lines forwarded from the web UI. Same circular buffer + filter pattern. | New — requires WebSocket forwarding from frontend |
| `health` | Server uptime, memory usage (RSS/heap), connected WebSocket clients, LLM provider info, active agent count. | Partially new; client count from `GET /api/clients` |

### Category 2: Data Inspection

| Tool | Description | Wraps |
|------|-------------|-------|
| `db_query` | Execute a read-only AlaSQL query and return results as JSON. Write queries rejected. | New — direct AlaSQL access |
| `list_conversations` | List conversations with id, title, createdAt, updatedAt, message count. Supports limit param. | `GET /api/conversations` |
| `list_messages` | Paginated messages for a conversation. Params: conversationId, limit, before/after cursor. | `GET /api/conversations/:id/messages` |

### Category 3: Tool System

| Tool | Description | Wraps |
|------|-------------|-------|
| `list_tools` | All available tools organized by source (native, user, MCP) with name, description, and input schema. | `GET /api/tools` |
| `get_tool_schema` | Detailed JSON Schema for a single tool's input parameters. | `ToolRunner.getToolDefinitions()` |
| `run_tool` | Execute any tool (native, user, or MCP) with a given parameter object. Returns the raw tool result. Intended for debugging — bypasses the agent loop. | `ToolRunner.executeTool()` |

### Category 4: Agent System

| Tool | Description | Wraps |
|------|-------------|-------|
| `list_agents` | Active agents — id, name, emoji, role, parent, status. | `GET /api/agents` |
| `get_agent_state` | Supervisor state snapshot — currently processing, conversation context, active workers. | `GET /api/state` |

### Category 5: Configuration & Management

| Tool | Description | Wraps |
|------|-------------|-------|
| `list_mcp_servers` | Connected MCP servers with id, name, enabled, transport type, tool count. | `GET /api/mcps` |
| `toggle_mcp_server` | Enable or disable an MCP server at runtime. | `PATCH /api/mcps/:id` |
| `list_tasks` | Scheduled tasks with id, name, description, cron schedule, status, lastRun, nextRun. | `GET /api/tasks` |
| `run_task` | Trigger a scheduled task immediately. | `POST /api/tasks/:id/run` |
| `list_skills` | Available skills with metadata (name, description, source). | `GET /api/skills` |
| `get_config` | Runtime configuration snapshot (providers, models, enabled features). API keys redacted. | New — reads from CONFIG + env |

### Category 6: Interaction

| Tool | Description | Wraps |
|------|-------------|-------|
| `send_message` | Send a user message to OllieBot and receive the agent's response. Params: content, conversationId (optional). Synchronous — waits for the full response. | `POST /api/messages` / supervisor.handleMessage |

**Total: 18 tools** (7 requested + 11 suggested)

---

## Architecture

### In-Process MCP Server

The MCP server runs **inside the OllieBot process**, not as a separate proxy.

Rationale:
- `server_log` requires intercepting `console.*` in the same process.
- Direct access to `ToolRunner`, `MCPClient`, `db`, agent registry avoids HTTP overhead.
- Can expose internal state (memory usage, agent internals) that REST APIs don't cover.
- Simpler deployment — no extra process to manage.

```
                           ┌─────────────────────────────────────┐
                           │         OllieBot Process            │
                           │                                     │
  Claude Desktop ──stdio──▶│  ┌───────────────────────┐         │
  Claude Code    ──stdio──▶│  │   OllieBotMCPServer   │         │
                           │  │                       │         │
                           │  │  ┌─────────────────┐  │         │
                           │  │  │  Tool Handlers   │──┼────────▶ ToolRunner
                           │  │  │                 │  │         │
                           │  │  │  server_log ────│──┼────────▶ LogBuffer
                           │  │  │  db_query ──────│──┼────────▶ AlaSQL (getDb)
                           │  │  │  list_* ────────│──┼────────▶ DB Repositories
                           │  │  │  run_tool ──────│──┼────────▶ ToolRunner
                           │  │  │  send_message ──│──┼────────▶ SupervisorAgent
                           │  │  │  health ────────│──┼────────▶ process.memoryUsage
                           │  │  └─────────────────┘  │         │
                           │  └───────────────────────┘         │
                           │                                     │
  Web UI ──WebSocket──────▶│  AssistantServer (Express)          │
                           └─────────────────────────────────────┘
```

### Transport: Stdio

The MCP server exposes a **stdio** transport. OllieBot launches a child stdin/stdout pipe internally, or external clients connect via a wrapper command:

```bash
# Usage from Claude Desktop or other MCP clients:
node dist/mcp-server.js
```

This is a thin entry point that:
1. Connects to the running OllieBot instance via a local IPC mechanism (Unix socket or named pipe), OR
2. Runs as an embedded part of OllieBot started with a flag: `node dist/index.js --mcp-server`

**Recommended approach: Flag-based embedded mode** (`--mcp-server`).

When `--mcp-server` is passed:
- OllieBot initializes normally (DB, tools, agents, etc.)
- Instead of starting the HTTP server, it starts the MCP stdio server.
- The stdio server reads JSON-RPC from stdin, writes to stdout.
- Console logs are redirected to stderr (so they don't corrupt the JSON-RPC stream).

This keeps the MCP server as a first-class mode alongside `server` and `console`.

### Standalone Entry Point

Additionally, provide `src/mcp-server/standalone.ts` — a **lightweight REST-proxy mode** that connects to a running OllieBot HTTP server. This covers the case where OllieBot is already running and a developer wants to attach an MCP client to it:

```bash
# Attach to running OllieBot:
OLLIEBOT_URL=http://localhost:3000 node dist/mcp-server/standalone.js
```

In this mode, `server_log` and `web_log` are unavailable (no process access), but all REST-backed tools work. The standalone entry point is secondary and can be deferred to a later phase.

---

## Module Structure

```
src/mcp-server/
├── index.ts                 # OllieBotMCPServer class — main orchestrator
├── server.ts                # MCP protocol handler (JSON-RPC over stdio)
├── tools/                   # One file per tool (or per category)
│   ├── logs.ts              # server_log, web_log, health
│   ├── data.ts              # db_query, list_conversations, list_messages
│   ├── tools.ts             # list_tools, get_tool_schema, run_tool
│   ├── agents.ts            # list_agents, get_agent_state
│   ├── config.ts            # list_mcp_servers, toggle_mcp_server, list_tasks, run_task, list_skills, get_config
│   └── interaction.ts       # send_message
├── log-buffer.ts            # Circular buffer + console interception
└── types.ts                 # Shared types
```

---

## Key Implementation Details

### 1. Log Capture (`log-buffer.ts`)

```typescript
class LogBuffer {
  private buffer: LogEntry[];   // Circular buffer
  private maxSize: number;      // Default: 1000 entries
  private head: number;

  /** Intercept console.log/warn/error and tee into buffer */
  install(): void;

  /** Query the buffer */
  query(options: {
    level?: 'log' | 'warn' | 'error';
    grep?: string;
    limit?: number;
    since?: string;   // ISO timestamp
  }): LogEntry[];
}

interface LogEntry {
  timestamp: string;      // ISO 8601
  level: 'log' | 'warn' | 'error';
  message: string;        // Joined args as string
  source: 'server';       // or 'web' for web_log
}
```

**Console interception strategy:**
- Wrap `console.log`, `console.warn`, `console.error` with proxies.
- Proxy calls the original function (so output still appears in terminal/stderr) AND pushes to the circular buffer.
- In `--mcp-server` mode, original output goes to **stderr** (stdout reserved for JSON-RPC).
- Installed early in the startup sequence, before any other initialization.

### 2. Web Log Forwarding

The frontend sends browser console logs to the backend via a new WebSocket message type:

```typescript
// Frontend sends:
{ type: 'web_log', level: 'log', message: '...', timestamp: '...' }
```

The backend's WebSocket handler writes these into the same `LogBuffer` with `source: 'web'`.

The `web_log` MCP tool queries the buffer filtered by `source === 'web'`.

**Frontend change:** A small console interceptor script in the web app that forwards `console.log/warn/error` over the existing WebSocket connection. Gated behind a `DEBUG` flag to avoid noise in production.

### 3. db_query Safety

```typescript
// Only allow SELECT statements
function validateQuery(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed');
  }
  // Block common injection patterns
  const blocked = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE'];
  for (const keyword of blocked) {
    if (normalized.includes(keyword)) {
      throw new Error(`Query contains blocked keyword: ${keyword}`);
    }
  }
}
```

Additional safety: execute in a try-catch with a result row limit (default 100) to prevent accidentally dumping the entire message table.

### 4. run_tool Execution

```typescript
// Direct ToolRunner invocation, bypassing the agent loop
async function runTool(params: {
  tool_name: string;
  parameters: Record<string, unknown>;
}): Promise<ToolResult> {
  const { source, name } = toolRunner.parseToolName(params.tool_name);
  return toolRunner.executeTool({
    id: crypto.randomUUID(),
    toolName: params.tool_name,
    parameters: params.parameters,
  });
}
```

This gives raw access to any registered tool. The caller provides the full tool name (e.g., `web_search`, `user.my_tool`, `mcp.github__list_repos`).

### 5. send_message Flow

```typescript
async function sendMessage(params: {
  content: string;
  conversation_id?: string;
}): Promise<{ response: string; conversation_id: string }> {
  // Create a synthetic message
  const message = {
    id: crypto.randomUUID(),
    channel: 'mcp-server',
    role: 'user' as const,
    content: params.content,
    createdAt: new Date(),
    metadata: {
      conversationId: params.conversation_id || undefined,
    },
  };

  // Wait for the supervisor to process and collect the response
  const response = await supervisor.handleMessage(message);
  return {
    response: response.content,
    conversation_id: response.conversationId,
  };
}
```

This is synchronous from the MCP client's perspective — the tool call blocks until the agent responds. For long-running agent tasks, the MCP client will wait (MCP supports long-running tool calls).

### 6. MCP Protocol Handling (`server.ts`)

Use a **custom lightweight implementation** consistent with the existing `src/mcp/client.ts` style (the codebase already implements MCP JSON-RPC without the official SDK).

```typescript
class MCPServerTransport {
  /** Read JSON-RPC requests from stdin, dispatch to tool handlers */
  async start(): Promise<void>;

  /** Register a tool with its handler */
  registerTool(definition: MCPToolDefinition, handler: ToolHandler): void;

  /** Send JSON-RPC response to stdout */
  private respond(id: number, result: unknown): void;

  /** Handle initialize, tools/list, tools/call */
  private dispatch(method: string, params: unknown, id: number): Promise<void>;
}
```

Supports the MCP methods:
- `initialize` — returns server info and capabilities
- `tools/list` — returns all 18 tool definitions with JSON schemas
- `tools/call` — dispatches to the appropriate handler

This mirrors the protocol the existing client speaks, keeping the codebase consistent.

**Alternative:** Use `@modelcontextprotocol/sdk` package. The tradeoff is an additional dependency vs. a few hundred lines of custom code. Given the codebase already implements custom MCP JSON-RPC, staying consistent is preferable. We can revisit if the protocol evolves significantly.

---

## Startup Modes

After this change, `src/index.ts` supports three modes:

| Command | Mode | Description |
|---------|------|-------------|
| `node dist/index.js` | `server` | HTTP + WebSocket (default, current behavior) |
| `node dist/index.js console` | `console` | Terminal CLI (current behavior) |
| `node dist/index.js mcp-server` | `mcp-server` | MCP stdio server (new) |

In `mcp-server` mode:
1. Initialize DB, LLM, tools, agents (same as other modes).
2. Redirect console output to stderr.
3. Install `LogBuffer` console interception.
4. Create `OllieBotMCPServer` with references to all services.
5. Start the stdio JSON-RPC listener on stdin/stdout.
6. Handle graceful shutdown on SIGINT/SIGTERM.

---

## MCP Client Configuration

To connect to OllieBot from Claude Desktop:

```json
{
  "mcpServers": {
    "olliebot": {
      "command": "node",
      "args": ["dist/index.js", "mcp-server"],
      "cwd": "/path/to/olliebot",
      "env": {
        "ANTHROPIC_API_KEY": "...",
        "DB_PATH": "user/data/olliebot.db"
      }
    }
  }
}
```

Or from Claude Code:
```bash
claude mcp add olliebot -- node /path/to/olliebot/dist/index.js mcp-server
```

---

## Tool Schemas (Representative Examples)

### server_log

```json
{
  "name": "server_log",
  "description": "Read recent Node.js server console output. Returns timestamped log lines from a circular buffer.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "level": {
        "type": "string",
        "enum": ["log", "warn", "error"],
        "description": "Filter by log level. Omit for all levels."
      },
      "grep": {
        "type": "string",
        "description": "Substring filter — only return lines containing this string."
      },
      "limit": {
        "type": "number",
        "description": "Max lines to return. Default 50, max 500."
      },
      "since": {
        "type": "string",
        "description": "ISO 8601 timestamp — only return lines after this time."
      }
    }
  }
}
```

### db_query

```json
{
  "name": "db_query",
  "description": "Execute a read-only SQL query against the OllieBot database (AlaSQL). Only SELECT statements allowed. Tables: conversations, messages, tasks, embeddings.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "SQL SELECT query to execute."
      },
      "limit": {
        "type": "number",
        "description": "Max rows to return. Default 100, max 1000."
      }
    },
    "required": ["query"]
  }
}
```

### run_tool

```json
{
  "name": "run_tool",
  "description": "Execute an OllieBot tool directly with specific parameters. Bypasses the agent loop. Use list_tools to discover available tools and get_tool_schema for parameter details.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tool_name": {
        "type": "string",
        "description": "Full tool name (e.g., 'web_search', 'user.my_tool', 'mcp.github__list_repos')."
      },
      "parameters": {
        "type": "object",
        "description": "Tool input parameters as a JSON object."
      }
    },
    "required": ["tool_name", "parameters"]
  }
}
```

---

## Phasing

### Phase 1 — Core (this PR)
- `LogBuffer` with console interception
- MCP stdio server protocol handler
- `--mcp-server` startup mode
- Tools: `server_log`, `health`, `db_query`, `list_conversations`, `list_messages`, `list_tools`, `get_tool_schema`, `run_tool`
- 8 tools, all backed by in-process state

### Phase 2 — Agent & Config tools
- Tools: `list_agents`, `get_agent_state`, `list_mcp_servers`, `toggle_mcp_server`, `list_tasks`, `run_task`, `list_skills`, `get_config`
- 8 more tools, primarily thin wrappers over existing APIs

### Phase 3 — Interaction & Web logs
- `send_message` (requires careful handling of async agent responses)
- `web_log` (requires frontend console interceptor + WebSocket forwarding)
- Standalone REST-proxy mode (`standalone.ts`)

---

## Open Questions

1. **SDK vs custom:** The design proposes a custom JSON-RPC handler to match the existing codebase style. Should we adopt `@modelcontextprotocol/sdk` instead for future-proofing?

2. **web_log frontend change:** The frontend console interceptor adds a small amount of code to the web bundle. Should this be always-on or toggled via a setting/env var?

3. **send_message semantics:** Should this block until the full agent response, or return immediately with a handle to poll? Blocking is simpler but could hit MCP client timeouts for long agent tasks.

4. **Log buffer size:** Default 1000 entries. Should this be configurable via env var?

5. **Authentication:** The MCP server currently has no auth (stdio is inherently local). If we add HTTP/SSE transport later, we'll need token-based auth. Defer to Phase 3?
