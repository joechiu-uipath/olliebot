# Design: Per-Turn Agent TODO List

## Overview

Add a DB-backed, per-turn TODO list that the supervisor agent uses for planning and executing complex tasks. The supervisor creates an explicit plan (as TODO items) at the start of a turn, then drains them one-by-one before yielding control back to the user.

## Existing Architecture Context

| Concept | Current State |
|---------|--------------|
| **Turn ID** | Already exists — `turnId` field on `messages` and `traces` tables. Set as `message.metadata?.turnId \|\| message.id` in supervisor's `handleMessage`. |
| **Mission TODOs** | Separate system — `mission_todos` table scoped to missions/pillars, persists across turns. Not reusable here (different lifecycle, different schema). |
| **Tool loop** | `generateStreamingResponse` runs up to `AGENT_MAX_TOOL_ITERATIONS = 10` iterations. Each iteration: LLM call → tool execution → repeat. |
| **Delegation** | Supervisor `await`s the worker via `handleDelegationFromTool` → `await agent.handleDelegatedTask(...)`. After delegation completes, the supervisor resumes its tool loop with the worker's result, and can delegate again or continue working directly. (Updated — previously the loop exited after a single delegation.) |

---

## Database Schema

New table `turn_todos` in the main SQLite database (`src/db/index.ts`):

```sql
CREATE TABLE IF NOT EXISTS turn_todos (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  turnId TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',        -- relevant context for execution
  completionCriteria TEXT NOT NULL DEFAULT '', -- how to judge "done"
  agentType TEXT,                           -- sub-agent type to delegate to (nullable)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,     -- ordering hint (lower = first)
  outcome TEXT,                            -- completion reason / summary
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  completedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_turn_todos_turn ON turn_todos(turnId, status);
CREATE INDEX IF NOT EXISTS idx_turn_todos_conversation ON turn_todos(conversationId, turnId);
```

**Design notes:**
- `id` — UUID, generated at creation time.
- `conversationId` + `turnId` — scoping. `turnId` is globally unique but `conversationId` enables conversation-level queries.
- `status` — soft lifecycle. No rows are ever deleted.
- `priority` — integer for ordering. 0 = highest priority. The LLM can set this via an `order` param (1-indexed position, stored as 0-indexed).
- `agentType` — optional hint for which specialist to delegate to (`researcher`, `coder`, etc.). Null means the supervisor handles it directly.
- `outcome` — set on completion/cancellation. Free-form text.

---

## Tools

### `create_todo`

Creates one or more TODO items for the current turn.

```typescript
// Input schema
{
  items: Array<{
    title: string;            // required — human-readable task name
    context?: string;         // relevant background info
    completionCriteria?: string; // definition of done
    agentType?: string;       // specialist type to delegate to
    order?: number;           // 1-indexed position (default: append)
  }>;
}

// Output
{
  created: Array<{ id: string; title: string; order: number }>;
  totalPending: number;
}
```

**Batch creation** — accepts an array to avoid burning one tool iteration per item. A plan of 5 items = 1 tool call instead of 5.

**Turn scoping** — the tool receives `turnId` and `conversationId` from the execution context (injected by the tool runner or supervisor, not supplied by the LLM).

### `list_todo`

Lists TODO items for the current turn, filtered by status.

```typescript
// Input schema
{
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'all';
  // default: returns pending + in_progress (i.e., "remaining" items)
}

// Output
{
  items: Array<{
    id: string;
    title: string;
    context: string;
    completionCriteria: string;
    agentType: string | null;
    status: string;
    priority: number;
    outcome: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
}
```

### `complete_todo`

Marks a TODO item as completed (or cancelled).

```typescript
// Input schema
{
  todoId: string;             // required
  outcome: string;            // required — what was done / why cancelled
  status?: 'completed' | 'cancelled'; // default: 'completed'
}

// Output
{
  id: string;
  title: string;
  status: string;
  outcome: string;
  completedAt: string;
  remaining: number;          // count of pending + in_progress items left
}
```

---

## Data Access Layer

New file: `src/todos/turn-todo-repository.ts`

```typescript
interface TurnTodoRepository {
  create(todo: Omit<TurnTodo, 'id' | 'createdAt'>): TurnTodo;
  createBatch(todos: Array<Omit<TurnTodo, 'id' | 'createdAt'>>): TurnTodo[];
  findByTurn(turnId: string, status?: string | string[]): TurnTodo[];
  findById(id: string): TurnTodo | undefined;
  update(id: string, updates: Partial<TurnTodo>): TurnTodo | undefined;
  countByStatus(turnId: string): Record<string, number>;
}
```

This sits alongside the existing DB layer. Uses the same `better-sqlite3` instance from `src/db/index.ts` — schema init added to the existing `initDb()` or a new migration step.

---

## Supervisor Integration

### System Prompt Addition

New section appended to the supervisor's `buildSystemPrompt()` (similar pattern to `DELEGATION_SECTION` and `BROWSER_SECTION`):

