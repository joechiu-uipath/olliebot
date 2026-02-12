# Mission Tab — Feature Design

## Level 4 Continuous Agent Proof of Concept

> **Status:** Design
> **Reference:** [Agentic Levels](/docs/agentic-levels.md) — Level 4: Continuous System (Open-Ended Direction Optimization)

---

## 1. Motivation

Level 4 in our agentic hierarchy describes a **continuous system** — one that pursues a directional goal over an indefinite time horizon in a non-stationary environment. There is no terminal state. The goal is a direction, not a destination. The system must continuously monitor, assess, prioritize, act, and adapt.

The **Mission tab** is the UI surface for prototyping this level. A mission is a long-running, never-finishing directive — "Continuously improve developer experience", "Maintain and grow community engagement", "Keep the codebase healthy and well-tested" — that the system pursues autonomously across days, weeks, and months.

This design covers the full stack: authoring format, runtime schema, agent architecture, UX layout, navigation, and information architecture.

---

## 2. Mission Authoring & Bootstrap

### 2.1 Authoring: Markdown Files

Users author missions as `.md` files in the `/user/missions/` directory. This follows the established pattern from the task system (`/user/tasks/*.md`), where human-readable markdown is the authoring surface.

**File location:** `/user/missions/<mission-slug>.md`

**Example:** `/user/missions/developer-experience.md`

```markdown
# Improve Developer Experience

Our development tools and workflows should continuously improve. Developers should
spend less time fighting tooling and more time shipping features.

## Mission Parameters

- **Cadence:** Continuous — check environment every 4 hours
- **Scope:** Monorepo tooling, CI/CD, local dev setup, documentation
- **Stakeholders:** Engineering team

## Pillars

### Build Performance
Reduce build times and improve caching. Developers should never wait more than
60 seconds for a local dev build.

**Success Metrics:**
- Average local build time < 60s
- CI build time < 5 minutes
- Cache hit rate > 80%

**Strategies:**
- Profile build pipeline quarterly
- Evaluate new bundler releases
- Monitor cache invalidation patterns

### Documentation Currency
Documentation should accurately reflect the current state of the system. Stale
docs are worse than no docs.

**Success Metrics:**
- Zero documented APIs that no longer exist
- All new features documented within 1 week of merge
- README files updated within each package

**Strategies:**
- Weekly doc-drift scan comparing code exports to documented APIs
- PR bot that flags undocumented new exports
- Quarterly full documentation audit

### Onboarding Friction
New team members should be productive within their first week. The onboarding
path should be self-service and continuously validated.

**Success Metrics:**
- Time to first meaningful PR < 3 days
- Setup script success rate > 95%
- Zero manual setup steps not covered by automation

**Strategies:**
- Monthly onboarding dry-run by existing team member
- Track and eliminate every manual step
- Maintain "golden path" automation scripts

## Agents

### Mission Lead
- Model: claude-sonnet (or configurable)
- System prompt: See `/user/missions/prompts/developer-experience-lead.md`
- Responsibilities: Prioritize across pillars, generate TODO items, review completed work, update dashboards

### Workers
- deep-research-team: For investigating tools, benchmarking, analyzing trends
- coder: For implementing improvements, writing scripts, modifying configs
- writer: For documentation updates, report generation
```

### 2.2 Bootstrap: JSON Runtime Config

When the Mission Manager detects a new or changed `.md` file, it bootstraps (or updates) a schematized `.json` file that contains the **true runtime parameters** of the mission. The `.md` is the human-authored source of intent; the `.json` is the machine-operated runtime state.

**File location:** `/user/missions/<mission-slug>.json`

The LLM parses the markdown into the JSON schema (same pattern as `TaskManager` using `llmService.parseTaskConfig`). The JSON file is then the system of record for runtime operations.

### 2.3 JSON Schema

