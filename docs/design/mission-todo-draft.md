# Mission TODOs — Design Draft

> **Status:** Draft — Feb 2026
>
> **Depends on:** Mission system (implemented), mission_todos table (implemented),
> MissionLeadAgent (implemented), pillar-owner agent (implemented),
> mission_todo_create tool (implemented)

---

## 1. Problem Statement

The current TODO system has a basic schema and a create tool, but lacks:

1. **Capacity limits** — Without limits, agents create unbounded TODOs and never
   prioritize. We need artificial scarcity to force focus.
2. **Rich schema** — Current TODOs have `title` + `description` but no justification,
   completion criteria, or deadline. Agents can't judge "is this done?" or "why this?"
3. **Lifecycle management** — No tools for updating, promoting, demoting, or completing
   TODOs. No backlog concept.
4. **Execution model** — No defined flow for how a TODO goes from "pending" to "done".
   Who creates the execution conversation? Who reviews the result?
5. **Planning cadence** — No structure for periodic TODO planning sessions.

---

## 2. TODO Capacity Model

### 2.1 Two-Tier System: Active + Backlog

```
┌─────────────────────────────────────────────┐
│ Active TODOs (default limit: 10)            │
│                                             │
│ These are the CURRENT priorities.           │
│ Status: pending | in_progress               │
│ Agents execute these NOW.                   │
│                                             │
│ When completed/cancelled → freed slot       │
│ When backlog item promoted → fills slot     │
├─────────────────────────────────────────────┤
│ Backlog (default limit: 50)                 │
│                                             │
│ These are CANDIDATES for pickup.            │
│ Status: backlog                             │
│ Reviewed during planning cadence.           │
│                                             │
│ When promoted → moves to Active             │
│ When stale → cancelled/archived             │
└─────────────────────────────────────────────┘
```

### 2.2 Configuration in mission.json

```json
{
  "name": "Improve Developer Experience",
  "todo": {
    "activeTodoLimit": 10,
    "backlogTodoLimit": 50
  },
  "pillars": [...]
}
```

Defaults: `activeTodoLimit = 10`, `backlogTodoLimit = 50`.

**Enforcement:**
- `mission_todo_create` checks count before creating. If active list is full, the
  TODO is created in `backlog` status (with a warning to the agent). If backlog is
  also full, creation is rejected — the agent must cancel or complete existing items
  first.
- This forces prioritization: "You have 10 active TODOs and 50 backlog items. To add
  a new one, you must first cancel or complete something."

### 2.3 Per-Pillar vs. Mission-Level Limits

Limits are per-**mission** (not per-pillar). This prevents a single pillar from
monopolizing the TODO capacity. The Mission Lead is responsible for balancing allocation
across pillars.

---

## 3. TODO Schema

### 3.1 Enhanced Schema

```typescript
interface MissionTodo {
  id: string;
  pillarId: string;
  missionId: string;

  // --- Core fields ---
  title: string;                    // Concise, actionable (verb-first)
  description: string;              // What needs to be done (detailed)
  justification: string;            // NEW: Why this, why now — links to metrics/strategy
  completionCriteria: string;       // NEW: How to judge "done" — measurable criteria
  deadline: string | null;          // NEW: ISO 8601 date or null (no deadline)

  // --- Lifecycle ---
  status: 'backlog' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';  // Reserved: not used in v1
  assignedAgent: string | null;     // Reserved: not used in v1 (always pillar-owner)

  // --- Execution ---
  outcome: string | null;           // Result summary (filled on completion)

  // --- Timestamps ---
  createdAt: string;
  startedAt: string | null;         // When status → in_progress
  completedAt: string | null;       // When status → completed
}
```

### 3.2 Status Transitions

```
                          promote
  ┌──────────┐  ──────────────────────►  ┌─────────┐
  │ backlog  │                            │ pending │
  └──────────┘  ◄──────────────────────  └─────────┘
                          demote               │
                                               │ start execution
                                               ▼
                                         ┌────────────┐
  ┌───────────┐  complete (Mission Lead) │ in_progress│
  │ completed │  ◄───────────────────── └────────────┘
  └───────────┘

  ┌───────────┐  cancel (from any state)
  │ cancelled │  ◄───────────────────── (any non-completed)
  └───────────┘
```