```markdown
## Task Planning & Execution

For complex requests that involve multiple distinct steps, use the task planning system:

1. **Plan first**: Break the objective into individual tasks and call `create_todo` with the full list.
2. **Execute sequentially**: After creating the plan, use `list_todo` to see remaining items. Pick the next pending item, execute it (directly or via delegation), then call `complete_todo` with the outcome.
3. **Drain before responding**: You MUST NOT produce a final response to the user until all TODO items are completed or cancelled. After completing each item, check `list_todo` for remaining work.
4. **Skip planning for simple tasks**: If the user's request can be handled in 1-2 tool calls, respond directly without creating a plan.

When to use planning:
- Multi-step research or analysis
- Tasks requiring multiple tool calls across different domains
- Requests that explicitly ask for several things

When NOT to use planning:
- Simple factual questions
- Single tool calls (web search, screenshot, etc.)
- Casual conversation
```

Conditional on tool access (like delegation/browser sections):

```typescript
if (this.hasToolAccess('create_todo', allowedTools)) {
  prompt += TASK_PLANNING_SECTION;
}
```

### Tool Context Injection

The `create_todo`, `list_todo`, and `complete_todo` tools need access to `turnId` and `conversationId` without the LLM providing them.

**Approach — Tool execution context:** The supervisor already passes context through `executeToolsWithCitations`. We extend the tool execution signature so native tools receive a `context` object:

```typescript
interface ToolExecutionContext {
  conversationId: string;
  turnId: string;
  agentId: string;
}
```

The supervisor sets this before entering the tool loop. Each todo tool reads `turnId` from context rather than from LLM params.

### Tool Loop Iteration Limit

**Problem:** `AGENT_MAX_TOOL_ITERATIONS = 10`. A plan with 5 items requires at minimum: 1 (create) + 5×(execute + complete) + list checks = ~12-16 iterations. The loop will terminate prematurely.

**Solution:** Increase the iteration limit when an active turn todo list exists. After each tool execution, if there are remaining turn todos, extend the loop budget. Implementation:

```typescript
// In generateStreamingResponse tool loop:
const baseMaxIterations = AGENT_MAX_TOOL_ITERATIONS; // 10
let effectiveMax = baseMaxIterations;

// After tool execution, check if turn todos are active
if (turnTodoRepository.countByStatus(turnId).pending > 0 ||
    turnTodoRepository.countByStatus(turnId).inProgress > 0) {
  effectiveMax = Math.max(effectiveMax, iterationCount + baseMaxIterations);
  // Cap at an absolute max to prevent infinite loops
  effectiveMax = Math.min(effectiveMax, AGENT_MAX_TOOL_ITERATIONS_WITH_PLAN); // e.g., 50
}
```

New constant: `AGENT_MAX_TOOL_ITERATIONS_WITH_PLAN = 50` (or similar).

---

## File Structure

```
src/todos/
├── types.ts                    # TurnTodo interface, status types
├── turn-todo-repository.ts     # DB operations
├── index.ts                    # Re-exports

src/tools/native/
├── turn-todo-create.ts         # create_todo tool
├── turn-todo-list.ts           # list_todo tool
├── turn-todo-complete.ts       # complete_todo tool
```

---

## Design Decisions

### 1. Delegation Resumes the Supervisor Loop — RESOLVED (implemented)

The supervisor now resumes its tool loop after delegation completes. `handleDelegationFromTool` returns the worker's result string, the delegate tool result is updated with the worker's output, and the loop continues. The supervisor can delegate multiple times in a single turn.

See commit: "Allow supervisor to resume loop after delegation" on this branch.

### 2. Conversation History Window

Include the original user message and the current todo list summary as part of the system prompt context for each LLM call within the turn. This ensures the LLM never loses sight of the plan, even when older messages scroll out of the `CONVERSATION_HISTORY_LIMIT = 10` window.

Before each LLM call in the tool loop, prepend a synthetic context message with the current todo state (from `list_todo` DB query). This is lighter than increasing the history limit.

### 3. Incomplete Plans on Turn End

Remaining items stay as `pending` or `in_progress` in the DB (no auto-cancellation). The supervisor's final message to the user should mention incomplete items. On the next turn, the supervisor does NOT automatically resume old todos — turn todos are scoped to the turn that created them. The user can ask to continue, which creates a new turn with new todos.

Rationale: Auto-resuming across turns adds complexity (detecting stale todos, re-establishing context) and could surprise users. Explicit is better.

### 4. Tool Access for Workers

Only the supervisor has access to turn todo tools. Workers don't know about the plan. The supervisor marks items complete after delegation returns. This keeps plan management centralized.

### 5. Concurrent Tool Execution

Sequential execution only. The supervisor picks one todo at a time, executes it, marks it complete, then moves to the next. Parallel execution adds complexity around error handling and status tracking.

---

## Implementation Plan

1. **Schema & types** — `src/todos/types.ts`, `src/todos/turn-todo-repository.ts`, schema in `src/db/index.ts`
2. **Tools** — `turn-todo-create.ts`, `turn-todo-list.ts`, `turn-todo-complete.ts` in `src/tools/native/`
3. **Tool registration** — Register in `src/index.ts`, supervisor-only access
4. **Tool context** — Pass `turnId`/`conversationId` to tool execution
5. **System prompt** — Add planning section to supervisor's `buildSystemPrompt()`
6. **Loop limit** — Dynamic iteration cap when todos are active
7. **Tests** — Unit tests for repository, tools, and integration
