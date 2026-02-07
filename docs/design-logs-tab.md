# Logs Tab - Design Document

## 1. Overview

The Logs tab provides full observability into OllieBot's internals: every LLM call, agent execution, tool invocation, and multi-agent delegation trace. It acts as a developer console for understanding exactly what happens behind every user interaction.

### Goals

1. **LLM Call Tracking** - See every LLM request/response across all workloads (Main, Fast, Embedding, Image Gen, Browser, Voice)
2. **Execution Tracing** - Full DAG traces of multi-agent workflows: who called what agent, with what parameters, using what tools
3. **Request Inspection** - View the full prompt document, request JSON payload, and assembled streaming response for any LLM call
4. **Centralized LLM Routing** - All LLM calls flow through a single instrumented `LlmService` layer
5. **Persistent Storage** - All traces stored in DB, surviving page refreshes and server restarts

---

## 2. UX Design

### 2.1 Navigation

Add a top-level tab bar to the application chrome. The existing Chat and Eval views become tabs alongside the new Logs tab.

```
 ┌──────────────────────────────────────────────────────┐
 │  [Chat]   [Eval]   [Logs]                            │
 ├──────────────────────────────────────────────────────┤
 │                                                      │
 │              (tab content area)                       │
 │                                                      │
 └──────────────────────────────────────────────────────┘
```

**Route mapping:**
- `/` or `/chat` → Chat tab (existing)
- `/eval` → Eval tab (existing)
- `/logs` → Logs tab (new)

### 2.2 Logs Tab Layout

The Logs tab has a **two-panel layout**: a filterable list on the left, and a detail inspector on the right.

```
 ┌─────────────────────────────┬────────────────────────────────┐
 │  LOGS LIST                  │  DETAIL INSPECTOR              │
 │                             │                                │
 │  [Traces ▼] [LLM Calls ▼]  │  ┌────────────────────────┐   │
 │  [Filter...          ] 🔍   │  │ Trace: "Deep Research…" │   │
 │                             │  │ Started: 2:34:12 PM     │   │
 │  ▼ Trace: "Plan a trip"    │  │ Duration: 12.4s          │   │
 │    ├─ 🤖 Supervisor         │  │ Agents: 4               │   │
 │    │  ├─ LLM Call #1        │  └────────────────────────┘   │
 │    │  │  claude-sonnet-4    │                                │
 │    │  │  2.3s, 1.2k tokens  │  ┌────────────────────────┐   │
 │    │  ├─ Tool: delegate     │  │ AGENT DAG               │   │
 │    │  └─ LLM Call #2        │  │                          │   │
 │    ├─ 🔬 Research Lead      │  │  🤖 Supervisor           │   │
 │    │  ├─ LLM Call #3        │  │    ├─▶ 🔬 Research Lead │   │
 │    │  ├─ Tool: web_search   │  │    │    ├─▶ 🔎 Searcher │   │
 │    │  └─ Delegation         │  │    │    └─▶ 🔎 Searcher │   │
 │    ├─ 🔎 Searcher (1)       │  │    └─▶ ✍️ Drafter       │   │
 │    └─ 🔎 Searcher (2)       │  └────────────────────────┘   │
 │                             │                                │
 │  ▶ Trace: "Summarize doc"  │  ┌────────────────────────┐   │
 │  ▶ LLM Call (fast, standalone│  │ TIMELINE                │   │
 │                             │  │ ──●─────●──●───●──────● │   │
 │                             │  │  LLM1  T1 LLM2 T2 LLM3 │   │
 │                             │  └────────────────────────┘   │
 │                             │                                │
 └─────────────────────────────┴────────────────────────────────┘
```

### 2.3 List Panel (Left)

The list panel shows two interleaved entry types:

#### A. Trace Entries (multi-agent execution traces)
Each trace represents a full user-turn execution, from user message to final response. Traces are collapsible tree structures showing the agent hierarchy.

