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
2. **Rich schema** — Current TODOs have `title` + `description` but no justification
   or completion criteria. Agents can't judge "is this done?" or "why this?"
3. **Lifecycle management** — No tools for updating, promoting, demoting, or completing
   TODOs. No backlog concept.
4. **Execution model** — No defined flow for how a TODO goes from "pending" to "done".
   Who creates the execution conversation? Who reviews the result?
5. **Planning cadence** — No structure for periodic TODO planning sessions.

---

## 2. TODO Capacity Model

### 2.1 Two-Tier System: Active + Backlog (Per-Pillar)

```
┌─────────────────────────────────────────────┐
│ Active TODOs (default limit: 5 per pillar)  │
│                                             │
│ These are the CURRENT priorities.           │
│ Status: pending | in_progress               │
│ Agents execute these NOW.                   │
│                                             │
│ When completed/cancelled → freed slot       │
│ When backlog item promoted → fills slot     │
├─────────────────────────────────────────────┤
│ Backlog (default limit: 20 per pillar)      │
│                                             │
│ These are CANDIDATES for pickup.            │
│ Status: backlog                             │
│ Reviewed during planning cadence.           │
│                                             │
│ When promoted → moves to Active             │
│ When stale → cancelled                      │
└─────────────────────────────────────────────┘
```

### 2.2 Configuration in mission.json

```json
{
  "name": "Improve Developer Experience",
  "todo": {
    "activeTodoLimit": 5,
    "backlogTodoLimit": 20
  },
  "pillars": [...]
}
```

Defaults: `activeTodoLimit = 5`, `backlogTodoLimit = 20` (per pillar).

**Enforcement:**
- `mission_todo_create` checks the **pillar's** TODO count before creating. If the
  pillar's active list is full, the TODO is created in `backlog` status (with a
  warning to the agent). If the pillar's backlog is also full, creation is rejected —
  the agent must cancel or complete existing items first.
- This forces prioritization: "This pillar has 5 active TODOs and 20 backlog items.
  To add a new one, you must first cancel or complete something."

### 2.3 Per-Pillar Limits

Limits are per-**pillar** (not per-mission). Each pillar gets its own capacity (5 active,
20 backlog by default). This design:

1. **Encourages focus** — Each pillar must prioritize its own top 5 items, preventing
   sprawl within a single area
2. **Enables parallel progress** — All pillars can make progress independently without
   competing for a shared TODO pool
3. **Simplifies ownership** — Pillar Owners manage their pillar's TODO capacity directly
4. **Scales with pillars** — A mission with 4 pillars has 20 total active slots (4×5),
   naturally scaling capacity with scope

The limits are configured at mission level (shared defaults for all pillars) but
enforced per-pillar.

---

## 3. TODO Schema

### 3.1 Enhanced Schema

```typescript
interface MissionTodo {
  id: string;                       // GUID — TODOs are always referenced by ID
  pillarId: string;
  missionId: string;

  // --- Core fields ---
  title: string;                    // Concise, actionable (verb-first)
  description: string;              // What needs to be done (detailed)
  justification: string;            // NEW: Why this, why now — links to metrics/strategy
  completionCriteria: string;       // NEW: How to judge "done" — measurable criteria

  // --- Lifecycle ---
  status: 'backlog' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';

  // --- Execution ---
  outcome: string | null;           // Result summary (filled on completion)

  // --- Timestamps ---
  createdAt: string;
  startedAt: string | null;         // When status → in_progress
  completedAt: string | null;       // When status → completed OR cancelled
}
```

**Key decisions:**
- **TODOs use GUID IDs** — there are no TODO slugs. Only missions and pillars have slugs.
- **`completedAt` is used for both completion and cancellation** — when a TODO is
  cancelled, `completedAt` records the cancellation time and `status` distinguishes
  cancelled from completed. No separate `cancelledAt` field.

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

  ┌───────────┐  cancel (from backlog or pending only)
  │ cancelled │  ◄───────────────────── (backlog | pending)
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
| `backlog` | `cancelled` | Mission Lead | `mission_todo_update` (cancel) |
| `pending` | `cancelled` | Mission Lead | `mission_todo_update` (cancel) |

**Key constraints:**
- Only Mission Lead can mark a TODO as `completed`. This ensures a review step —
  the executing agent cannot self-certify completion.