Valid transitions:
| From | To | Who | Tool |
|------|-----|-----|------|
| (new) | `backlog` | Mission Lead, Pillar Owner | `mission_todo_create` |
| (new) | `pending` | Mission Lead, Pillar Owner | `mission_todo_create` |
| `backlog` | `pending` | Mission Lead | `mission_todo_update` (promote) |
| `pending` | `backlog` | Mission Lead | `mission_todo_update` (demote) |
| `pending` | `in_progress` | Mission Lead | `mission_todo_update` (start) |
| `in_progress` | `completed` | Mission Lead **only** | `mission_todo_complete` |
| any (not completed) | `cancelled` | Mission Lead | `mission_todo_update` (cancel) |

**Key constraint:** Only Mission Lead can mark a TODO as `completed`. This ensures
a review step — the executing agent cannot self-certify completion.

---

## 4. Tool Specifications

### 4.1 `mission_todo_create` (exists — enhanced)

Add these new fields to the existing tool:

```typescript
{
  missionSlug: string,         // required
  pillarSlug: string,          // required
  title: string,               // required
  description: string,         // what needs to be done
  justification: string,       // NEW: why this, why now
  completionCriteria: string,  // NEW: measurable "done" definition
  deadline: string | null,     // NEW: ISO 8601 date or null
  priority: 'critical' | 'high' | 'medium' | 'low',  // reserved: not used in v1
  assignedAgent: string | null,  // reserved: not used in v1 (always pillar-owner)
  targetStatus: 'pending' | 'backlog',  // NEW: default 'pending'
}
```

**Enforcement logic:**
1. Count active TODOs (pending + in_progress) for this mission
2. If `targetStatus === 'pending'` and count >= `activeTodoLimit`:
   - Create as `backlog` instead, warn agent:
     "Active TODO limit (10) reached. Created in backlog instead."
3. If `targetStatus === 'backlog'` and backlog count >= `backlogTodoLimit`:
   - Reject: "Backlog limit (50) reached. Cancel or complete existing items first."

### 4.2 `mission_todo_update` (new)

```typescript
{
  missionSlug: string,         // required
  todoId: string,              // required (the TODO to update)
  action: 'promote' | 'demote' | 'start' | 'cancel',
  reason: string,              // required: why this action
}
```

**Action semantics:**

| Action | From Status | To Status | Notes |
|--------|------------|-----------|-------|
| `promote` | backlog | pending | Checks active limit; fails if full |
| `demote` | pending | backlog | Frees an active slot |
| `start` | pending | in_progress | Sets startedAt, execution happens in pillar TODO chat |
| `cancel` | any (not completed) | cancelled | Requires reason |

**Permission model:**
- Mission Lead: all actions
- Pillar Owner: `cancel` only (cannot self-promote or self-complete)

### 4.3 `mission_todo_complete` (new)

Separate from `mission_todo_update` because completion requires review authority.

```typescript
{
  missionSlug: string,         // required
  todoId: string,              // required
  outcome: string,             // required: summary of what was accomplished
  metricsImpacted: string[],   // optional: metric slugs that may have changed
}
```

**Completion logic:**
1. Verify TODO is `in_progress` (cannot complete from `pending`)
2. Verify caller is Mission Lead (pillar-owners and workers cannot complete)
3. Set `status = 'completed'`, `completedAt = now`, `outcome = outcome`
4. If `metricsImpacted` is provided, trigger metric re-collection for those metrics
5. Return completion summary

**Permission restriction:** The `mission_todo_complete` tool is marked `private: true`
in the tool runner. Only agents with explicit tool access (Mission Lead) can use it.
Pillar Owner's `canAccessTools` list does NOT include `mission_todo_complete`.

---

## 5. Execution Model

### 5.1 Lifecycle: Pending → In Progress → Completed

```
Mission Lead decides to start a TODO
  │
  ├── 1. Calls mission_todo_update({ action: 'start', todoId })
  │     → Sets todo.startedAt = now
  │     → Sets todo.status = 'in_progress'
  │
  ├── 2. Mission Lead delegates to pillar-owner in the pillar TODO chat:
  │     "Execute this task: [title]. [description].
  │      Completion criteria: [completionCriteria].
  │      Use the tools available to you."
  │
  ├── 3. Pillar Owner works in the pillar TODO chat:
  │     ├── Uses tools (web_search, user tools, MCP tools)
  │     ├── May delegate to sub-workers (researcher, coder, writer)
  │     ├── Reports progress in conversation
  │     └── When done, sends result summary back to Mission Lead
  │
  ├── 4. Mission Lead reviews the result in the pillar TODO chat
  │     ├── If satisfied: calls mission_todo_complete({
  │     │     todoId, outcome: "...", metricsImpacted: ["build-time"]
  │     │   })
  │     └── If not: sends feedback, pillar-owner continues work
  │
  └── 5. Completed TODO frees an active slot for the next item
```

