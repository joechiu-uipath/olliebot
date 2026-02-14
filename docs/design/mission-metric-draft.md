# Mission Metrics — Design Draft

> **Status:** Draft — Feb 2026
>
> **Depends on:** Mission system (implemented), pillar_metrics table (implemented),
> tool system (implemented), MissionLeadAgent (implemented)

---

## 1. Problem Statement

Missions define **success metrics** per pillar, but the current schema is too loose to
be machine-actionable:

```json
{ "name": "CI build time", "target": "< 5", "current": "", "unit": "min" }
```

This has three problems:
1. **Target is a free-text string** — the agent can't compute "are we on target?"
2. **No metric type** — percentage, count, duration, and pass/fail require different
   comparison logic, visualization, and trend calculation
3. **No collection mechanism** — metrics are manually set. There's no instruction for
   *how* to collect them, *which tool* to call, or *how often* to refresh

This design proposes a flexible metric schema with typed targets, well-known metric
archetypes, and a tool-based collection model that agents can execute autonomously.

---

## 2. Metric Type System

### 2.1 Core Metric Types

| Type | Value Domain | Example | Comparison |
|------|-------------|---------|------------|
| `numeric` | Any number (integer or float) | Build time: 42s | `<`, `>`, `<=`, `>=`, `=` |
| `percentage` | 0–100 (or 0–1 normalized) | Cache hit rate: 82% | Same as numeric, UI shows `%` |
| `count` | Non-negative integer | Open bugs: 7 | Same as numeric |
| `duration` | **Always stored as seconds** (display layer converts to human-friendly units) | P95 latency: 0.230s | Same as numeric |
| `boolean` | `true` / `false` | CI pipeline green: true | `= true` (pass) or `= false` (fail) |
| `rating` | 1–N point scale (configurable, decimal values allowed e.g. 4.5) | Code quality: 4.5/5 | `>=` threshold |

All types are stored as `REAL` in `pillar_metric_history.value`:
- `boolean`: stored as `1.0` (true) or `0.0` (false)
- `duration`: **always stored in seconds** — the `mission_metric_record` tool normalizes
  before writing (e.g., 5 min → 300s). Values are rounded to 2 decimal places.
- `rating`: stored as the numeric rating value (supports decimals, e.g. 4.5 stars)

### 2.2 Target Specification

Replace the free-text `target` with a structured object:

```typescript
interface MetricTarget {
  operator: '<' | '<=' | '>' | '>=' | '=' | '!=';
  value: number;
  /** Optional: "danger zone" threshold that triggers escalation */
  warningThreshold?: number;
  /** Optional: direction for trend analysis */
  desiredDirection?: 'up' | 'down' | 'stable';
}
```

**Examples:**

| Metric | Target |
|--------|--------|
| Build time < 60s | `{ "operator": "<", "value": 60, "warningThreshold": 90, "desiredDirection": "down" }` |
| Cache hit > 80% | `{ "operator": ">", "value": 80, "warningThreshold": 60, "desiredDirection": "up" }` |
| Zero stale APIs | `{ "operator": "=", "value": 0, "desiredDirection": "down" }` |
| CI green | `{ "operator": "=", "value": 1 }` (boolean = 1.0 for true) |
| CSAT >= 4.5 (rating) | `{ "operator": ">=", "value": 4.5, "warningThreshold": 3.5, "desiredDirection": "up" }` |
| NPS > 40 (numeric) | `{ "operator": ">", "value": 40, "warningThreshold": 20, "desiredDirection": "up" }` |

### 2.3 Metric Status (Computed)

Given `current`, `target`, and `warningThreshold`, compute:

| Status | Condition |
|--------|-----------|
| `on_target` | Current satisfies target operator+value |
| `warning` | Current fails target but is better than warningThreshold |
| `off_target` | Current fails target and is worse than warningThreshold (or no warning threshold) |
| `unknown` | No current value collected yet |