```
▼ Trace: "Plan a trip to Japan"                    12.4s
  ├─ 🤖 OllieBot (supervisor)                      2.1s
  │   ├─ LLM Call  claude-sonnet-4  1.8s  1.2k tok
  │   └─ Tool: delegate → research-lead
  ├─ 🔬 Research Lead                              8.3s
  │   ├─ LLM Call  claude-sonnet-4  2.1s  890 tok
  │   ├─ Tool: web_search "japan travel"           1.2s
  │   ├─ Tool: delegate → searcher
  │   ├─ LLM Call  claude-sonnet-4  1.9s  1.1k tok
  │   └─ Tool: delegate → searcher
  └─ 🔎 Searcher (x2, parallel)                   4.0s
      ├─ LLM Call  claude-sonnet-4  1.5s  600 tok
      └─ Tool: web_search "tokyo hotels"           0.8s
```

#### B. Standalone LLM Call Entries
LLM calls that happen outside agent traces (summarization, task config parsing, auto-naming, embedding generation) appear as flat list items.

```
▶ LLM Call  gemini-flash (fast)  summarize  0.4s  320 tok
▶ LLM Call  gemini-flash (fast)  auto-name  0.2s  20 tok
▶ Embedding  text-embedding-3-small  chunk 1/12  0.1s
```

#### Filters
- **View Mode**: `Traces` | `LLM Calls` | `All`
- **Workload Filter**: `Main` | `Fast` | `Embedding` | `Image Gen` | `Browser` | `Voice` | `All`
- **Provider Filter**: `Anthropic` | `Google` | `OpenAI` | `Azure` | `All`
- **Time Range**: `Last 1h` | `Last 24h` | `All`
- **Text Search**: Search by prompt content, tool names, agent names
- **Conversation Filter**: Filter logs by conversation ID (linked from Chat tab)

### 2.4 Detail Inspector (Right)

When an item is selected in the list, the right panel shows full details.

#### A. Trace Detail View

**Header:**
- Trace ID, trigger (user message or task run), timestamp
- Total duration, total tokens, total LLM calls, total tool calls
- Conversation link (click to jump to Chat tab)

**Agent DAG Visualization:**
A visual tree/graph showing the agent call hierarchy with arrows indicating delegation flow. Each node shows: agent name + emoji, type, duration, number of LLM calls.

**Timeline View:**
A horizontal timeline (Gantt-style) showing overlapping agent executions, LLM calls, and tool calls. This makes it easy to see parallelism and bottlenecks.

```
Time →  0s         2s         4s         6s         8s        10s
🤖 Sup  ████LLM████                                          ██LLM██
🔬 Lead              ████LLM████ ▓▓Tool▓▓ ████LLM████
🔎 Sr.1                                    ████LLM████ ▓Tool▓
🔎 Sr.2                                    ████LLM████ ▓Tool▓
```

#### B. LLM Call Detail View

**Tabs within the detail panel:**

**[Overview]**
- Model, provider, workload type (Main/Fast/Embedding/etc.)
- Duration, input tokens, output tokens
- Stop reason (end_turn, tool_use, max_tokens)
- Calling agent (name, ID, type)
- Temperature, max tokens, reasoning effort

**[Request]**
- **System Prompt**: Full system prompt (collapsible, syntax highlighted)
- **Messages**: Full message array sent to the LLM, each message expandable
  - For user messages: text + image attachments indicator
  - For assistant messages: text + tool_use blocks
  - For tool_result messages: tool results
- **Tools**: List of tools provided (collapsible JSON schema for each)
- **Raw JSON**: The complete request payload as formatted JSON

**[Response]**
- **Content**: The full text response (markdown rendered)
- **Tool Use Blocks**: If the LLM requested tools, show each tool call with its parameters
- **Raw JSON**: Complete response payload
- **Streaming Reconstruction**: For streamed responses, show the original chunks with timestamps (useful for debugging streaming issues)

#### C. Tool Call Detail View

**Fields:**
- Tool name, source (native/mcp/user), calling agent
- Parameters (formatted JSON, collapsible)
- Result (formatted JSON, collapsible)
- Duration, success/failure, error message if failed
- If delegate tool: link to the spawned sub-agent's trace

#### D. Delegation Detail View

**Fields:**
- Delegating agent → Target agent
- Agent type, mission text, rationale
- Link to sub-agent's LLM calls and tool executions

### 2.5 Cross-Linking

The Logs tab should enable seamless navigation:

- **Chat → Logs**: Each message in Chat has a "View in Logs" button that opens the Logs tab filtered to that conversation/turn
- **Logs → Chat**: Each trace header has a "View Conversation" link back to the Chat tab
- **Trace → LLM Call**: Clicking an LLM call in a trace opens its detail
- **Tool → Delegation**: If a tool call is `delegate`, clicking it navigates to the sub-agent's section in the trace tree

### 2.6 Real-Time Updates

When the Logs tab is active and new events arrive:
- New traces/LLM calls appear at the top of the list with a brief highlight animation
- If viewing an in-progress trace, it updates live as new LLM calls and tool executions complete
- A streaming indicator shows when an LLM call is currently in progress

---

## 3. Technical Design

### 3.1 Centralized LLM Tracking Service

#### Problem
Currently, LLM calls are scattered across providers (`anthropic.ts`, `google.ts`, `openai.ts`, `azure-openai.ts`) and the `LLMService` class. There's no central place to capture every call's full request/response.

#### Solution: Instrumented LlmService Wrapper

Wrap all LLM provider calls with instrumentation at the `LLMService` level. Instead of modifying each provider, we instrument at the service boundary where all calls already pass through.

**New file: `src/llm/llm-trace-service.ts`**

```typescript
import { v4 as uuid } from 'uuid';
import type { LLMMessage, LLMOptions, LLMResponse, LLMResponseWithTools, StreamCallbacks } from './types.js';
import type { LLMService } from './service.js';

// ============================================================
// Types
// ============================================================

export type LlmWorkload = 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice';

export interface LlmCallRecord {
  id: string;
  traceId: string | null;       // Parent trace ID (null for standalone calls)
  spanId: string | null;         // Parent span (agent) ID
  workload: LlmWorkload;
  provider: string;              // 'anthropic' | 'google' | 'openai' | 'azure_openai'
  model: string;

  // Request
  messages: LLMMessage[];        // Full message array
  systemPrompt: string | null;
  tools: LLMOptions['tools'] | null;
  toolChoice: LLMOptions['toolChoice'] | null;
  maxTokens: number | null;
  temperature: number | null;
  reasoningEffort: string | null;

  // Response
  responseContent: string | null;
  responseToolUse: Array<{ id: string; name: string; input: Record<string, unknown> }> | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;

  // Streaming
  streamChunks: Array<{ text: string; timestamp: string }> | null;  // Stored only if streaming

  // Timing
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  // Context
  callerAgentId: string | null;
  callerAgentName: string | null;
  callerPurpose: string | null;  // 'chat', 'summarize', 'auto_name', 'parse_task_config', 'citation', etc.
  conversationId: string | null;

  // Status
  status: 'pending' | 'streaming' | 'completed' | 'error';
  error: string | null;
}

export interface TraceRecord {
  id: string;
  conversationId: string | null;
  turnId: string | null;          // Links to the originating user message
  triggerType: 'user_message' | 'task_run' | 'system';
  triggerContent: string | null;   // First ~200 chars of the trigger

  // Timing
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  // Stats (computed)
  llmCallCount: number;
  toolCallCount: number;
  agentCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;

  status: 'running' | 'completed' | 'error';
}

export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId: string | null;     // null for root span (supervisor)

  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentType: string;               // 'supervisor-main', 'deep-research-lead', etc.
  agentRole: 'supervisor' | 'worker' | 'specialist';
  mission: string | null;

  // Timing
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  // Stats
  llmCallCount: number;
  toolCallCount: number;

  status: 'running' | 'completed' | 'error';
  error: string | null;
}

export interface ToolCallRecord {
  id: string;
  traceId: string | null;
  spanId: string | null;
  llmCallId: string;               // Which LLM call requested this tool

  toolName: string;
  source: 'native' | 'mcp' | 'user';
  parameters: Record<string, unknown>;

  result: unknown | null;
  success: boolean | null;
  error: string | null;

  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  callerAgentId: string | null;
  callerAgentName: string | null;
}
```

#### Instrumentation Strategy

Rather than creating a proxy class, we add instrumentation hooks to the existing `LLMService` methods. This is done by creating a `TracingLLMService` that extends `LLMService`:

```typescript
// src/llm/tracing-llm-service.ts

export class TracingLLMService extends LLMService {
  private traceStore: TraceStore;

  // Active context (set by agents before calling LLM methods)
  private activeTraceId: string | null = null;
  private activeSpanId: string | null = null;
  private activeAgentId: string | null = null;
  private activeAgentName: string | null = null;
  private activeConversationId: string | null = null;
  private activePurpose: string | null = null;

  /**
   * Set the active trace context. Called by agents before making LLM calls.
   * Uses a stack-based approach to handle nested agent calls.
   */
  pushContext(ctx: {
    traceId?: string;
    spanId?: string;
    agentId?: string;
    agentName?: string;
    conversationId?: string;
    purpose?: string;
  }): void { ... }

  popContext(): void { ... }

  /**
   * Override generate() to add tracing
   */
  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const callId = uuid();
    const record = this.createCallRecord(callId, 'main', messages, options);
    this.traceStore.saveLlmCall(record);

    try {
      const response = await super.generate(messages, options);
      this.traceStore.completeLlmCall(callId, response);
      return response;
    } catch (error) {
      this.traceStore.failLlmCall(callId, error);
      throw error;
    }
  }

  // Similarly override: generateWithTools, generateStream,
  // generateWithToolsStream, quickGenerate, summarize, parseTaskConfig
}
```

#### Context Propagation

The key challenge is associating LLM calls with the right trace and agent span. We solve this by having agents set context on the TracingLLMService before making calls:

```typescript
// In supervisor.ts and worker.ts, before LLM calls:
const tracingService = this.llmService as TracingLLMService;
tracingService.pushContext({
  traceId: this.currentTraceId,
  spanId: this.currentSpanId,
  agentId: this.identity.id,
  agentName: this.identity.name,
  conversationId: this.currentConversationId,
  purpose: 'chat',
});

try {
  const response = await this.llmService.generateWithToolsStream(...);
} finally {
  tracingService.popContext();
}
```

**Note on concurrency:** Since Node.js is single-threaded and `await` points yield to the event loop, we use a context stack rather than thread-local storage. Each `pushContext`/`popContext` pair brackets a single async LLM call chain. For parallel agent executions (e.g., multiple searchers), each agent pushes its own context before its own call.

### 3.2 Database Schema

Add four new tables to the existing AlaSQL + JSON persistence layer.

#### New Tables

```sql
CREATE TABLE IF NOT EXISTS traces (
  id STRING PRIMARY KEY,
  conversationId STRING,
  turnId STRING,
  triggerType STRING,           -- 'user_message' | 'task_run' | 'system'
  triggerContent STRING,
  startedAt STRING,
  completedAt STRING,
  durationMs INT,
  llmCallCount INT DEFAULT 0,
  toolCallCount INT DEFAULT 0,
  agentCount INT DEFAULT 0,
  totalInputTokens INT DEFAULT 0,
  totalOutputTokens INT DEFAULT 0,
  status STRING DEFAULT 'running'
)

CREATE TABLE IF NOT EXISTS trace_spans (
  id STRING PRIMARY KEY,
  traceId STRING,
  parentSpanId STRING,
  agentId STRING,
  agentName STRING,
  agentEmoji STRING,
  agentType STRING,
  agentRole STRING,
  mission STRING,
  startedAt STRING,
  completedAt STRING,
  durationMs INT,
  llmCallCount INT DEFAULT 0,
  toolCallCount INT DEFAULT 0,
  status STRING DEFAULT 'running',
  error STRING
)

CREATE TABLE IF NOT EXISTS llm_calls (
  id STRING PRIMARY KEY,
  traceId STRING,
  spanId STRING,
  workload STRING,              -- 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice'
  provider STRING,
  model STRING,
  messagesJson STRING,          -- JSON-serialized message array
  systemPrompt STRING,
  toolsJson STRING,             -- JSON-serialized tools array
  toolChoice STRING,
  maxTokens INT,
  temperature FLOAT,
  reasoningEffort STRING,
  responseContent STRING,
  responseToolUseJson STRING,   -- JSON-serialized tool use array
  stopReason STRING,
  inputTokens INT,
  outputTokens INT,
  streamChunksJson STRING,      -- JSON-serialized chunk array (optional)
  startedAt STRING,
  completedAt STRING,
  durationMs INT,
  callerAgentId STRING,
  callerAgentName STRING,
  callerPurpose STRING,
  conversationId STRING,
  status STRING DEFAULT 'pending',
  error STRING
)

CREATE TABLE IF NOT EXISTS tool_calls (
  id STRING PRIMARY KEY,
  traceId STRING,
  spanId STRING,
  llmCallId STRING,
  toolName STRING,
  source STRING,                -- 'native' | 'mcp' | 'user'
  parametersJson STRING,
  resultJson STRING,
  success INT,                  -- 0 or 1 (AlaSQL doesn't have BOOLEAN)
  error STRING,
  startedAt STRING,
  completedAt STRING,
  durationMs INT,
  callerAgentId STRING,
  callerAgentName STRING
)
```