### 5.2 Chat as the Context of Execution

Each pillar gets **one TODO chat** for all its TODO execution:

```
Mission: "Developer Experience"
  ├── Pillar: "Build Performance"
  │     └── Chat: "[TODOs] Build Performance"
  │           ├── Turn 1: execute TODO "Profile webpack build..."
  │           ├── Turn 2: execute TODO "Evaluate esbuild-loader..."
  │           └── ...
  ├── Pillar: "Onboarding"
  │     └── Chat: "[TODOs] Onboarding"
  │           └── ...
  └── ...
```

**Key design decisions:**

- **One TODO chat per pillar** — all TODOs for a pillar share a single conversation.
  This avoids chat explosion (not 1 chat per TODO) while keeping pillar work
  naturally separated.
- **Created during mission initialization** — alongside the existing mission and
  pillar conversations, with metadata:
  `{ channel: 'pillar-todo', missionId, missionSlug, pillarId, pillarSlug }`
- **Append-only log** — each TODO execution appends turns to the same chat,
  creating a chronological trail of all work done for the pillar.
- **Human can view the chat** — provides visibility into TODO execution for a pillar
- **Human can send messages** (when agent is idle) — these feed into the conversation
  context for the next agent turn

### 5.3 Conversation Resumption (No Time Limits)

Both OpenAI and Anthropic APIs are **stateless** — there are no time limits on
resuming a conversation. The full message history is sent with each request.

**Key implications for long-running TODOs:**
- A TODO can span hours or days. The agent resumes by loading the conversation
  history from the DB and continuing.
- The **context window** is the only constraint. For very long execution conversations,
  we'll need message compaction (summarize older messages).
- No need for a "keep-alive" mechanism or session tokens.

### 5.4 Async Delegation via the `delegate` Tool

**Current state:** The supervisor (and MissionLeadAgent) **blocks** while a delegated
worker executes. It `await`s `handleDelegatedTask()` and cannot process new messages
until the worker finishes.

**Problem:** For TODO execution, the pillar-owner may take minutes or hours. Blocking
the Mission Lead for the entire duration means no other TODO can start, no other
pillar chat can be served, and no metric collection can happen.

**Proposed solution:** Add an `async` parameter to the native `delegate` tool for
fire-and-forget delegation.

```typescript
// delegate tool — new parameter
{
  type: string,           // existing
  mission: string,        // existing
  rationale?: string,     // existing
  async?: boolean,        // NEW: fire-and-forget delegation (default: false)
  callerAgentId?: string, // existing
}
```

```
Current (blocking, async: false — default):
  Mission Lead → await delegateToWorker(task) → wait... → worker done → idle

With async: true:
  Mission Lead → delegate(task, { async: true }) → immediately idle
  Worker runs independently, posts result to pillar TODO chat when done
  Mission Lead picks up result on next message/cycle
```

**Implementation approach:**
- When `async: true`, `handleDelegationFromTool` does NOT await the worker
- Instead, it fires `agent.handleDelegatedTask()` as a detached promise
- The worker posts its result to the pillar TODO chat (persisted in DB)
- On the next cadence cycle (or when user messages), Mission Lead reads the
  pillar TODO chat history and sees the worker's result
- This requires a new message type or convention for "worker completed TODO"

**Risk:** Detached promises can lose error context. Mitigate by wrapping in
try/catch with error persisted to the conversation.

### 5.5 Human Intervention

For v1, human intervention is minimal:
- Human can view the pillar TODO chat in the UI (read-only while agent is
  actively working)
- Human can send messages when the agent is idle (completed or gave up)
- These messages become part of the conversation context for the next agent turn

**Deferred to v2:** Interruption model (pause a running agent, redirect work, force-stop).

---

## 6. TODO Planning Cadence

### 6.1 When Planning Happens

At each mission cadence cycle, the Pillar Owner should perform **TODO planning**
for their pillar. This happens in the **pillar chat** (not the TODO execution chat).