```jsonc
{
  "id": "uuid",
  "slug": "developer-experience",
  "name": "Improve Developer Experience",
  "description": "Our development tools and workflows should continuously improve...",
  "status": "active",              // active | paused | archived
  "cadence": "0 */4 * * *",       // cron expression for environment check cycle
  "scope": "Monorepo tooling, CI/CD, local dev setup, documentation",

  "agents": {
    "lead": {
      "model": "claude-sonnet",
      "systemPromptPath": "/user/missions/prompts/developer-experience-lead.md",
      "temperature": 0.3
    },
    "workers": [
      {
        "type": "deep-research-team",
        "config": {
          "leadModel": "claude-sonnet",
          "workerModel": "claude-haiku",
          "maxConcurrentWorkers": 3
        }
      },
      {
        "type": "coder",
        "config": { "model": "claude-sonnet", "sandboxed": true }
      },
      {
        "type": "writer",
        "config": { "model": "claude-sonnet" }
      }
    ]
  },

  "pillars": [
    {
      "id": "uuid",
      "slug": "build-performance",
      "name": "Build Performance",
      "description": "Reduce build times and improve caching...",
      "status": "active",

      "metrics": [
        {
          "id": "uuid",
          "name": "Average Local Build Time",
          "target": "< 60s",
          "current": "87s",
          "unit": "seconds",
          "trend": "improving",       // improving | stable | degrading | unknown
          "history": [
            { "timestamp": "2026-02-10T00:00:00Z", "value": 92 },
            { "timestamp": "2026-02-11T00:00:00Z", "value": 87 }
          ]
        }
        // ... more metrics
      ],

      "strategies": [
        {
          "id": "uuid",
          "description": "Profile build pipeline quarterly",
          "status": "active",
          "addedAt": "2026-02-01T00:00:00Z",
          "lastReviewedAt": "2026-02-10T00:00:00Z"
        }
        // ... more strategies
      ],

      "todos": [
        {
          "id": "uuid",
          "title": "Profile webpack build to identify slowest loaders",
          "description": "Run webpack --profile and analyze the output...",
          "status": "pending",        // pending | in_progress | completed | blocked
          "priority": "high",         // critical | high | medium | low
          "assignedAgent": null,       // null = unassigned, or agent type
          "conversationId": null,      // links to execution conversation
          "createdAt": "2026-02-11T00:00:00Z",
          "startedAt": null,
          "completedAt": null,
          "outcome": null              // summary of what was accomplished
        }
        // ... more todos
      ],

      "dashboard": {
        "lastGeneratedAt": "2026-02-11T12:00:00Z",
        "htmlPath": "/user/missions/dashboards/developer-experience/build-performance.html",
        "version": 14
      }
    }
    // ... more pillars
  ],

  "dashboard": {
    "lastGeneratedAt": "2026-02-11T12:00:00Z",
    "htmlPath": "/user/missions/dashboards/developer-experience/mission.html",
    "version": 23
  },

  "conversationId": "uuid",           // mission-level conversation (chat with mission lead)

  "createdAt": "2026-02-01T00:00:00Z",
  "updatedAt": "2026-02-11T12:00:00Z"
}
```

---

## 3. Agent Architecture

### 3.1 Mission Lead Agent

The Mission Lead is the orchestrator for a single mission. It operates on the mission's cadence cycle (e.g., every 4 hours) and has the following responsibilities:

- **Sense:** Assess the current state of each pillar's metrics (read dashboards, run diagnostic tools, review completed work)
- **Orient:** Compare current state to targets, identify which pillars need attention
- **Decide:** Prioritize across pillars, generate or reprioritize TODO items
- **Act:** Delegate TODO items to worker agents, monitor progress
- **Learn:** Review outcomes of completed TODOs, update strategies if patterns emerge
- **Report:** Regenerate mission-level and pillar-level dashboards

The Mission Lead has its own `.md` system prompt that can be customized per-mission to encode domain-specific behavior, priorities, and constraints.

**System prompt location:** Configurable via `agents.lead.systemPromptPath` in the JSON config.

### 3.2 Worker Agent Teams

Workers are composable units that the Mission Lead delegates to. Each worker type has a defined capability:

| Worker Type | Composition | Capability |
|---|---|---|
| **deep-research-team** | Lead + N workers | Multi-agent deep research (Level 1-2 pattern). Lead decomposes research questions, workers execute parallel searches, lead synthesizes. |
| **coder** | Single agent | Code modifications, script writing, config changes. Operates in sandboxed environment. |
| **writer** | Single agent | Documentation, reports, dashboard HTML generation. |
| **reviewer** | Single agent | Adversarial review of completed work (Level 2 pattern). |
| **monitor** | Single agent | Runs diagnostic commands, collects metrics, checks system health. |