This replaces the manual `trend` field with a computable status. The `trend` field
(improving/stable/degrading) is computed from the **last 10 data points** in
`pillar_metric_history` (N = 10).

---

## 3. Metric Schema in mission.json

### 3.1 Per-Pillar Metric Definition

```json
{
  "pillars": [
    {
      "name": "Build Performance",
      "slug": "build-performance",
      "metrics": [
        {
          "slug": "local-build-time",
          "name": "Average local build time",
          "type": "duration",
          "unit": "s",
          "target": {
            "operator": "<",
            "value": 60,
            "warningThreshold": 90,
            "desiredDirection": "down"
          },
          "collection": {
            "method": "tool",
            "toolName": "user.measure_build_time",
            "toolParams": { "buildType": "dev", "iterations": 3 },
            "collectionSchedule": "0 */4 * * *",
            "instructions": "Run 3 local dev builds and report the average wall-clock time in seconds. Exclude the first run (cold cache)."
          }
        },
        {
          "slug": "cache-hit-rate",
          "name": "Cache hit rate",
          "type": "percentage",
          "unit": "%",
          "target": {
            "operator": ">",
            "value": 80,
            "warningThreshold": 60,
            "desiredDirection": "up"
          },
          "collection": {
            "method": "tool",
            "toolName": "mcp.ci__get_cache_stats",
            "toolParams": { "pipeline": "main", "window": "24h" },
            "collectionSchedule": "0 8 * * *",
            "instructions": "Fetch cache statistics from the CI system for the main pipeline over the last 24 hours. Report as percentage (hits / total * 100)."
          }
        }
      ]
    }
  ]
}
```

### 3.2 Collection Definition

```typescript
interface MetricCollection {
  /** How to collect this metric */
  method: 'tool' | 'derived';

  // --- For method: 'tool' ---
  /** Tool identifier: 'native_tool_name', 'user.tool_name', or 'mcp.server__tool_name' */
  toolName?: string;
  /** Parameters to pass to the tool */
  toolParams?: Record<string, unknown>;
  /** Cron expression for automated collection (uses mission cadence if omitted).
   *  Each metric can have its own schedule, allowing high-frequency metrics
   *  (e.g., build time every 4h) and low-frequency metrics (e.g., NPS weekly). */
  collectionSchedule?: string;
  /** Natural-language instructions for the collecting agent on how to interpret the
   *  tool result and extract the metric value */
  instructions?: string;

  // --- For method: 'derived' (DEFERRED — not implemented in v1) ---
  /** Formula referencing other metric slugs: "metric_a / metric_b * 100" */
  formula?: string;
  /** Slugs of metrics this depends on (auto-recalculate when inputs change) */
  dependsOn?: string[];
}
```

**Collection methods:**

| Method | Use Case | v1? | Example |
|--------|----------|-----|---------|
| `tool` | Automated collection via native, user, or MCP tool | Yes | CI build time via `mcp.ci__get_build_stats`, NPS via `mcp.survey__get_results` |
| `derived` | Calculated from other metrics | **No — deferred** | "Productivity = features_shipped / engineer_count" |

> **v1 scope:** Only `tool`-based (measured) metrics are supported in the initial
> implementation. Derived metrics require dependency resolution (DAG validation,
> circular reference detection) and will be added in a follow-up phase.
>
> **Why no `manual` method?** Manual collection requires human input which doesn't scale.
> Metrics that seem inherently human-entered (NPS, CSAT, eNPS) should be collected via
> tool integrations — survey platforms (Delighted, Typeform, Google Forms), helpdesk APIs,
> or internal feedback tools all expose APIs that agents can call autonomously.

### 3.3 Where Collection Instructions Live

Collection instructions live in the **mission.json** (not mission.md), because:
1. They're machine-readable configuration, not human narrative
2. The LLM already parses mission.md → mission.json; instructions can be authored in
   either format and the parser will extract them
3. The mission.json is the single source of truth for the runtime system