#### Database Data Structure Extension

```typescript
// Added to DatabaseData interface in src/db/index.ts
interface DatabaseData {
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  embeddings: Embedding[];
  // New:
  traces: TraceRecord[];
  traceSpans: TraceSpan[];
  llmCalls: LlmCallRecord[];
  toolCalls: ToolCallRecord[];
}
```

#### Storage Considerations

- **Message payload size**: The `messagesJson` field on `llm_calls` can be large (full conversation context). We store it as-is for full inspectability, but apply a configurable max size (default 500KB per call). Beyond that, we truncate the oldest messages in the array but always keep system prompt and the last 3 messages.
- **Stream chunks**: Stored optionally (controlled by `TRACE_STORE_STREAM_CHUNKS=true` env var). Default: off. When on, captures each chunk's text + timestamp for debugging streaming issues.
- **Tool results**: Large tool results (>50KB) are truncated in storage with a `...(truncated)` marker, matching existing behavior in `MessageEventService`.
- **Retention**: Add a periodic cleanup that removes trace data older than a configurable retention period (default 7 days), controlled by `TRACE_RETENTION_DAYS` env var.

#### New Repository Interfaces

```typescript
export interface TraceRepository {
  findById(id: string): TraceRecord | undefined;
  findAll(options?: {
    limit?: number;
    conversationId?: string;
    status?: string;
    since?: string;  // ISO timestamp
  }): TraceRecord[];
  create(trace: TraceRecord): void;
  update(id: string, updates: Partial<Omit<TraceRecord, 'id'>>): void;
}

export interface TraceSpanRepository {
  findById(id: string): TraceSpan | undefined;
  findByTraceId(traceId: string): TraceSpan[];
  create(span: TraceSpan): void;
  update(id: string, updates: Partial<Omit<TraceSpan, 'id'>>): void;
}

export interface LlmCallRepository {
  findById(id: string): LlmCallRecord | undefined;
  findByTraceId(traceId: string): LlmCallRecord[];
  findBySpanId(spanId: string): LlmCallRecord[];
  findAll(options?: {
    limit?: number;
    workload?: LlmWorkload;
    provider?: string;
    since?: string;
    conversationId?: string;
  }): LlmCallRecord[];
  create(call: LlmCallRecord): void;
  update(id: string, updates: Partial<Omit<LlmCallRecord, 'id'>>): void;
}

export interface ToolCallRepository {
  findById(id: string): ToolCallRecord | undefined;
  findByTraceId(traceId: string): ToolCallRecord[];
  findBySpanId(spanId: string): ToolCallRecord[];
  findByLlmCallId(llmCallId: string): ToolCallRecord[];
  create(call: ToolCallRecord): void;
  update(id: string, updates: Partial<Omit<ToolCallRecord, 'id'>>): void;
}
```

### 3.3 TraceStore Service

**New file: `src/tracing/trace-store.ts`**

The `TraceStore` is the central service that manages trace lifecycle and provides query methods for the API layer.