Workers are **stateless per-task** — they receive a TODO item as input (with full context from the pillar and mission), execute it, and return an outcome. Their execution context is captured as a **conversation** (chat history) that serves as the log/audit trail.

### 3.3 Execution Flow

```
Mission Cadence Tick (cron)
  │
  ▼
Mission Lead Agent wakes
  │
  ├─► Reads current mission.json state
  ├─► Checks each pillar's metrics (may delegate to monitor workers)
  ├─► Reviews recently completed TODOs and their outcomes
  ├─► Generates/reprioritizes TODO items across all pillars
  │
  ▼
For each actionable TODO:
  │
  ├─► Mission Lead selects appropriate worker type
  ├─► Creates a conversation for the TODO execution
  ├─► Dispatches to worker agent with:
  │     - TODO description
  │     - Pillar context (metrics, strategies)
  │     - Mission context (scope, constraints)
  │     - Available tools
  │
  ▼
Worker executes (conversation as log):
  │
  ├─► Uses tools (code, search, browse, etc.)
  ├─► May ask for human input (routed to pillar-level chat)
  ├─► Completes work or reports blockers
  │
  ▼
Mission Lead reviews outcome:
  │
  ├─► Updates TODO status and outcome
  ├─► Updates pillar metrics if changed
  ├─► Regenerates dashboards (HTML)
  └─► Persists updated mission.json
```

### 3.4 Human-in-the-Loop

The embedded chat UX at mission and pillar levels allows the human operator to:

- **Intervene:** Directly instruct the Mission Lead ("pause work on build performance, focus on onboarding")
- **Guide:** Add context the system doesn't have ("we're migrating to Vite next month, factor that in")
- **Review:** Ask questions about decisions ("why did you prioritize this TODO over that one?")
- **Override:** Manually add/remove/reprioritize TODOs, modify strategies, adjust metrics targets

Human messages in the mission-level chat are processed by the Mission Lead with full mission context. Human messages in a pillar-level chat are processed with pillar-scoped context.

---

## 4. Dashboard Generation

### 4.1 Mission-Level Dashboard

An agent-composed HTML file that aggregates the state of all pillars. Generated by the writer worker on each cadence cycle (or when significant state changes occur).

**Contents:**
- Mission status summary (active since, last cycle, next cycle)
- Aggregate health indicator across all pillars
- Per-pillar summary card: name, status, key metric sparklines, trend indicators
- Recent activity feed: last N completed TODOs with outcomes
- Active work: currently in-progress TODOs and their assigned agents

**Stored at:** `/user/missions/dashboards/<mission-slug>/mission.html`

**Versioned:** Each generation increments a version counter. Previous versions can be retained for history.

### 4.2 Pillar-Level Dashboard

A more detailed HTML dashboard for a single pillar.

**Contents:**
- Pillar description and current status
- Full metrics table with current values, targets, trends, and sparkline history charts
- Strategy list with last-reviewed dates
- TODO breakdown: counts by status (pending, in-progress, completed, blocked)
- Recent completions with outcome summaries
- Active work detail

**Stored at:** `/user/missions/dashboards/<mission-slug>/<pillar-slug>.html`

### 4.3 Rendering

Dashboards are served by the backend as static HTML and rendered in the main content pane via an iframe or shadow DOM container. The agent is free to use inline CSS, SVG charts, and any self-contained HTML features. No external dependencies — the HTML must be fully self-contained.

---

## 5. UX Design

### 5.1 Top-Level Tab

Mission is a peer of Chat and Eval in the mode switcher. The header gains a third button:

```
┌──────────────────────────────────────────────────────────────┐
│  🐙 OllieBot     [ 💬 Chat ] [ 📊 Eval ] [ 🎯 Mission ]    │
└──────────────────────────────────────────────────────────────┘
```

When Mission mode is active, it takes full control of both the left sidebar and main content pane — same pattern as Eval mode.

**Route prefix:** `/mission/...`

### 5.2 Information Architecture & Navigation

The navigation follows a hierarchical drill-down pattern:

```
Mission List (sidebar)
  │
  ├─► Mission View (main content)
  │     ├── Dashboard tab
  │     ├── Pillars tab
  │     ├── Configuration tab
  │     └── Chat (embedded, collapsible bottom panel)
  │
  └─► Pillar View (main content, via pillar selection)
        ├── Dashboard tab
        ├── Metrics tab
        ├── Strategy tab
        ├── TODO List tab
        │     └─► Task Execution View (drill into single TODO)
        └── Chat (embedded, collapsible bottom panel)
```