### 6.2 Planning Prompt

The Mission Lead (or system) injects a planning prompt into the pillar chat:

```
## TODO Planning Cycle

Review the current state of the {pillarName} pillar:

### Goals
{pillar.description}

### Current Metrics
{for each metric: name, current, target, status, trend}

### Active Strategies
{for each strategy: description, status}

### Active TODOs ({activeCount}/{activeTodoLimit})
{for each active TODO: title, status, priority, assignedAgent, age}

### Backlog ({backlogCount}/{backlogTodoLimit})
{for each backlog TODO: title, priority, age}

### Instructions
1. Review whether active TODOs are still the right priorities given current metrics
2. Cancel any TODOs that are no longer relevant
3. Promote backlog items that are now higher priority
4. Create new TODOs if there are open slots and unaddressed metric gaps
5. Ensure each TODO has clear justification and completion criteria
6. Consider metric trends — are strategies working? Do we need new ones?
```

### 6.3 Planning Outputs

The Pillar Owner uses `mission_todo_create` and `mission_todo_update` tools to:
1. Create new TODOs (up to the limit)
2. Cancel stale TODOs (frees slots)
3. Promote high-priority backlog items
4. Demote active TODOs that are no longer urgent
5. Re-prioritize existing TODOs

The Mission Lead reviews the planning output and may adjust priorities across pillars.

---

## 7. Database Schema Changes

### 7.1 Updated `mission_todos` Table

```sql
CREATE TABLE IF NOT EXISTS mission_todos (
  id TEXT PRIMARY KEY,
  pillarId TEXT NOT NULL REFERENCES pillars(id) ON DELETE CASCADE,
  missionId TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',        -- NEW
  completionCriteria TEXT NOT NULL DEFAULT '',    -- NEW
  deadline TEXT,                                  -- NEW: ISO 8601 date
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('backlog', 'pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK(priority IN ('critical', 'high', 'medium', 'low')),
  assignedAgent TEXT,
  outcome TEXT,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  completedAt TEXT
);
```

**Changes from current:**
- Added `justification` column
- Added `completionCriteria` column
- Added `deadline` column
- Removed `conversationId` column (TODO execution uses per-pillar TODO chat)
- Added `backlog` and `cancelled` to status CHECK constraint; removed `blocked`

### 7.2 Updated `missions` Table (for limits)

The `jsonConfig` column already stores arbitrary JSON. The `todo.activeTodoLimit`
and `todo.backlogTodoLimit` values live in `jsonConfig`. No schema change needed.

---

## 8. Detailed Example: End-to-End TODO Lifecycle

### Scenario: "Profile webpack build to identify slow plugins"

**1. Creation (during TODO planning)**

Pillar Owner for Build Performance runs TODO planning in pillar chat:
```
Agent: Based on the current build time of 72s (target: <60s, warning: 90s, status: warning),
I'm creating a TODO to investigate.

[calls mission_todo_create]
  missionSlug: "developer-experience"
  pillarSlug: "build-performance"
  title: "Profile webpack build to identify top 3 slow plugins"
  description: "Run webpack --profile --json, analyze the output, and identify the
    3 plugins contributing most to build time. Report time contribution per plugin."
  justification: "Build time is 72s, 12s above the 60s target. Last 3 readings show
    degrading trend (55→63→72). The cache-hit-rate metric is stable, so the issue is
    likely in the transform phase, not caching."
  completionCriteria: "Deliver a list of the top 3 plugins by time contribution,
    with percentage of total build time. Include recommendation for each: keep, replace,
    or configure differently."
  deadline: "2026-02-21"
  targetStatus: "pending"
```

**2. Activation (Mission Lead starts the TODO)**

Mission Lead reviews the pillar's TODO list and starts execution:
```
[calls mission_todo_update]
  missionSlug: "developer-experience"
  todoId: "todo_abc123"
  action: "start"
  reason: "Build time degradation confirmed by 3 consecutive readings. Starting investigation."

→ Sets todo.startedAt, todo.status = 'in_progress'
```

**3. Execution (Pillar Owner works in the pillar TODO chat)**

Mission Lead delegates to pillar-owner in the "[TODOs] Build Performance" chat:
```
"Execute: Profile webpack build to identify top 3 slow plugins.

Description: Run webpack --profile --json, analyze output, identify 3 plugins
contributing most to build time.

Completion criteria: List of top 3 plugins by time contribution with
percentage and recommendation.

Use available tools. Report back when done."
```