- **Cannot cancel an `in_progress` TODO.** We have no reliable cancellation for a
  running agent turn. An in-progress TODO must either be completed or left to finish.
  Cancellation only applies to `backlog` and `pending` items.

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
  priority: 'critical' | 'high' | 'medium' | 'low',
  targetStatus: 'pending' | 'backlog',  // NEW: default 'pending'
}
```

**Enforcement logic:**
1. Count active TODOs (pending + in_progress) for this **pillar**
2. If `targetStatus === 'pending'` and count >= `activeTodoLimit`:
   - Create as `backlog` instead, warn agent:
     "Active TODO limit (5) per pillar reached. Created in backlog instead."
3. If `targetStatus === 'backlog'` and pillar's backlog count >= `backlogTodoLimit`:
   - Reject: "Backlog limit (20) per pillar reached. Cancel or complete existing items first."

### 4.2 `mission_todo_update` (new)

```typescript
{
  todoId: string,              // required (GUID of the TODO to update)
  action: 'promote' | 'demote' | 'start' | 'cancel',
  reason: string,              // required: why this action
}
```

**Action semantics:**

| Action | From Status | To Status | Notes |
|--------|------------|-----------|-------|
| `promote` | backlog | pending | Checks active limit; fails if full |
| `demote` | pending | backlog | Frees an active slot |
| `start` | pending | in_progress | Sets `startedAt = now` |
| `cancel` | backlog, pending | cancelled | Sets `completedAt = now`. **Cannot cancel in_progress.** |

**Tool access:**
- Available to Mission Lead agent (all actions)
- Available to Pillar Owner agent (restricted to `cancel` only via agent prompt guidance)

### 4.3 `mission_todo_complete` (new)

Separate from `mission_todo_update` because completion requires review authority.

```typescript
{
  todoId: string,              // required (GUID)
  outcome: string,             // required: summary of what was accomplished
}
```

**Completion logic:**
1. Verify TODO is `in_progress` (cannot complete from `pending`)
2. Set `status = 'completed'`, `completedAt = now`, `outcome = outcome`
3. Return completion summary

**Tool access:** Only Mission Lead agent has access to `mission_todo_complete`.
This is enforced via the agent's `canAccessTools` configuration — the tool is
included in Mission Lead's tool list but NOT in Pillar Owner's.

**Mission tools visibility:** All mission-related tools (`mission_todo_create`,
`mission_todo_update`, `mission_todo_complete`, `mission_metric_record`) are
restricted to mission-specific agents only. Regular supervisor agents and worker
agents outside the mission context do NOT have access to these tools.

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
  │     │     todoId, outcome: "..."
  │     │   })
  │     └── If not: sends feedback, pillar-owner continues work
  │
  └── 5. Completed TODO frees an active slot for the next item
```

### 5.2 Pillar TODO Chat — Well-Known Conversation IDs

Each pillar gets **one TODO chat** for **all** TODO planning and execution. The chat
uses a **well-known (non-GUID) conversation ID** derived from slugs:

```
Mission slug: "developer-experience"
  ├── Pillar: "build-performance"
  │     └── Conversation ID: "developer-experience-build-performance-todo"
  │         Title: "[TODOs] Build Performance"
  │           ├── Turn 1: plan TODOs for this pillar
  │           ├── Turn 2: execute TODO "Profile webpack build..."
  │           ├── Turn 3: execute TODO "Evaluate esbuild-loader..."
  │           └── ...
  ├── Pillar: "onboarding"
  │     └── Conversation ID: "developer-experience-onboarding-todo"
  │         Title: "[TODOs] Onboarding"
  │           └── ...
  └── ...
```

**Well-known conversation ID pattern:**
- Pillar TODO chat: `{missionSlug}-{pillarSlug}-todo`
- Metric collection chat: `{missionSlug}-metric`
- These are **not GUIDs** — they are predictable, human-readable, and can be
  constructed from slugs without a DB lookup.

**Chat creation and validation:**
- All mission-related chats (mission, pillar, pillar-todo, metric) are created
  during `syncPillars()` when a mission is first loaded.
- On startup, a **non-blocking validation** checks that all expected well-known
  conversations exist and creates any that are missing.

**Key design decisions:**

- **One TODO chat per pillar for both planning AND execution** — all TODO work for a
  pillar happens in a single conversation. This includes planning (reviewing metrics,
  creating/cancelling TODOs) and execution (running tasks, reporting results).
- **Stateless per-turn execution** — following the feed channel pattern, each TODO
  execution turn does NOT use chat history context. The execution prompt includes all
  needed context (TODO definition, completion criteria, tool config). This avoids
  unbounded context growth in the TODO chat.