### 5.3 Left Sidebar — Mission Mode

When in Mission mode, the sidebar displays mission navigation:

```
┌─────────────────────────┐
│  + New Mission      [◀] │
│─────────────────────────│
│  MISSIONS               │
│                         │
│  ● Developer Experience │  ← active (highlighted)
│    Status: Active       │
│    Pillars: 3           │
│    Last cycle: 2h ago   │
│                         │
│  ○ Community Growth     │  ← inactive
│    Status: Active       │
│    Pillars: 4           │
│    Last cycle: 1h ago   │
│                         │
│  ○ Code Health          │
│    Status: Paused       │
│    Pillars: 2           │
│                         │
│─────────────────────────│
│  PILLAR NAV             │  ← appears when a mission is selected
│  (breadcrumb context)   │
│                         │
│  ▸ Build Performance    │
│  ▸ Doc Currency         │
│  ▸ Onboarding Friction  │
│                         │
└─────────────────────────┘
```

**Sidebar sections:**
1. **Header:** "New Mission" button + collapse toggle (matches existing sidebar pattern)
2. **Mission List:** All missions with status badges, pillar count, last activity
3. **Pillar Navigation:** When a mission is selected, shows its pillars as a sub-nav. Clicking a pillar navigates the main content to the pillar view.

### 5.4 Main Content — Mission View

When a mission is selected (but no specific pillar), the main content shows the **mission-level view** with sub-tabs:

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Missions / Developer Experience                                │
│                                                                    │
│  [ Dashboard ]  [ Pillars ]  [ Configuration ]          ● Active  │
│──────────────────────────────────────────────────────────────────── │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │              (Mission Dashboard HTML)                        │  │
│  │                                                              │  │
│  │  Rendered iframe/shadow DOM of the agent-generated           │  │
│  │  mission.html dashboard showing aggregate state              │  │
│  │  of all pillars, metrics trends, recent activity.            │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│──────────────────────────────────────────────────────────────────── │
│  💬 Mission Chat                                          [▲ ▼]   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  You: Focus more on onboarding this sprint                  │  │
│  │  Lead: Understood. I'll reprioritize...                     │  │
│  │                                                              │  │
│  │  [Type a message to the Mission Lead...]           [Send]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

#### Sub-tabs:

**Dashboard:** The agent-generated HTML dashboard rendered inline. Shows aggregate health of all pillars.

**Pillars:** A card-based overview of all pillars in this mission:

```
┌────────────────────────────────────────────────────────────────────┐
│  Pillars (3)                                                       │
│                                                                    │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  Build Performance      🟡 │  │  Documentation Currency  🟢 │  │
│  │                            │  │                              │  │
│  │  Avg Build: 87s (→60s)    │  │  Stale APIs: 0              │  │
│  │  CI Time: 4m12s (→5m)     │  │  Doc Coverage: 94%          │  │
│  │  Cache Hit: 72% (→80%)    │  │  Freshness: 6 days avg      │  │
│  │                            │  │                              │  │
│  │  TODOs: 3 pending, 1 active│  │  TODOs: 1 pending           │  │
│  │                            │  │                              │  │
│  │  [View Pillar →]          │  │  [View Pillar →]            │  │
│  └─────────────────────────────┘  └─────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────┐                                   │
│  │  Onboarding Friction    🔴 │                                   │
│  │                            │                                   │
│  │  First PR: 5.2d (→3d)     │                                   │
│  │  Setup Success: 78% (→95%)│                                   │
│  │  Manual Steps: 4 (→0)     │                                   │
│  │                            │                                   │
│  │  TODOs: 5 pending, 2 active│                                   │
│  │  [View Pillar →]          │                                   │
│  └─────────────────────────────┘                                   │
└────────────────────────────────────────────────────────────────────┘
```

Health indicators: 🟢 all metrics on target, 🟡 some metrics off target, 🔴 most metrics off target.

**Configuration:** View/edit the mission's runtime configuration. Shows the JSON config in an editable JSON editor (reuse `EvalJsonEditor` pattern). Also shows the source `.md` file path and a link to edit it.

#### Embedded Chat