For human authoring, the mission.md can include collection instructions in natural language
under each metric, and the LLM parser extracts them into the structured JSON format.

---

## 4. Collection Architecture

### 4.1 Metric Collection Chat

Metric collection is an agentic process — it requires LLM calls to interpret tool
output, handle failures, and record results. A chat is the natural execution context
for multi-turn agent work and provides built-in record-keeping (every tool call,
result, and decision is captured in the conversation history).

To avoid chat explosion, each mission gets a single **utility metric collection chat**
with a **well-known (non-GUID) conversation ID** based on the mission slug:

```
Mission slug: "developer-experience"
  └── Conversation ID: "developer-experience-metric"
      Title: "[Metric Collection] Developer Experience"
        ├── Turn 1: collect build-performance/local-build-time
        ├── Turn 2: collect build-performance/ci-build-time
        ├── Turn 3: collect build-performance/cache-hit-rate
        ├── Turn 4: collect onboarding/time-to-first-pr
        ├── ...
        └── Turn N: collect last metric
```

**Well-known conversation ID pattern:**
- Metric collection: `{missionSlug}-metric` (e.g., `"developer-experience-metric"`)
- Pillar TODO execution: `{missionSlug}-{pillarSlug}-todo` (e.g., `"developer-experience-build-performance-todo"`)
- These are **not GUIDs** — they are predictable, human-readable, and can be
  constructed from slugs without a DB lookup.
- Created during `syncPillars()` alongside existing mission/pillar conversations.

**Key design decisions:**

- **One chat per mission** — all pillars and all metrics share a single metric
  collection chat. This keeps the chat count bounded (1 per mission, not 1 per
  pillar or 1 per metric).
- **All pillars collected in the same chat** — the Mission Lead iterates through
  every pillar's metrics within the same conversation, delegating each to the
  appropriate Pillar Owner worker.
- **Stateless per-turn execution** — following the feed channel pattern, each
  metric collection turn does NOT use chat history context. The collection prompt
  includes all needed context (metric definition, tool config, instructions).
  This avoids unbounded context growth in the collection chat.
- **One worker per metric** — each metric collection spawns a single worker turn.
  The worker calls the tool, interprets the result, and records via
  `mission_metric_record`. One metric = one turn = one worker.

### 4.2 Collection Execution Model

Each tool-based metric is collected by **spawning one worker per metric** in the
metric collection chat. Each turn is **stateless** — no chat history context is used
(following the feed channel pattern).

```
Cadence trigger (cron or per-metric collectionSchedule)
  │
  ▼
Metric collection chat receives collection prompt
  │
  ├── For each pillar:
  │     └── For each metric with collection.method === 'tool':
  │           │
  │           │  ┌─────────────────────────────────────────────┐
  │           └──│  One worker, one turn (stateless):          │
  │              │  1. Spawn a worker for this single metric    │
  │              │  2. Worker receives metric definition, tool  │
  │              │     config, and instructions (full context   │
  │              │     in prompt — no chat history needed)       │
  │              │  3. Worker calls the collection tool          │
  │              │  4. Worker calls mission_metric_record        │
  │              │     → value normalized, status/trend computed │
  │              └─────────────────────────────────────────────┘
  │
  └── Agent generates status summary (on_target / warning / off_target per metric)
```

> **Note:** Derived metrics are deferred to v2. Only `tool`-based collection is
> implemented in the initial version.

### 4.3 Agent-Based Collection (Why Agents, Not Cron Jobs)

The collecting entity is an **agent** (Mission Lead delegating to Pillar Owner),
not a background job. The chat-based execution model is intentional:

1. **Agents can interpret ambiguous results** — tool output may need parsing, filtering, or judgment
2. **Agents can handle failures** — if a tool fails, the agent can retry, try alternatives, or escalate
3. **Agents can restrict tool access** — the Pillar Owner template already limits which tools it can use
4. **Instructions are natural language** — the `collection.instructions` field tells the agent *how* to interpret results, which no cron job can do
5. **Collection triggers analysis** — after collecting, the agent can immediately identify regressions and create TODOs
6. **Chat provides record-keeping** — every collection attempt, tool call, result, and agent decision is preserved in conversation history for auditability