```typescript
export class TraceStore {
  // Lifecycle methods
  startTrace(opts: { conversationId?: string; turnId?: string; triggerType: string; triggerContent?: string }): string;
  endTrace(traceId: string, status?: 'completed' | 'error'): void;

  startSpan(opts: { traceId: string; parentSpanId?: string; agentId: string; agentName: string; agentEmoji: string; agentType: string; agentRole: string; mission?: string }): string;
  endSpan(spanId: string, status?: 'completed' | 'error'; error?: string): void;

  recordLlmCall(record: LlmCallRecord): void;
  completeLlmCall(callId: string, response: LLMResponse | LLMResponseWithTools): void;
  failLlmCall(callId: string, error: unknown): void;

  recordToolCall(record: ToolCallRecord): void;
  completeToolCall(callId: string, result: unknown, success: boolean, error?: string): void;

  // Query methods (for API endpoints)
  getTraces(options?: TraceQueryOptions): TraceRecord[];
  getTrace(traceId: string): { trace: TraceRecord; spans: TraceSpan[]; llmCalls: LlmCallRecord[]; toolCalls: ToolCallRecord[] } | undefined;
  getLlmCalls(options?: LlmCallQueryOptions): LlmCallRecord[];
  getLlmCall(callId: string): LlmCallRecord | undefined;
  getToolCalls(options?: ToolCallQueryOptions): ToolCallRecord[];

  // Stats
  getStats(since?: string): { totalTraces: number; totalLlmCalls: number; totalToolCalls: number; totalTokens: number; avgDurationMs: number };

  // Maintenance
  cleanup(retentionDays: number): number;  // Returns deleted count
}
```

### 3.4 Agent Integration Points

The following modifications are needed to existing agent code to enable tracing:

#### Supervisor (`src/agents/supervisor.ts`)

```typescript
// In handleMessage():
async handleMessage(message: Message): Promise<void> {
  // NEW: Start a trace for this user turn
  const traceId = this.traceStore.startTrace({
    conversationId: this.currentConversationId,
    turnId: this.currentTurnId,
    triggerType: message.metadata?.type === 'task_run' ? 'task_run' : 'user_message',
    triggerContent: message.content.substring(0, 200),
  });
  this.currentTraceId = traceId;

  // NEW: Start supervisor span
  const spanId = this.traceStore.startSpan({
    traceId,
    agentId: this.identity.id,
    agentName: this.identity.name,
    agentEmoji: this.identity.emoji,
    agentType: 'supervisor-main',
    agentRole: 'supervisor',
  });
  this.currentSpanId = spanId;

  // ... existing logic, with pushContext/popContext around LLM calls ...

  // NEW: End supervisor span and trace
  this.traceStore.endSpan(spanId);
  this.traceStore.endTrace(traceId);
}
```

#### Worker (`src/agents/worker.ts`)

```typescript
// In handleDelegatedTask():
async handleDelegatedTask(originalMessage, mission, channel): Promise<void> {
  // NEW: Start a span under the parent trace
  const spanId = this.traceStore.startSpan({
    traceId: this.currentTraceId,   // Inherited from supervisor
    parentSpanId: this.parentSpanId, // Inherited from delegating agent
    agentId: this.identity.id,
    agentName: this.identity.name,
    agentEmoji: this.identity.emoji,
    agentType: this.agentType,
    agentRole: 'worker',
    mission,
  });

  // ... existing logic, with pushContext/popContext around LLM calls ...

  this.traceStore.endSpan(spanId);
}
```

#### Tool Runner Integration

Tool calls are already tracked via `ToolEvent`. The `TraceStore` listens to tool events and records them:

```typescript
// In TracingLLMService or a separate listener:
toolRunner.onToolEvent((event) => {
  if (event.type === 'tool_requested') {
    traceStore.recordToolCall({
      id: event.requestId,
      traceId: activeTraceId,
      spanId: activeSpanId,
      llmCallId: currentLlmCallId,
      toolName: event.toolName,
      source: event.source,
      parameters: event.parameters,
      startedAt: event.timestamp.toISOString(),
      // ... rest null/pending
    });
  }
  if (event.type === 'tool_execution_finished') {
    traceStore.completeToolCall(event.requestId, event.result, event.success, event.error);
  }
});
```

### 3.5 API Endpoints

**New routes added to `src/server/index.ts`:**