A collapsible panel pinned to the bottom of the main content area. Always visible but can be minimized to a single-line bar. Messages sent here go to the **Mission Lead agent** with full mission context injected. This is the human-in-the-loop channel for mission-level directives.

The chat reuses the existing `ChatInput` component and message rendering from the Chat tab, but scoped to the mission's `conversationId`.

### 5.5 Main Content — Pillar View

When a pillar is selected (from sidebar or from mission pillars tab), the main content transitions to the **pillar-level view**:

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Developer Experience / Build Performance                   🟡  │
│                                                                    │
│  [ Dashboard ]  [ Metrics ]  [ Strategy ]  [ TODOs ]              │
│──────────────────────────────────────────────────────────────────── │
│                                                                    │
│                   (Sub-tab content area)                           │
│                                                                    │
│──────────────────────────────────────────────────────────────────── │
│  💬 Pillar Chat                                           [▲ ▼]   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  [Type a message about Build Performance...]       [Send]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

#### Sub-tabs:

**Dashboard:** The agent-generated pillar-level HTML dashboard rendered inline.

**Metrics:** Detailed metrics table with history:

```
┌────────────────────────────────────────────────────────────────┐
│  Metric                 │ Current │ Target │ Trend  │ History  │
│─────────────────────────┼─────────┼────────┼────────┼──────────│
│  Avg Local Build Time   │   87s   │  <60s  │  ↗ imp │ ▃▄▅▅▄▃▂ │
│  CI Build Time          │  4m12s  │  <5m   │  → stb │ ▅▅▅▄▅▅▅ │
│  Cache Hit Rate         │   72%   │  >80%  │  ↗ imp │ ▂▃▃▄▅▅▆ │
└────────────────────────────────────────────────────────────────┘
```

Each metric row is expandable to show full history data points and a larger chart.

**Strategy:** List of active strategies for this pillar. Each strategy shows its description, status, and last-reviewed date. Strategies are infrequently changing — they inform TODO generation but aren't TODOs themselves.

```
┌────────────────────────────────────────────────────────────────┐
│  Strategies (3)                                    [+ Add]    │
│                                                                │
│  1. Profile build pipeline quarterly                           │
│     Status: Active  │  Last reviewed: Feb 10, 2026             │
│                                                                │
│  2. Evaluate new bundler releases                              │
│     Status: Active  │  Last reviewed: Feb 3, 2026              │
│                                                                │
│  3. Monitor cache invalidation patterns                        │
│     Status: Active  │  Last reviewed: Feb 8, 2026              │
└────────────────────────────────────────────────────────────────┘
```

**TODOs:** The dynamically populated task list. This is the primary work surface.

```
┌────────────────────────────────────────────────────────────────┐
│  TODO List                                         [+ Add]    │
│                                                                │
│  Filter: [All ▾]  Sort: [Priority ▾]                          │
│                                                                │
│  ▶ IN PROGRESS (1)                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🔵 Profile webpack build to identify slowest loaders    │  │
│  │     Priority: High  │  Agent: coder  │  Started: 2h ago  │  │
│  │     [View Execution →]                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ▶ PENDING (3)                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ⚪ Evaluate esbuild as webpack replacement              │  │
│  │     Priority: Medium  │  Unassigned                      │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  ⚪ Set up build time tracking in CI                     │  │
│  │     Priority: Medium  │  Unassigned                      │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  ⚪ Investigate persistent caching for node_modules      │  │
│  │     Priority: Low  │  Unassigned                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ▸ COMPLETED (7) — collapsed                                  │
│  ▸ BLOCKED (0)                                                │
└────────────────────────────────────────────────────────────────┘
```

### 5.6 Task Execution View