### 4.4 New Tool: `mission_metric_record`

A native tool that persists a metric reading:

```typescript
// Tool: mission_metric_record
{
  metricId: string,         // GUID of the metric (no slug — only missions/pillars have slugs)
  value: number,            // the collected value (raw — normalization is automatic)
  note?: string,            // optional context ("collected after webpack 5.9 upgrade")
}
```

The tool:
1. Resolves metric by GUID ID
2. **Normalizes value** — for `duration` type metrics, converts to seconds
   (e.g., if unit is "min", multiplies by 60). Rounds the value before writing
   to avoid floating-point noise (e.g., `50.3712...` → `50.37`)
3. Updates `pillar_metrics.current` with the normalized value
4. Inserts a row into `pillar_metric_history`
5. Computes `status` (on_target / warning / off_target) from current vs target
6. Computes `trend` from last **10** readings in history
7. Returns the computed status and trend to the agent

---

## 5. Top 50 Common Metrics (Schema Validation)

Below are 50 metrics across business, technical, and operational domains, categorized
to validate the schema covers all common patterns.

### 5.1 Business / Product Metrics

| # | Metric | Type | Unit | Target Example | Collection |
|---|--------|------|------|----------------|------------|
| 1 | Net Promoter Score (NPS) | `numeric` | score | `> 40` | tool (survey platform API) |
| 2 | Monthly Active Users (MAU) | `count` | users | `> 10000` | tool (analytics API) |
| 3 | Daily Active Users (DAU) | `count` | users | `> 3000` | tool (analytics API) |
| 4 | DAU/MAU Ratio (Stickiness) | `percentage` | % | `> 30` | derived (DAU/MAU*100) |
| 5 | Customer Churn Rate | `percentage` | %/month | `< 5` | tool (billing API) |
| 6 | Monthly Recurring Revenue (MRR) | `numeric` | USD | `> 50000` | tool (billing API) |
| 7 | Customer Acquisition Cost (CAC) | `numeric` | USD | `< 200` | derived (spend/new_customers) |
| 8 | Customer Lifetime Value (LTV) | `numeric` | USD | `> 1000` | derived |
| 9 | LTV:CAC Ratio | `numeric` | ratio | `> 3` | derived (LTV/CAC) |
| 10 | Trial-to-Paid Conversion Rate | `percentage` | % | `> 15` | tool (billing API) |
| 11 | Feature Adoption Rate | `percentage` | % | `> 40` | tool (analytics API) |
| 12 | Time to Value (TTV) | `duration` | days | `< 7` | tool (event tracking) |
| 13 | Customer Satisfaction (CSAT) | `rating` | 1-5 | `>= 4.5` | tool (survey platform API) |
| 14 | Support Ticket Volume | `count` | tickets/week | `< 50` | tool (helpdesk API) |
| 15 | Support Resolution Time | `duration` | hours | `< 24` | tool (helpdesk API) |

### 5.2 Software Engineering Metrics

