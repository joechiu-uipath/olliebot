# OllieBot MCP Server - Technical Design

## Overview

Expose OllieBot's internal functionality as an MCP (Model Context Protocol) server, primarily for development diagnostics. This allows external MCP clients (Claude Desktop, Claude Code, other LLM tools) to inspect, query, and interact with an **already-running** OllieBot instance.

---

## Tool Inventory

### Category 1: Logs & Observability

| Tool | Description | Wraps |
|------|-------------|-------|
| `server_log` | Read recent Node.js console output (timestamped, circular buffer). Supports filtering by level (log/warn/error) and substring grep. | New — requires console interception |
| `web_log` | Read browser-side `console.*` lines forwarded from the web UI. Same circular buffer + filter pattern. | New — requires WebSocket forwarding from frontend |
| `health` | Server uptime, memory usage (RSS/heap), connected WebSocket clients, LLM provider info, active agent count. | Partially new; client count from `GET /api/clients` |

### Category 2: Data Inspection

| Tool | Description | Internal Service |
|------|-------------|-----------------|
| `db_query` | Execute a read-only AlaSQL query and return results as JSON. Write queries rejected. | `getDb()` — direct AlaSQL access |
| `list_conversations` | List conversations with id, title, createdAt, updatedAt, message count. Supports limit param. | `db.conversations` repository |
| `list_messages` | Paginated messages for a conversation. Params: conversationId, limit, before/after cursor. | `db.messages` repository |

### Category 3: Tool System

| Tool | Description | Internal Service |
|------|-------------|-----------------|
| `list_tools` | All available tools organized by source (native, user, MCP) with name, description, and input schema. | `ToolRunner.getToolDefinitions()` |
| `get_tool_schema` | Detailed JSON Schema for a single tool's input parameters. | `ToolRunner.getToolDefinitions()` |
| `run_tool` | Execute any tool (native, user, or MCP) with a given parameter object. Returns the raw tool result. Intended for debugging — bypasses the agent loop. | `ToolRunner.executeTool()` |

### Category 4: Agent System

| Tool | Description | Internal Service |
|------|-------------|-----------------|
| `list_agents` | Active agents — id, name, emoji, role, parent, status. | `AgentRegistry.getActiveAgents()` |
| `get_agent_state` | Supervisor state snapshot — currently processing, conversation context, active workers. | `SupervisorAgent.getState()` |

### Category 5: Configuration & Management

| Tool | Description | Internal Service |
|------|-------------|-----------------|
| `list_mcp_servers` | Connected MCP servers with id, name, enabled, transport type, tool count. | `MCPClient.getServers()` |
| `toggle_mcp_server` | Enable or disable an MCP server at runtime. | `MCPClient.setServerEnabled()` |
| `list_tasks` | Scheduled tasks with id, name, description, cron schedule, status, lastRun, nextRun. | `db.tasks` repository |
| `run_task` | Trigger a scheduled task immediately. | `TaskManager.runTask()` |
| `list_skills` | Available skills with metadata (name, description, source). | `SkillManager.getSkillsMetadata()` |
| `get_config` | Runtime configuration snapshot (providers, models, enabled features). API keys redacted. | CONFIG object + env |

### Category 6: Interaction

| Tool | Description | Internal Service |
|------|-------------|-----------------|
| `send_message` | Send a user message to OllieBot and receive the agent's response. Params: content, conversationId (optional). Synchronous — waits for the full response. | `SupervisorAgent.handleMessage()` |

**Total: 18 tools** (7 requested + 11 suggested)

---

## Architecture

### Design Principle: `/mcp` Is an Isolated Surface

The MCP server is a **self-contained boundary** behind `/mcp`. It does not expose or proxy the raw REST API (`/api/*`). MCP tool handlers talk directly to internal services (ToolRunner, DB repositories, agent registry), not to REST endpoints.

This means:
- **No leakage.** `/api/*` routes are never visible to MCP clients. Renaming or removing a REST endpoint has zero impact on MCP.
- **Constrain or enhance.** Each MCP tool handler controls exactly what it exposes. `db_query` enforces read-only even though the DB supports writes. `list_messages` could return richer metadata than the REST API does. `run_tool` can add guardrails the REST API doesn't have.
- **Independent evolution.** The MCP tool interface can change shape, add fields, or tighten validation without touching the REST API — and vice versa.
- **Single security boundary.** Auth, rate limiting, or access control for MCP is applied at `/mcp` in one place. It doesn't inherit REST API middleware or CORS config.