```
GET  /api/logs/traces
     ?limit=50&conversationId=...&since=...&status=...
     Returns: TraceRecord[]

GET  /api/logs/traces/:traceId
     Returns: { trace, spans, llmCalls, toolCalls }

GET  /api/logs/llm-calls
     ?limit=50&traceId=...&spanId=...&workload=...&provider=...&since=...
     Returns: LlmCallRecord[]

GET  /api/logs/llm-calls/:callId
     Returns: LlmCallRecord (with full messages/response)

GET  /api/logs/tool-calls
     ?limit=50&traceId=...&spanId=...&llmCallId=...
     Returns: ToolCallRecord[]

GET  /api/logs/stats
     ?since=...
     Returns: { totalTraces, totalLlmCalls, totalToolCalls, totalTokens, avgDurationMs }
```

### 3.6 WebSocket Events for Real-Time Updates

New WebSocket event types for live log streaming:

```typescript
// Broadcast when a new trace starts
{ type: 'log_trace_start', traceId, triggerType, triggerContent, timestamp }

// Broadcast when a new span starts (agent begins work)
{ type: 'log_span_start', traceId, spanId, agentId, agentName, agentEmoji, agentType, timestamp }

// Broadcast when an LLM call starts
{ type: 'log_llm_call_start', callId, traceId, spanId, workload, model, provider, timestamp }

// Broadcast when an LLM call completes
{ type: 'log_llm_call_end', callId, durationMs, inputTokens, outputTokens, stopReason, status }

// Broadcast when a span ends
{ type: 'log_span_end', spanId, durationMs, status }

// Broadcast when a trace ends
{ type: 'log_trace_end', traceId, durationMs, status, stats: { llmCallCount, toolCallCount, ... } }
```

The frontend Logs tab subscribes to these events via the existing WebSocket connection and updates the list/detail views in real time.

### 3.7 Frontend Architecture

#### New Files

```
web/src/
├── components/
│   └── logs/
│       ├── LogsTab.jsx              # Main logs tab container
│       ├── LogsList.jsx             # Left panel - trace/call list
│       ├── LogsFilters.jsx          # Filter bar component
│       ├── TraceTreeItem.jsx        # Collapsible trace tree node
│       ├── LlmCallItem.jsx         # LLM call list item
│       ├── LogsDetail.jsx          # Right panel - detail inspector
│       ├── TraceDetail.jsx         # Trace detail view
│       ├── LlmCallDetail.jsx      # LLM call detail view
│       ├── ToolCallDetail.jsx     # Tool call detail view
│       ├── AgentDagView.jsx       # Agent DAG visualization
│       └── TimelineView.jsx       # Gantt-style timeline
├── hooks/
│   └── useLogs.js                  # Data fetching + WebSocket subscription for logs
└── utils/
    └── logsHelpers.js              # Formatting, filtering utilities
```

#### State Management

The Logs tab manages its own state via `useState` hooks (consistent with the rest of the app). Key state:

```javascript
const [traces, setTraces] = useState([]);           // List of traces
const [llmCalls, setLlmCalls] = useState([]);       // Standalone LLM calls
const [selectedItem, setSelectedItem] = useState(null);  // Currently inspected item
const [filters, setFilters] = useState({
  viewMode: 'all',      // 'traces' | 'llm_calls' | 'all'
  workload: 'all',
  provider: 'all',
  timeRange: '1h',
  search: '',
  conversationId: null,
});
const [detailData, setDetailData] = useState(null);  // Full detail for selected item
```

#### Data Flow

1. **Initial Load**: `GET /api/logs/traces` + `GET /api/logs/llm-calls` to populate the list
2. **Real-Time**: WebSocket events (`log_trace_start`, `log_llm_call_end`, etc.) update the list in real time
3. **Detail Fetch**: When an item is selected, `GET /api/logs/traces/:id` or `GET /api/logs/llm-calls/:id` fetches full detail
4. **Filters**: Applied client-side for instant responsiveness, with server-side filtering for time range and conversation ID

---

## 4. Implementation Plan

### Phase 1: Backend Foundation
1. Add new DB tables (`traces`, `trace_spans`, `llm_calls`, `tool_calls`) to `src/db/index.ts`
2. Create `src/tracing/trace-store.ts` with repository pattern matching existing DB layer
3. Create `src/llm/tracing-llm-service.ts` extending `LLMService` with instrumentation
4. Wire `TracingLLMService` into `src/index.ts` initialization (replacing `LLMService`)