| # | Metric | Type | Unit | Target Example | Collection |
|---|--------|------|------|----------------|------------|
| 16 | Deployment Frequency | `count` | deploys/week | `> 5` | tool (CI/CD API) |
| 17 | Lead Time for Changes | `duration` | hours | `< 48` | tool (git + CI API) |
| 18 | Change Failure Rate | `percentage` | % | `< 15` | tool (incident tracking) |
| 19 | Mean Time to Recovery (MTTR) | `duration` | minutes | `< 60` | tool (incident tracking) |
| 20 | Code Coverage | `percentage` | % | `> 80` | tool (CI test reports) |
| 21 | Build Time (local) | `duration` | seconds | `< 60` | tool (build profiler) |
| 22 | Build Time (CI) | `duration` | minutes | `< 5` | tool (CI API) |
| 23 | Cache Hit Rate | `percentage` | % | `> 80` | tool (CI cache stats) |
| 24 | Test Pass Rate | `percentage` | % | `> 99` | tool (CI test reports) |
| 25 | Flaky Test Count | `count` | tests | `= 0` | tool (CI flaky test detector) |
| 26 | Open Bug Count | `count` | bugs | `< 20` | tool (issue tracker API) |
| 27 | Bug Fix Time (median) | `duration` | days | `< 5` | tool (issue tracker API) |
| 28 | PR Review Time (median) | `duration` | hours | `< 8` | tool (git API) |
| 29 | PR Merge Time (median) | `duration` | hours | `< 24` | tool (git API) |
| 30 | Dependency Freshness | `percentage` | % up-to-date | `> 90` | tool (npm outdated / renovate) |
| 31 | Security Vulnerabilities (critical) | `count` | vulns | `= 0` | tool (SAST/DAST scanner) |
| 32 | Technical Debt Score | `numeric` | score | `< 50` | tool (SonarQube API) |
| 33 | API Latency (P95) | `duration` | ms | `< 200` | tool (APM / monitoring API) |
| 34 | API Error Rate | `percentage` | % | `< 1` | tool (APM / monitoring API) |
| 35 | Uptime | `percentage` | % | `> 99.9` | tool (monitoring API) |

### 5.3 Operational / Team Metrics

| # | Metric | Type | Unit | Target Example | Collection |
|---|--------|------|------|----------------|------------|
| 36 | Sprint Velocity | `numeric` | story points | `>= 40` | tool (project mgmt API) |
| 37 | Sprint Burndown Accuracy | `percentage` | % | `> 85` | tool (project mgmt API) |
| 38 | Cycle Time | `duration` | days | `< 5` | tool (project mgmt API) |
| 39 | WIP Items | `count` | items | `< 8` | tool (kanban board API) |
| 40 | Escaped Defects | `count` | bugs/sprint | `< 2` | tool (issue tracker) |
| 41 | On-call Incident Rate | `count` | incidents/week | `< 3` | tool (PagerDuty API) |
| 42 | On-call Escalation Rate | `percentage` | % | `< 10` | tool (PagerDuty API) |
| 43 | Time to First PR (onboarding) | `duration` | days | `< 3` | tool (git API) |
| 44 | Setup Script Success Rate | `percentage` | % | `> 95` | tool (CI / telemetry) |
| 45 | Documentation Coverage | `percentage` | % | `> 90` | tool (doc scanner) |
| 46 | Team eNPS | `numeric` | score | `> 30` | tool (HR/survey platform API) |
| 47 | Meeting Load | `duration` | hours/week | `< 10` | tool (calendar API) |
| 48 | Deploy Rollback Rate | `percentage` | % | `< 5` | tool (CI/CD API) |
| 49 | Infrastructure Cost per User | `numeric` | USD/user | `< 2` | derived (infra_cost/MAU) |
| 50 | Runbook Coverage | `percentage` | % | `> 80` | tool (wiki / doc scanner) |

### 5.4 Schema Validation Summary

All 50 metrics fit cleanly into the 6 metric types:

| Type | Count | Examples |
|------|-------|---------|
| `numeric` | 11 | MRR, CAC, LTV, NPS, eNPS, velocity, tech debt score, infra cost |
| `percentage` | 20 | Churn, coverage, cache hit, uptime, conversion |
| `count` | 11 | MAU, DAU, bugs, vulnerabilities, incidents |
| `duration` | 14 | Build time, MTTR, lead time, cycle time, PR review time |
| `boolean` | 0 | (Useful for: CI green, feature flag on, compliance check) |
| `rating` | 1 | CSAT (1-5 scale) |

Collection method breakdown:
- `tool`: 45 metrics (90%) — automated via native, user, or MCP tools
- `derived`: 5 metrics (10%) — computed from other metrics

---