Pillar Owner works:
```
1. Calls user.run_command({ command: "npx webpack --profile --json > stats.json" })
2. Calls user.run_command({ command: "npx webpack-bundle-analyzer stats.json --mode json" })
3. Analyzes output, identifies:
   - ts-loader: 28s (39% of total)
   - css-loader + postcss: 12s (17%)
   - terser-webpack-plugin: 9s (12%)
4. Reports: "Top 3 plugins identified. ts-loader dominates at 39%.
   Recommendation: Evaluate esbuild-loader as replacement for ts-loader."
```

**4. Completion (Mission Lead reviews and completes)**

Mission Lead reviews the result in the pillar TODO chat:
```
[calls mission_todo_complete]
  missionSlug: "developer-experience"
  todoId: "todo_abc123"
  outcome: "Identified ts-loader (39%), css-loader+postcss (17%), terser (12%) as
    top 3 contributors. Recommended switching to esbuild-loader for ts-loader.
    Follow-up TODO created for migration evaluation."
  metricsImpacted: ["local-build-time"]

→ Sets todo.status = 'completed', todo.completedAt = now
→ Triggers re-collection of local-build-time metric
→ Frees one active TODO slot
```

**5. Follow-up (new TODO created)**

```
[calls mission_todo_create]
  title: "Evaluate esbuild-loader migration for ts-loader replacement"
  justification: "Profiling revealed ts-loader accounts for 39% of build time.
    esbuild-loader is 10-50x faster for TypeScript compilation."
  completionCriteria: "Run esbuild-loader on the codebase, compare build times,
    identify any compatibility issues. Report: build time delta, test pass rate,
    and list of breaking changes (if any)."
```

---

## 9. Deadline and Escalation

### 9.1 Deadline Checking

At each cadence cycle, the Mission Lead checks all active TODOs for overdue items:

```
For each active TODO with a deadline:
  If deadline < now AND status IN ('pending', 'in_progress'):
    → Mark as overdue (add tag or flag)
    → If in_progress: give a warning to the worker, extend or cancel
    → If pending (never started): auto-cancel or demote to backlog
```

### 9.2 Escalation to Human

When a TODO is overdue:
1. Mission Lead posts a message in the **mission chat** (not pillar chat):
   "TODO overdue: [title]. Status: [status] since [date].
   Please advise: extend deadline or cancel?"
2. User responds in mission chat
3. Mission Lead acts on the response (update deadline, cancel, etc.)

---

## 10. Open Questions

1. **Active limit enforcement granularity** — Should the limit be strictly enforced
   (hard reject at 10) or soft (warn at 10, reject at 12)?

2. **TODO archiving** — Completed and cancelled TODOs accumulate. Should we archive
   them after N days to keep the active query fast?

3. **Cross-pillar TODOs** — Some work spans pillars. Should we support a `pillarId`
   array instead of a single reference?

4. **TODO templates** — Common TODO types (profiling, audit, migration eval) could
   have templates with pre-filled justification/criteria patterns.

5. **Backlog pruning** — Should backlog items older than N days be auto-cancelled?
   Or should the agent explicitly review and decide?

6. **Async delegation implementation** — The fire-and-forget delegation model is
   a significant architecture change. Should we implement a message queue or use
   Node.js detached promises?

---

## 11. Implementation Priority

| Phase | Description | Effort |
|-------|-------------|--------|
| **Phase 1** | Schema migration: add `justification`, `completionCriteria`, `deadline`, new statuses (`backlog`, `cancelled`) | S |
| **Phase 2** | Implement `mission_todo_update` tool with promote/demote/start/cancel actions | M |
| **Phase 3** | Implement `mission_todo_complete` tool with permission restriction (private tool) | S |
| **Phase 4** | Add capacity enforcement to `mission_todo_create` (active + backlog limits from config) | S |
| **Phase 5** | TODO execution flow: pillar TODO chat creation during mission init, delegation to pillar-owner on `start` | L |
| **Phase 6** | Async delegation model (fire-and-forget for long-running TODOs) | L |
| **Phase 7** | Planning cadence: inject TODO planning prompt into pillar chat at cycle time | M |
| **Phase 8** | Deadline checking and escalation logic | M |
| **Phase 9** | UI integration: TODO detail view with execution chat, status badges, deadline indicators | L |