### Phase 2: Agent Integration
5. Add trace/span lifecycle calls to `SupervisorAgentImpl.handleMessage()`
6. Add span lifecycle calls to `WorkerAgent.handleDelegatedTask()` and `delegateToSubAgent()`
7. Pass `traceId`/`spanId` through agent delegation chain (similar to existing `conversationId`/`turnId` pattern)
8. Add `pushContext`/`popContext` around all LLM call sites
9. Integrate tool call recording with existing `ToolRunner.onToolEvent`

### Phase 3: API Layer
10. Add `/api/logs/*` REST endpoints to `src/server/index.ts`
11. Add `log_*` WebSocket event broadcasting from `TraceStore`

### Phase 4: Frontend - Logs Tab
12. Add tab bar navigation (Chat / Eval / Logs) to `App.jsx`
13. Create `LogsTab.jsx` with two-panel layout
14. Implement `LogsList.jsx` with trace tree rendering
15. Implement `LogsDetail.jsx` with LLM call inspection
16. Implement `AgentDagView.jsx` for trace visualization
17. Implement `TimelineView.jsx` for Gantt timeline
18. Add WebSocket event handling for real-time updates in `useLogs.js`

### Phase 5: Cross-Linking & Polish
19. Add "View in Logs" buttons to Chat messages
20. Add conversation links from Logs traces
21. Add trace data retention/cleanup job
22. Add `TRACE_ENABLED` env var to completely disable tracing overhead when not needed

---

## 5. Data Flow Diagram

```
User Message
     │
     ▼
┌─────────────────┐      ┌──────────────┐
│ SupervisorAgent  │─────▶│  TraceStore   │  startTrace()
│  handleMessage() │      │              │  startSpan()
└────────┬────────┘      └──────┬───────┘
         │                       │
         ▼                       │
┌─────────────────┐              │
│TracingLLMService │──────────────┤  recordLlmCall()
│  .generate*()   │              │  completeLlmCall()
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐              │
│  ToolRunner      │──────────────┤  recordToolCall()
│  .execute*()    │              │  completeToolCall()
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐              │
│  WorkerAgent     │──────────────┤  startSpan() (sub-agent)
│  delegateToSub() │              │
└────────┬────────┘              │
         │                       │
         ▼                       ▼
┌─────────────────┐      ┌──────────────┐
│  DB (AlaSQL)     │◀─────│  WebSocket   │
│  traces table    │      │  log_* events│
│  llm_calls table │      └──────┬───────┘
│  tool_calls table│              │
└─────────────────┘              ▼
                          ┌──────────────┐
                          │  Frontend    │
                          │  Logs Tab    │
                          └──────────────┘
```

---

## 6. Key Design Decisions

### Why extend LLMService instead of wrapping providers?
The `LLMService` is already the single entry point for all LLM calls from agents. Instrumenting here captures everything without modifying the 4 separate provider implementations. Providers remain clean API adapters.

### Why use push/pop context instead of passing trace IDs through every method?
Changing every `generate*()` signature to accept trace metadata would be a massive API change touching all callers. The push/pop pattern is non-invasive - existing code continues to call `generate()` as before, and the tracing layer picks up context automatically.

### Why separate tables instead of extending the messages table?
The existing `messages` table stores conversation messages. Trace data has a fundamentally different structure (traces → spans → calls → tool_calls hierarchy) and different query patterns. Mixing them would complicate both the schema and queries. Separate tables also allow independent retention policies.

### Why AlaSQL + JSON instead of SQLite?
The existing codebase uses AlaSQL with JSON file persistence. We follow the established pattern for consistency and to avoid introducing new dependencies. The JSON persistence also makes trace data human-readable and easy to inspect offline.

### Why not use OpenTelemetry?
OpenTelemetry is designed for distributed tracing across services. OllieBot is a single-process application. The overhead of OTLP exporters, span processors, and external collectors is unnecessary. Our custom trace model is simpler and purpose-built for the Logs tab UI.