## 6. Database Schema Changes

### 6.1 Updated `pillar_metrics` Table

```sql
CREATE TABLE IF NOT EXISTS pillar_metrics (
  id TEXT PRIMARY KEY,
  pillarId TEXT NOT NULL REFERENCES pillars(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,                    -- NEW: URL-safe identifier
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'numeric'   -- NEW: metric type enum
    CHECK(type IN ('numeric', 'percentage', 'count', 'duration', 'boolean', 'rating')),
  unit TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '{}',     -- CHANGED: JSON object (MetricTarget)
  current REAL,                          -- CHANGED: numeric (was string)
  status TEXT DEFAULT 'unknown'          -- NEW: computed on_target/warning/off_target/unknown
    CHECK(status IN ('on_target', 'warning', 'off_target', 'unknown')),
  trend TEXT NOT NULL DEFAULT 'unknown'
    CHECK(trend IN ('improving', 'stable', 'degrading', 'unknown')),
  collection TEXT DEFAULT '{}',          -- NEW: JSON object (MetricCollection)
  lastCollectedAt TEXT,                  -- NEW: timestamp of last collection
  updatedAt TEXT NOT NULL,
  UNIQUE(pillarId, slug)
);
```

### 6.1b Updated `pillar_metric_history` Table

```sql
CREATE TABLE IF NOT EXISTS pillar_metric_history (
  id TEXT PRIMARY KEY,
  metricId TEXT NOT NULL REFERENCES pillar_metrics(id) ON DELETE CASCADE,
  value REAL NOT NULL,                   -- normalized (durations in seconds, rounded)
  note TEXT,                             -- NEW: optional context for the reading
  timestamp TEXT NOT NULL
);
```

### 6.2 Migration Strategy

Since this is pre-production, we can alter the table directly. For existing rows:
- `target`: Parse string like `"< 60"` → `{"operator": "<", "value": 60}`
- `current`: Parse string like `"42"` → `42.0` (numeric)
- `type`: Infer from unit — `%` → percentage, `s`/`min` → duration, else numeric
- `slug`: Generate from name via slugify
- `status`: Compute from current vs. target
- `collection`: Default to `{"method": "tool"}` (toolName and instructions must be configured)

---

## 7. Detailed Example: Developer Experience Mission

### 7.1 Build Performance Pillar — Full Metric Config

```json
{
  "slug": "build-performance",
  "name": "Build Performance",
  "metrics": [
    {
      "slug": "local-build-time",
      "name": "Average local dev build time",
      "type": "duration",
      "unit": "s",
      "target": {
        "operator": "<",
        "value": 60,
        "warningThreshold": 90,
        "desiredDirection": "down"
      },
      "collection": {
        "method": "tool",
        "toolName": "user.measure_build_time",
        "toolParams": {
          "command": "npm run build:dev",
          "iterations": 3,
          "warmup": 1
        },
        "collectionSchedule": "0 */4 * * *",
        "instructions": "Run the dev build command 3 times (after 1 warmup run). Report the average wall-clock time in seconds. If the command fails, report the failure instead of a metric value."
      }
    },
    {
      "slug": "ci-build-time",
      "name": "CI pipeline build time (P50)",
      "type": "duration",
      "unit": "min",
      "target": {
        "operator": "<",
        "value": 5,
        "warningThreshold": 8,
        "desiredDirection": "down"
      },
      "collection": {
        "method": "tool",
        "toolName": "mcp.github__get_workflow_runs",
        "toolParams": {
          "workflow": "ci.yml",
          "branch": "main",
          "limit": 20
        },
        "collectionSchedule": "0 8 * * *",
        "instructions": "Fetch the last 20 successful CI runs on main. Calculate the P50 (median) duration in minutes. Exclude cancelled or failed runs."
      }
    },
    {
      "slug": "cache-hit-rate",
      "name": "Build cache hit rate",
      "type": "percentage",
      "unit": "%",
      "target": {
        "operator": ">",
        "value": 80,
        "warningThreshold": 60,
        "desiredDirection": "up"
      },
      "collection": {
        "method": "tool",
        "toolName": "mcp.turborepo__cache_stats",
        "toolParams": { "window": "24h" },
        "collectionSchedule": "0 8 * * *",
        "instructions": "Fetch Turborepo cache statistics for the last 24 hours. Calculate hit rate as: (cache_hits / (cache_hits + cache_misses)) * 100. Report as a percentage."
      }
    }
  ]
}
```