Clicking "View Execution" on a TODO drills into the **task execution view** — which is essentially a read-only (or interactive) chat conversation that serves as the agent's log/execution context.

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Build Performance / TODOs / Profile webpack build...           │
│                                                                    │
│  Status: In Progress  │  Agent: coder  │  Started: Feb 11, 14:32  │
│──────────────────────────────────────────────────────────────────── │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  [system] Task: Profile webpack build to identify slowest    │  │
│  │  loaders. Context: Build Performance pillar, target <60s...  │  │
│  │                                                              │  │
│  │  [assistant] I'll start by running webpack with the          │  │
│  │  --profile flag to generate a stats.json file...             │  │
│  │                                                              │  │
│  │  [tool_use] bash: webpack --profile --json > stats.json      │  │
│  │  [tool_result] Success. File generated (2.3MB)               │  │
│  │                                                              │  │
│  │  [assistant] The profile shows 3 loaders consuming 78%       │  │
│  │  of build time:                                              │  │
│  │  1. sass-loader: 34s (39%)                                   │  │
│  │  2. ts-loader: 22s (25%)                                     │  │
│  │  3. babel-loader: 12s (14%)                                  │  │
│  │                                                              │  │
│  │  I'll investigate sass-loader first...                       │  │
│  │                                                              │  │
│  │  [assistant→deep-research-team] Researching sass-loader      │  │
│  │  optimization techniques for large codebases...              │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  [Type a message to intervene in this task...]     [Send]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

The execution view reuses the existing message rendering components (`MessageContent`, `CodeBlock`, etc.) from the Chat tab. The conversation is a standard conversation in the database, linked to the TODO via `conversationId`.

**Key distinction:** The user can type into the chat input to **intervene** in an active task — providing guidance, answering questions the agent asks, or redirecting the work. For completed tasks, the chat becomes read-only historical log.

---

## 6. Routing

Following the established URL-driven pattern from Chat (`/chat/...`) and Eval (`/eval/...`):

| Route | View | Description |
|---|---|---|
| `/mission` | Mission List | Default — shows first mission or empty state |
| `/mission/:missionSlug` | Mission View (Dashboard) | Mission dashboard (default sub-tab) |
| `/mission/:missionSlug/pillars` | Mission View (Pillars) | Pillar cards overview |
| `/mission/:missionSlug/config` | Mission View (Config) | Mission configuration editor |
| `/mission/:missionSlug/pillar/:pillarSlug` | Pillar View (Dashboard) | Pillar dashboard (default sub-tab) |
| `/mission/:missionSlug/pillar/:pillarSlug/metrics` | Pillar View (Metrics) | Pillar metrics table |
| `/mission/:missionSlug/pillar/:pillarSlug/strategy` | Pillar View (Strategy) | Pillar strategies list |
| `/mission/:missionSlug/pillar/:pillarSlug/todos` | Pillar View (TODOs) | Pillar TODO list |
| `/mission/:missionSlug/pillar/:pillarSlug/todo/:todoId` | Task Execution | Single TODO execution view |

The `mode` derivation in `App.jsx` extends naturally:

```javascript
const MODES = {
  CHAT: 'chat',
  EVAL: 'eval',
  MISSION: 'mission',
};

const mode = location.pathname.startsWith('/mission')
  ? MODES.MISSION
  : location.pathname.startsWith('/eval')
    ? MODES.EVAL
    : MODES.CHAT;
```

---

## 7. Backend

### 7.1 Mission Manager

A new service analogous to `TaskManager`, located at `src/missions/manager.ts`.

**Responsibilities:**
- Watch `/user/missions/` for `.md` file changes (reuse `ConfigWatcher`)
- Bootstrap `.json` runtime configs from `.md` files (LLM parsing)
- Manage mission lifecycle (create, pause, resume, archive)
- Execute cadence cycles (cron-based, like task scheduler)
- Orchestrate Mission Lead agent execution
- Dispatch TODO items to worker agents
- Persist state changes to `.json` files and database

### 7.2 Database Schema

New tables/repositories:

```typescript
export interface Mission {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  mdFile: string;
  jsonConfig: Record<string, unknown>;  // full runtime config
  conversationId: string;               // mission-level chat
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pillar {
  id: string;
  missionId: string;
  slug: string;
  name: string;
  description: string;
  status: 'active' | 'paused';
  conversationId: string;               // pillar-level chat
  createdAt: string;
  updatedAt: string;
}

export interface PillarMetric {
  id: string;
  pillarId: string;
  name: string;
  target: string;
  current: string;
  unit: string;
  trend: 'improving' | 'stable' | 'degrading' | 'unknown';
  updatedAt: string;
}

export interface PillarMetricHistory {
  id: string;
  metricId: string;
  value: number;
  timestamp: string;
}

export interface PillarStrategy {
  id: string;
  pillarId: string;
  description: string;
  status: 'active' | 'retired';
  lastReviewedAt: string;
  createdAt: string;
}

export interface MissionTodo {
  id: string;
  pillarId: string;
  missionId: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedAgent: string | null;
  conversationId: string | null;         // execution log
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
```