- **Mission Lead orchestrates through pillar TODO chat** — all invocations of the
  Pillar Owner worker agent go through the Mission Lead, which delegates to the
  Pillar Owner in the pillar TODO chat for actual tool use.
- **Human can view the chat** — provides visibility into TODO execution for a pillar.
- **Human can send messages** (when agent is idle) — these feed into the conversation
  context for the next agent turn.

### 5.3 Async Delegation via the `delegate` Tool

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

### 5.4 Human Intervention

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
for their pillar. This happens in the **pillar TODO chat** (same chat as execution).

### 6.2 Planning Prompt

The Mission Lead injects a planning prompt into the pillar TODO chat:

```
## TODO Planning Cycle

Review the current state of the {pillarName} pillar:

### Goals
{pillar.description}

### Current Metrics
{for each metric: name, current, target, status, trend}

### Active Strategies
{for each strategy: description, status}

### Active TODOs ({activeCount}/{activeTodoLimit} for this pillar)
{for each active TODO: id, title, status, age}

### Backlog ({backlogCount}/{backlogTodoLimit} for this pillar)
{for each backlog TODO: id, title, age}

### Instructions
1. Review whether active TODOs are still the right priorities given current metrics
2. Cancel any TODOs that are no longer relevant (use their ID)
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
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('backlog', 'pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK(priority IN ('critical', 'high', 'medium', 'low')),
  outcome TEXT,
  createdAt TEXT NOT NULL,
  startedAt TEXT,                                -- When status → in_progress
  completedAt TEXT                               -- When status → completed OR cancelled
);
```

**Changes from current:**
- Added `justification` column
- Added `completionCriteria` column
- Removed `conversationId` column (TODO execution uses well-known pillar TODO chats)
- Removed `assignedAgent` column (always pillar-owner in v1)
- Added `backlog` and `cancelled` to status CHECK constraint; removed `blocked`

### 7.2 Updated `missions` Table (for limits)

The `jsonConfig` column already stores arbitrary JSON. The `todo.activeTodoLimit`
and `todo.backlogTodoLimit` values live in `jsonConfig`. No schema change needed.

---

## 8. Detailed Example: End-to-End TODO Lifecycle

### Scenario: "Profile webpack build to identify slow plugins"

**1. Creation (during TODO planning in pillar TODO chat)**

Pillar Owner for Build Performance runs TODO planning:
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
  targetStatus: "pending"
```

**2. Activation (Mission Lead starts the TODO)**

Mission Lead reviews the pillar's TODO list and starts execution:
```
[calls mission_todo_update]
  todoId: "a3f8b2c1-4567-89ab-cdef-0123456789ab"
  action: "start"
  reason: "Build time degradation confirmed by 3 consecutive readings. Starting investigation."

→ Sets todo.startedAt, todo.status = 'in_progress'
```

**3. Execution (Pillar Owner works in the pillar TODO chat)**

Mission Lead delegates to pillar-owner in the
"developer-experience-build-performance-todo" chat:
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
  todoId: "a3f8b2c1-4567-89ab-cdef-0123456789ab"
  outcome: "Identified ts-loader (39%), css-loader+postcss (17%), terser (12%) as
    top 3 contributors. Recommended switching to esbuild-loader for ts-loader.
    Follow-up TODO created for migration evaluation."

→ Sets todo.status = 'completed', todo.completedAt = now
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

## 9. Open Questions

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

---

## 10. Implementation Priority

| Phase | Description | Effort |
|-------|-------------|--------|
| **Phase 1** | Schema migration: add `justification`, `completionCriteria`, new statuses (`backlog`, `cancelled`), remove `conversationId`, `assignedAgent`, `blocked` | S |
| **Phase 2** | Implement `mission_todo_update` tool with promote/demote/start/cancel actions | M |
| **Phase 3** | Implement `mission_todo_complete` tool (Mission Lead only) | S |
| **Phase 4** | Add capacity enforcement to `mission_todo_create` (active + backlog limits from config) | S |
| **Phase 5** | Well-known pillar TODO chats: create during mission init, validate on startup | M |
| **Phase 6** | TODO execution flow: stateless delegation to pillar-owner on `start` (feed channel pattern) | L |
| **Phase 7** | Async delegation model (fire-and-forget for long-running TODOs) | L |
| **Phase 8** | Planning cadence: inject TODO planning prompt into pillar TODO chat at cycle time | M |
| **Phase 9** | UI integration: TODO detail view with execution chat, status badges | L |