### 7.2 Collection Flow Example: Local Build Time

All collection happens in the mission's dedicated metric collection chat:

```
Chat: "[Metric Collection] Developer Experience"
  │
  │ ── Cadence trigger fires (every 4 hours) ──
  │
  │ Turn N: collect build-performance/local-build-time
  │
  │  1. Mission Lead delegates to Pillar Owner worker for "build-performance",
  │     passing metric instructions and tool config for "local-build-time"
  │  2. Pillar Owner calls user.measure_build_time:
  │       { "command": "npm run build:dev", "iterations": 3, "warmup": 1 }
  │  3. Tool returns: { "results": [52.3, 48.7, 50.1], "average": 50.37 }
  │  4. Pillar Owner calls mission_metric_record:
  │       { metricId: "a1b2c3d4-...", value: 50.37,
  │         note: "3 runs after warmup" }
  │  5. Tool persists value, computes status:
  │       → current: 50.37, target: < 60 → status: on_target
  │       → previous: [55, 53, 50.37] → trend: improving
  │  6. Returns: { status: "on_target", trend: "improving", message: "50.4s (target: < 60s)" }
  │
  │ Turn N+1: collect build-performance/ci-build-time
  │  ...
  │
  │ Turn N+2: collect build-performance/cache-hit-rate
  │  ...
  │
  └── Mission Lead generates status summary across all pillars
```

### 7.3 Sample User Tool Definition (`user/tools/measure-build-time.md`)

```markdown
# Measure Build Time

Run a build command multiple times and report the average duration.

## Parameters
- command (string, required): The build command to run
- iterations (number, default: 3): Number of timed runs
- warmup (number, default: 0): Number of warmup runs to discard

## Execution
1. If warmup > 0, run the command `warmup` times without timing
2. Run the command `iterations` times, timing each run
3. Report: individual times, average, min, max

## Output Format
{ "results": [seconds...], "average": number, "min": number, "max": number }
```

---

## 8. Open Questions

1. **Metric history retention** — How long to keep history? 90 days? Configurable?
   Currently `pillar_metric_history` has no TTL.

2. **Alerting / escalation** — When a metric goes `off_target`, should the agent
   automatically create a TODO? Or just flag it in the status summary?

3. ~~**Derived metric dependencies**~~ — **Deferred to v2.** Only measured (tool-based)
   metrics in v1.

4. **Collection failure handling** — If a tool call fails 3 times in a row, should
   the metric status change to a new `collection_error` state?

5. **Multi-environment metrics** — Some metrics (build time) differ by
   environment (local vs. CI). Should we support metric variants per environment?

---

## 9. Implementation Priority

| Phase | Description | Effort |
|-------|-------------|--------|
| **Phase 1** | Extend `pillar_metrics` schema with `type`, `slug`, structured `target`, numeric `current`, `status`, `collection` JSON | M |
| **Phase 2** | Create `mission_metric_record` native tool | S |
| **Phase 3** | Update mission.json parser to extract collection config | M |
| **Phase 4** | Implement status computation (on_target/warning/off_target) and trend computation from history | M |
| **Phase 5** | Wire cadence-triggered metric collection into MissionLeadAgent cycle prompt (feed channel pattern, stateless per-turn, one worker per metric) | L |
| **Phase 6** | ~~Implement derived metrics~~ — **Deferred to v2** | — |
| **Phase 7** | Dashboard integration — metric charts, sparklines, status badges | L |