### 7.3 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/missions` | List all missions |
| `GET` | `/api/missions/:slug` | Get mission detail (includes pillars summary) |
| `PUT` | `/api/missions/:slug` | Update mission config |
| `POST` | `/api/missions/:slug/pause` | Pause mission |
| `POST` | `/api/missions/:slug/resume` | Resume mission |
| `POST` | `/api/missions/:slug/cycle` | Manually trigger a cadence cycle |
| `GET` | `/api/missions/:slug/pillars` | List pillars for a mission |
| `GET` | `/api/missions/:slug/pillars/:pillarSlug` | Get pillar detail |
| `GET` | `/api/missions/:slug/pillars/:pillarSlug/metrics` | Get pillar metrics with history |
| `GET` | `/api/missions/:slug/pillars/:pillarSlug/strategies` | Get pillar strategies |
| `GET` | `/api/missions/:slug/pillars/:pillarSlug/todos` | Get pillar TODOs |
| `POST` | `/api/missions/:slug/pillars/:pillarSlug/todos` | Create a TODO (manual) |
| `PUT` | `/api/missions/:slug/pillars/:pillarSlug/todos/:todoId` | Update a TODO |
| `GET` | `/api/missions/:slug/dashboard` | Serve mission dashboard HTML |
| `GET` | `/api/missions/:slug/pillars/:pillarSlug/dashboard` | Serve pillar dashboard HTML |

### 7.4 WebSocket Events

Extend the existing WebSocket protocol with mission events:

| Event | Direction | Payload |
|---|---|---|
| `mission:updated` | server → client | `{ missionSlug, field, value }` |
| `mission:cycle:start` | server → client | `{ missionSlug, timestamp }` |
| `mission:cycle:end` | server → client | `{ missionSlug, timestamp, summary }` |
| `pillar:metric:updated` | server → client | `{ missionSlug, pillarSlug, metricId, value }` |
| `todo:created` | server → client | `{ missionSlug, pillarSlug, todo }` |
| `todo:updated` | server → client | `{ missionSlug, pillarSlug, todoId, updates }` |
| `todo:assigned` | server → client | `{ missionSlug, pillarSlug, todoId, agentType }` |
| `dashboard:regenerated` | server → client | `{ missionSlug, pillarSlug?, version }` |

---

## 8. File System Layout

```
/user/missions/
├── developer-experience.md              # authored mission definition
├── developer-experience.json            # bootstrapped runtime config
├── community-growth.md
├── community-growth.json
├── prompts/
│   ├── developer-experience-lead.md     # mission lead system prompt
│   └── community-growth-lead.md
└── dashboards/
    ├── developer-experience/
    │   ├── mission.html                 # mission-level dashboard
    │   ├── build-performance.html       # pillar dashboard
    │   ├── documentation-currency.html
    │   └── onboarding-friction.html
    └── community-growth/
        ├── mission.html
        └── ...
```

---

## 9. Component Mapping

### New Frontend Components

| Component | Location | Description |
|---|---|---|
| `MissionSidebar` | `web/src/components/mission/MissionSidebar.jsx` | Mission list + pillar nav in sidebar |
| `MissionView` | `web/src/components/mission/MissionView.jsx` | Mission-level main content with sub-tabs |
| `MissionDashboard` | `web/src/components/mission/MissionDashboard.jsx` | Renders agent-generated HTML dashboard |
| `MissionPillars` | `web/src/components/mission/MissionPillars.jsx` | Pillar cards overview |
| `MissionConfig` | `web/src/components/mission/MissionConfig.jsx` | JSON config editor (reuse EvalJsonEditor) |
| `PillarView` | `web/src/components/mission/PillarView.jsx` | Pillar-level main content with sub-tabs |
| `PillarDashboard` | `web/src/components/mission/PillarDashboard.jsx` | Renders pillar HTML dashboard |
| `PillarMetrics` | `web/src/components/mission/PillarMetrics.jsx` | Metrics table with sparklines |
| `PillarStrategy` | `web/src/components/mission/PillarStrategy.jsx` | Strategy list |
| `PillarTodos` | `web/src/components/mission/PillarTodos.jsx` | TODO list with filters and grouping |
| `TodoExecution` | `web/src/components/mission/TodoExecution.jsx` | Task execution conversation view |
| `MissionChat` | `web/src/components/mission/MissionChat.jsx` | Embedded chat panel (reuses ChatInput) |
| `App.Mission.jsx` | `web/src/App.Mission.jsx` | Mission mode routing/state (mirrors App.Eval.jsx) |