```
  Express Server (localhost:3000)
  │
  ├── /api/*    ← REST API for web frontend (existing, unchanged)
  ├── /ws       ← WebSocket for web frontend (existing, unchanged)
  │
  └── /mcp      ← MCP Streamable HTTP (new, isolated)
       │
       │  All MCP traffic goes through this single route.
       │  POST, GET (SSE), DELETE — all on /mcp.
       │  No sub-routes, no /mcp/tools, no /mcp/api.
       │  Tool dispatch is internal via JSON-RPC method routing.
       │
       ▼
  ┌─────────────────────────┐
  │   OllieBotMCPServer     │
  │                         │
  │   Tool handlers call    │
  │   internal services     │──▶ ToolRunner (not /api/tools)
  │   directly, NOT the     │──▶ getDb() (not /api/conversations)
  │   REST API.             │──▶ AgentRegistry (not /api/agents)
  │                         │──▶ LogBuffer (not exposed via REST at all)
  │                         │──▶ SupervisorAgent (not /api/messages)
  └─────────────────────────┘
```

### In-Process, on the Running Server

The MCP server runs **inside the already-running OllieBot process** — not as a separate mode or separate process.

This is the same pattern as GitHub MCP: GitHub is already running, the MCP client connects to it. OllieBot is already running during development; the MCP endpoint is mounted alongside (but isolated from) `/api/*`.

Rationale:
- OllieBot is already running during development — no need to start a second instance.
- `server_log` requires intercepting `console.*` in the same process.
- Direct access to internal services — no HTTP-to-HTTP proxy overhead.
- The MCP endpoint is wired up during normal `AssistantServer` initialization, but its handlers are entirely independent of the REST routes.

### Transport: Streamable HTTP (Primary)

The MCP spec defines a **Streamable HTTP** transport. The server exposes an HTTP endpoint; the client POSTs JSON-RPC requests and receives JSON responses. For server-initiated messages (notifications, progress), Server-Sent Events (SSE) are used.

Everything goes through `/mcp` — a single route, three HTTP verbs:

```bash
# Claude Code connects to running OllieBot:
claude mcp add --transport http olliebot http://localhost:3000/mcp
```

**How it works:**
- `POST /mcp` — Client sends JSON-RPC request (`initialize`, `tools/list`, `tools/call`). Server responds with JSON.
- `GET /mcp` — SSE stream for server-to-client notifications (optional, for progress/streaming).
- `DELETE /mcp` — Session teardown (optional).

This uses the same Express server and port that's already running. No new ports, no new processes. But the `/mcp` route has its own middleware stack — it does not share CORS, auth, or error handling with `/api/*`.

### Transport: Stdio Shim (Secondary, for compatibility)

Some MCP clients (certain Claude Desktop configs) only support stdio. For those, provide a thin **stdio-to-HTTP proxy**:

```bash
# Thin shim: reads JSON-RPC from stdin, POSTs to running OllieBot, writes response to stdout
OLLIEBOT_URL=http://localhost:3000 node dist/mcp-server/stdio-shim.js
```

This is ~50 lines of code — just a pipe between stdin/stdout and `fetch()` calls to `/mcp`. It can be added later if needed.

### Why NOT a Separate Startup Mode

A separate `--mcp-server` or `mcp-server` startup mode would:
- Spin up an entirely new OllieBot instance (DB, LLM, tools, agents) just for MCP.
- Not see the state of the instance you're actually developing/debugging.
- Compete for the same port and database file.
- Defeat the purpose of diagnostics — you want to inspect the running instance, not a parallel one.

The embedded HTTP endpoint avoids all of these issues.

---

## Module Structure

```
src/mcp-server/
├── index.ts                 # OllieBotMCPServer class — main orchestrator
├── handler.ts               # Streamable HTTP request handler (JSON-RPC dispatch)
├── tools/                   # One file per tool category
│   ├── logs.ts              # server_log, web_log, health
│   ├── data.ts              # db_query, list_conversations, list_messages
│   ├── tools.ts             # list_tools, get_tool_schema, run_tool
│   ├── agents.ts            # list_agents, get_agent_state
│   ├── config.ts            # list_mcp_servers, toggle_mcp_server, list_tasks, run_task, list_skills, get_config
│   └── interaction.ts       # send_message
├── log-buffer.ts            # Circular buffer + console interception
└── types.ts                 # Shared types
```

### Integration Point

In `src/server/index.ts` (AssistantServer), the MCP server is mounted during `start()`:

```typescript
import { OllieBotMCPServer } from '../mcp-server/index.js';

// Inside AssistantServer.start():
const mcpServer = new OllieBotMCPServer({
  toolRunner: this.toolRunner,
  mcpClient: this.mcpClient,
  supervisor: this.supervisor,
  skillManager: this.skillManager,
  taskManager: this.taskManager,
  logBuffer,   // installed early in startup
  // ... other service references
});

// Mount the MCP endpoint — isolated from /api/* routes
// Gets its own middleware stack (no shared CORS, auth, or error handling)
mcpServer.mountRoutes(this.app);  // adds POST/GET/DELETE /mcp
```

**Important:** `mountRoutes` registers handlers only on `/mcp`. It does NOT register any middleware on the root app or `/api/*`. The MCP route has its own error handling and does not inherit the REST API's CORS configuration. This keeps the two surfaces fully independent.

---

## Key Implementation Details

### 1. Streamable HTTP Handler (`handler.ts`)

Implements the MCP Streamable HTTP transport spec:

```typescript
class StreamableHTTPHandler {
  /** Handle POST /mcp — JSON-RPC request/response */
  async handlePost(req: Request, res: Response): Promise<void>;

  /** Handle GET /mcp — SSE stream for notifications (optional) */
  async handleGet(req: Request, res: Response): Promise<void>;

  /** Handle DELETE /mcp — Session cleanup (optional) */
  async handleDelete(req: Request, res: Response): Promise<void>;
}
```

**POST /mcp flow:**
1. Parse JSON-RPC request from body.
2. Dispatch by method:
   - `initialize` → return server info + capabilities (tools).
   - `tools/list` → return all 18 tool definitions with JSON schemas.
   - `tools/call` → look up handler by tool name, execute, return result.
3. Return JSON-RPC response.

For tool calls that take a long time (e.g., `send_message`, `run_tool`), the response simply blocks until complete. MCP clients handle this naturally.

**No SDK dependency.** The codebase already implements MCP JSON-RPC in `src/mcp/client.ts` without the official SDK. The server-side handler follows the same custom approach for consistency. The protocol surface is small — just 3 methods to handle.

### 2. Log Capture (`log-buffer.ts`)

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
  source: 'server' | 'web';
}
```

**Console interception strategy:**
- Wrap `console.log`, `console.warn`, `console.error` with proxies.
- Proxy calls the original function (terminal output unchanged) AND pushes to the circular buffer.
- Installed early in the startup sequence, before any other initialization, so all boot logs are captured.

### 3. Web Log Forwarding

The frontend sends browser console logs to the backend via a new WebSocket message type:

```typescript
// Frontend sends:
{ type: 'web_log', level: 'log', message: '...', timestamp: '...' }
```

The backend's WebSocket handler writes these into the same `LogBuffer` with `source: 'web'`.

The `web_log` MCP tool queries the buffer filtered by `source === 'web'`.

**Frontend change:** A small console interceptor script in the web app that forwards `console.log/warn/error` over the existing WebSocket connection. Gated behind a `DEBUG` flag to avoid noise in production.

### 4. db_query Safety

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

### 5. run_tool Execution

```typescript
// Direct ToolRunner invocation, bypassing the agent loop
async function runTool(params: {
  tool_name: string;
  parameters: Record<string, unknown>;
}): Promise<ToolResult> {
  return toolRunner.executeTool({
    id: crypto.randomUUID(),
    toolName: params.tool_name,
    parameters: params.parameters,
  });
}
```

This gives raw access to any registered tool. The caller provides the full tool name (e.g., `web_search`, `user.my_tool`, `mcp.github__list_repos`).

### 6. send_message Flow

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

---

## MCP Client Configuration

### Claude Code (primary use case)

```bash
claude mcp add --transport http olliebot http://localhost:3000/mcp
```

That's it. OllieBot is already running on port 3000; Claude Code connects to it.

### Claude Desktop (via stdio shim, if needed)

```json
{
  "mcpServers": {
    "olliebot": {
      "command": "node",
      "args": ["dist/mcp-server/stdio-shim.js"],
      "cwd": "/path/to/olliebot",
      "env": {
        "OLLIEBOT_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Other MCP Clients (HTTP-capable)

Any MCP client that supports Streamable HTTP can connect directly to `http://localhost:3000/mcp`.

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
- `LogBuffer` with console interception (installed at startup)
- Streamable HTTP handler mounted at `POST /mcp`
- Tools: `server_log`, `health`, `db_query`, `list_conversations`, `list_messages`, `list_tools`, `get_tool_schema`, `run_tool`
- 8 tools, all backed by in-process state
- Claude Code integration tested

### Phase 2 — Agent & Config tools
- Tools: `list_agents`, `get_agent_state`, `list_mcp_servers`, `toggle_mcp_server`, `list_tasks`, `run_task`, `list_skills`, `get_config`
- 8 more tools, primarily thin wrappers over existing service layer

### Phase 3 — Interaction & Web logs
- `send_message` (requires careful handling of async agent responses)
- `web_log` (requires frontend console interceptor + WebSocket forwarding)
- Stdio shim for Claude Desktop compatibility
- SSE support for streaming tool progress

---

## Open Questions

1. **SDK vs custom:** The design proposes a custom JSON-RPC handler to match the existing codebase style. Should we adopt `@modelcontextprotocol/sdk` instead for future-proofing?

2. **web_log frontend change:** The frontend console interceptor adds a small amount of code to the web bundle. Should this be always-on or toggled via a setting/env var?

3. **send_message semantics:** Should this block until the full agent response, or return immediately with a handle to poll? Blocking is simpler but could hit MCP client timeouts for long agent tasks.

4. **Log buffer size:** Default 1000 entries. Should this be configurable via env var?

5. **CORS:** The MCP endpoint will need to allow requests from Claude Code's origin (or `localhost`). The existing CORS config whitelists `localhost:5173` and `localhost:3000`. Claude Code likely connects from a different context — may need to add its origin or use a permissive policy for `/mcp` specifically.