### New Backend Modules

| Module | Location | Description |
|---|---|---|
| `MissionManager` | `src/missions/manager.ts` | Core mission lifecycle and orchestration |
| `MissionScheduler` | `src/missions/scheduler.ts` | Cadence cycle scheduling |
| `MissionOrchestrator` | `src/missions/orchestrator.ts` | Agent dispatch and coordination |
| `mission-routes` | `src/server/mission-routes.ts` | Express route handlers |
| DB repositories | `src/db/index.ts` | New Mission, Pillar, Metric, Todo tables |

---

## 10. State Flow Summary

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│                  │     │                  │     │                  │
│   .md file       │────▶│   .json config   │────▶│   Database       │
│   (authored)     │     │   (bootstrapped) │     │   (runtime)      │
│                  │  LLM│                  │     │                  │
└──────────────────┘parse└──────────────────┘     └────────┬─────────┘
                                                           │
                              ┌─────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │                  │
                    │  Mission Manager │
                    │  (orchestrator)  │
                    │                  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ Mission    │  │  Worker    │  │  Worker    │
    │ Lead Agent │  │  Agent 1   │  │  Agent N   │
    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
          │               │               │
          │    ┌──────────┴───────────────┘
          │    │
          ▼    ▼
    ┌──────────────────┐     ┌──────────────────┐
    │  WebSocket        │────▶│  React Frontend  │
    │  (real-time)     │     │  (Mission Tab)   │
    └──────────────────┘     └──────────────────┘
```

---

## 11. Relationship to Level 4 Subsystems

This design maps to the Level 4 subsystems from `agentic-levels.md`:

| Level 4 Subsystem | Mission Tab Implementation |
|---|---|
| **Environment Sensing & World Model** | Mission Lead's cadence cycle: reads metrics, runs diagnostics, assesses current state. Pillar metrics serve as the quantified world model. |
| **Strategy & Resource Allocation** | Pillar strategies inform TODO generation. Mission Lead prioritizes across pillars. Worker allocation is the resource management layer. |
| **Learning & Institutional Memory** | TODO outcomes accumulate institutional knowledge. Metric history tracks impact of past actions. Strategy reviews incorporate lessons learned. |
| **Self-Modification Engine** | Future: Mission Lead could propose strategy changes, adjust cadence, or modify its own system prompt based on observed effectiveness. (Not in initial PoC scope.) |

### PoC Scope Boundaries

This initial proof of concept **includes:**
- Mission authoring and bootstrap (`.md` → `.json`)
- Full UX for mission/pillar/TODO navigation
- Mission Lead agent with cadence cycles
- Worker agent dispatch for TODO execution
- Dashboard generation (HTML)
- Human-in-the-loop chat at mission and pillar levels
- Metric tracking and trend visualization

This initial proof of concept **defers:**
- Self-Modification Engine (Level 4's most speculative subsystem)
- Cross-mission learning (each mission is independent)
- Advanced resource management (no budget/cost tracking across workers)
- Formal adversarial review of mission outputs (Level 2 pattern)

---

## 12. Open Questions

1. **Dashboard refresh UX:** Should dashboards auto-refresh on WebSocket `dashboard:regenerated` events, or require manual refresh? Auto-refresh could be disorienting if the user is reading.

2. **Pillar-level chat scope:** Should pillar chat messages be visible to the Mission Lead, or are they isolated to pillar context only? Leaning toward visible — the Mission Lead should have full picture.

3. **TODO concurrency:** How many TODOs can be in-progress simultaneously across a mission? Should this be configurable per-mission? Per-pillar?

4. **Conversation reuse:** Should the mission-level chat be a single long-running conversation, or start fresh each cadence cycle? Long-running preserves context but grows large.

5. **Manual TODO creation:** Should users be able to manually add TODOs, or should all TODOs be agent-generated? Design above includes manual creation — validate this is desired.

6. **Cross-pillar TODOs:** Can a TODO span multiple pillars? Current design assumes 1:1 pillar-to-TODO mapping. Cross-pillar work could be modeled as separate but linked TODOs.
