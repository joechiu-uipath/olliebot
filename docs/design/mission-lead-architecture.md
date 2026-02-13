# Mission Lead Agent Architecture

## Problem Statement

When users chat in the Mission tab's embedded chat, the experience should feel like a
**direct conversation with the Mission Lead agent** — not a message routed through the
generic Supervisor. The Supervisor is appropriate for the main Chat tab where user intent
is unknown and delegation makes sense, but the Mission tab is a high-context environment.
The user opened it deliberately, the chat is embedded directly in the mission view, and
every message is scoped to a specific mission or pillar `conversationId`.

This document evaluates four technical designs for achieving this, considering:
- User experience (directness, identity, latency)
- LLM token efficiency (calls per interaction, system prompt overhead, cost)
- Code complexity and maintainability
- Data model impact
- Future flexibility

---

## Evaluation Criteria

### LLM Token Efficiency (New)

Every LLM call incurs:
- **Input tokens**: system prompt + conversation history + tool definitions
- **Output tokens**: the model's response
- **Latency**: network round-trip + model inference time (proportional to input size)
- **Cost**: directly proportional to token count (input tokens are ~3-10x cheaper than
  output but dominate in volume due to system prompts)

Key cost drivers per interaction:
| Component | Typical Size | Notes |
|---|---|---|
| Supervisor system prompt | ~2,000 tokens | Base + delegation + browser sections |
| Mission Lead system prompt | ~3,000-5,000 tokens | Base + mission context (pillars, metrics, todos) |
| Conversation history | ~500-5,000 tokens | Grows with conversation length |
| Tool definitions | ~1,000-3,000 tokens | Depends on available tools |
| **Total input per call** | **~4,000-15,000 tokens** | |

A design that requires **two LLM calls** (Supervisor decides, then Worker executes)
effectively doubles the input token cost. For a trivial message like "What's the status
of the onboarding pillar?", this means paying for both the Supervisor's full system prompt
AND the Worker's full system prompt — ~8,000-30,000 input tokens vs ~4,000-15,000 for a
single-call design. Over many interactions, this adds up significantly.

---

## Option A: Single Supervisor, Auto-Delegation to Worker

### How It Works
User message arrives at the existing Supervisor. The Supervisor's LLM decides to delegate
to a "mission-lead" specialist worker, which then processes the mission-scoped message.

```
User → WebSocket → Supervisor (LLM call #1: routing decision)
                        ↓
              mission-lead Worker (LLM call #2: actual response)
                        ↓
                  Stream back to user
```

### UX Assessment
- **Identity**: Response appears as "Mission Lead Agent" (worker identity propagated)
- **Indirection**: User's message goes through Supervisor first — adds a visible
  "delegating to Mission Lead..." step in the UI
- **Latency**: Two serial LLM calls. First call (~1-3s) is pure routing overhead
- **Feel**: Like sending a message through a receptionist, not talking directly

### LLM Token Efficiency
- **Calls per interaction: 2** (Supervisor routing + Worker response)
- **Supervisor call**: ~2,000 (system prompt) + ~1,000 (tool defs) + ~500 (message) =
  **~3,500 input tokens** — entirely wasted on routing
- **Worker call**: ~3,000-5,000 (mission prompt) + ~1,000 (tools) + ~2,000 (history) =
  **~6,000-8,000 input tokens**
- **Total per interaction: ~9,500-11,500 input tokens**
- **Waste ratio**: ~30% of tokens are spent on the routing call alone
- For 50 mission chat messages/day: **~175,000 wasted routing tokens/day**

### Code Complexity
- Low: reuses existing delegation machinery
- New specialist template + prompt file for `mission-lead`
- Workers CAN delegate if their template explicitly grants `delegate` tool and
  `canDelegate: true` (proven by Deep Research Lead → Research Worker and
  Coding Lead → Coding Planner → Coding Worker DAGs). So a mission-lead worker
  could technically spawn sub-agents.
- However, this requires defining a rigid delegation DAG upfront. The Mission Lead
  would need `allowedDelegates: ['researcher', 'coder', ...]` specified in the
  template, and adding new delegate types requires template changes.

### Data Model Impact
- None — uses existing conversation + message tables

### Limitations
- Workers with delegation still operate within workflow-scoped constraints (the
  delegation chain is statically defined in the template, not dynamic like Supervisor)
- Workers cannot access `remember` tool (Supervisor-only)
- The fundamental problem remains: **forced double-LLM-call pattern** even for trivial
  messages. Every "What's the status?" costs a Supervisor routing call + Worker response.
- The Supervisor's routing call is pure waste for mission chat — the user already chose
  to talk to the Mission Lead by typing in the mission-scoped embedded chat

**Verdict: Rejected** — UX indirection and token waste remain the core issues. While
delegation capability is achievable, the double-call pattern makes this inefficient
for the high-frequency, often-trivial nature of mission chat interactions.

---

## Option B: Subclass of SupervisorAgentImpl (Deep Override)

### How It Works
Create `MissionLeadAgent extends SupervisorAgentImpl` with deep overrides of
`handleMessage()`, `generateStreamingResponse()`, and `buildSystemPrompt()` to inject
mission context and skip the delegation decision for mission-scoped conversations.

```
User → WebSocket → MissionLeadAgent.handleMessage() (LLM call #1: direct response)
                        ↓
                  Stream back to user
```

### UX Assessment
- **Identity**: Fully customized (name, emoji, role)
- **Indirection**: None — message goes directly to Mission Lead
- **Latency**: Single LLM call, same as main Supervisor
- **Feel**: Direct conversation with Mission Lead

### LLM Token Efficiency
- **Calls per interaction: 1** (direct response)
- **System prompt**: ~3,000-5,000 (mission-specific prompt with full context)
- **Total per interaction: ~5,000-10,000 input tokens**
- **Savings vs Option A**: ~30% fewer tokens per interaction (no routing call)
- Mission context injected once per call, not duplicated across two calls

### Code Complexity
- **High**: Deep coupling to Supervisor internals
- Must override `handleMessage()` (350 lines) to skip agent command detection,
  alter conversation routing, inject mission context
- Must override `generateStreamingResponse()` (300 lines) to customize tool selection
  and suppress delegation behavior
- Must override `buildSystemPrompt()` to compose mission-specific prompt
- **Fragile**: Any refactor to `SupervisorAgentImpl` internals risks breaking overrides
- Deep knowledge of parent class implementation details required

### Data Model Impact
- Mission conversations use existing `conversations` table (already tagged with metadata)
- No new tables needed

### Future Flexibility
- Medium: tightly coupled, so changes to Supervisor require parallel changes here
- Adding new Mission Lead behaviors (e.g., pillar-scoped context, metric injection)
  requires touching deep override code

**Verdict: Feasible but fragile** — High coupling makes this a maintenance liability.

---

## Option C: Parameterized Second Supervisor Instance

### How It Works
Create a second instance of `SupervisorAgentImpl` with different constructor parameters
(custom system prompt, restricted tools, mission-scoped identity). Route mission
conversation messages to this instance instead of the main Supervisor.

```
User → WebSocket → Router (checks conversationId metadata)
                      ├── main Supervisor (normal chat)
                      └── mission Supervisor instance (mission chat)
                              ↓
                        LLM call #1: direct response
```

### UX Assessment
- **Identity**: Fully customized via config
- **Indirection**: None — routed at WebSocket layer, before any LLM call
- **Latency**: Single LLM call
- **Feel**: Direct conversation with Mission Lead

### LLM Token Efficiency
- **Calls per interaction: 1**
- **System prompt**: Same as Supervisor base (~2,000) + mission addendum (~2,000-3,000)
- **Total per interaction: ~5,000-10,000 input tokens**
- Same efficiency as Option B — single call, no routing waste
- However, the mission instance loads full Supervisor prompt including delegation
  instructions that may be irrelevant for mission context — slight waste (~500 tokens)

### Code Complexity
- **Medium**: No subclassing, but requires refactoring
- `SupervisorAgentImpl` constructor currently hardcodes identity (`supervisor-main`)
  and loads `supervisor.md` — needs parameterization
- Must extract `ensureConversation()` logic or disable it (mission conversations
  already exist)
- Must manage a second agent lifecycle (init, shutdown, registry registration)
- Two Supervisor instances sharing one `AgentRegistry` creates potential conflicts
  (agent ID collisions, command trigger overlaps)
- No clean way to inject per-request mission context without constructor-time config
  (mission context is dynamic — different per conversation)

### Data Model Impact
- None — reuses existing tables

### Future Flexibility
- Medium: Adding mission-specific behavior requires either constructor params or
  more subclassing anyway, which defeats the purpose

**Verdict: Architecturally clean in theory, messy in practice** — Too many assumptions
in `SupervisorAgentImpl` would need to be loosened.

---

## Option D: Thin Subclass (Recommended)

### How It Works
Create `MissionLeadAgent extends SupervisorAgentImpl` with **minimal** overrides:
1. Custom constructor (identity, prompt)
2. Override `buildSystemPrompt()` to inject mission context
3. Override `registerChannel()` to skip `onMessage` binding (routing done externally)
4. Everything else inherited — delegation, streaming, tool execution, tracing all work

The WebSocket message handler routes mission-scoped messages to this agent instead of
the main Supervisor, based on conversation metadata lookup.

```
User → WebSocket → Router (checks if conversationId is mission-scoped)
                      ├── main Supervisor (normal chat)
                      └── MissionLeadAgent.handleMessage() (mission chat)
                              ↓
                        LLM call #1: direct response (with mission context)
                              ↓
                        Can delegate to specialists if needed
```

### UX Assessment
- **Identity**: Custom name ("Mission Lead"), emoji, role — appears as distinct agent
- **Indirection**: None — message routed at WebSocket layer before any LLM processing
- **Latency**: Single LLM call for simple messages; can spawn workers for complex tasks
- **Feel**: Talking directly to the Mission Lead, who has full mission awareness
- **Capability**: Full orchestrator — can delegate to researcher, coder, etc. when needed
  (e.g., "Research best practices for onboarding metrics" triggers researcher delegation)

### LLM Token Efficiency
- **Calls per interaction: 1** for simple messages (direct response)
- **Calls per interaction: 2** for complex messages requiring delegation (same as
  Supervisor — but the first call is the Mission Lead making an informed decision, not
  a generic routing step)
- **System prompt breakdown**:
  - Mission Lead base prompt: ~1,500 tokens
  - Mission context injection (pillars, metrics, strategies, todos): ~1,000-3,000 tokens
    (varies with mission complexity)
  - Delegation section (inherited): ~500 tokens
  - Memory/skills/RAG (inherited): ~500-1,000 tokens
  - **Total system prompt: ~3,500-6,000 tokens**
- **Total per simple interaction: ~5,000-10,000 input tokens**
- **Comparison with Option A**: 30-40% fewer tokens for simple messages (no routing call)
- **Comparison with main Supervisor**: Similar base cost, but mission context adds
  ~1,000-3,000 tokens. This is necessary overhead — it's what makes Mission Lead
  context-aware.

**Token efficiency strategies:**
1. **Lazy context injection**: Only inject full mission context (all pillars + metrics +
   todos) when the user's message likely needs it. For "hello" or "thanks", inject
   minimal context. This can be done with a simple keyword heuristic or a tiny
   classification call (~100 tokens).
2. **Context caching**: LLM providers (Anthropic, OpenAI) support prompt caching. The
   mission system prompt is largely static within a session — subsequent calls reuse
   cached input tokens at ~90% discount.
3. **Conversation-scoped system prompt**: Build the system prompt once per conversation
   turn, not per tool iteration. The `generateStreamingResponse()` tool loop already
   does this — the system prompt is set once and tool iterations only add tool results.
4. **Pruning mission context**: For pillar-scoped conversations, only inject that
   pillar's metrics/strategies/todos, not the entire mission. Reduces context by
   ~60-80%.

### Code Complexity
- **Low**: 3 overrides, all minimal
- Constructor: ~20 lines (custom identity, load mission-lead prompt)
- `buildSystemPrompt()`: ~30 lines (call `super.buildSystemPrompt()`, append mission
  context from DB lookup)
- `registerChannel()`: ~5 lines (skip `onMessage` binding)
- Total new code: **~80-100 lines** (plus prompt file)
- No deep coupling to parent internals — only uses public/protected API
- Parent refactors don't break this unless they change `buildSystemPrompt()` signature

### Data Model Impact
- None — mission conversations already exist with metadata tagging (`channel: 'mission'`)
- Conversation history loaded via inherited `loadConversationHistory()`
- Messages saved via inherited `saveMessageInternal()`

### Server Wiring
- WebSocket message handler gains a routing check (~15 lines):
  ```
  if (conversationId && isMissionConversation(conversationId)) {
    missionLeadAgent.handleMessage(message);
  } else {
    supervisor.handleMessage(message);
  }
  ```
- `isMissionConversation()` does a DB lookup on conversation metadata
  (`json_extract(metadata, '$.channel') IN ('mission', 'pillar')`)
- Result can be cached in memory (conversation metadata doesn't change)

### Future Flexibility
- **High**: Mission Lead inherits all future Supervisor capabilities automatically
- Adding mission-specific tools: register them in registry, add to Mission Lead's
  `canAccessTools` pattern
- Adding mission-specific behaviors: extend `buildSystemPrompt()` or add new overrides
- Multiple mission types (e.g., "Sprint Lead" vs "Strategy Lead"): create additional
  thin subclasses with different prompts
- Pillar-scoped context: override to inject only relevant pillar data based on
  `conversationId` lookup

**Verdict: Recommended** — Minimal code, full capability, clean separation, best
token efficiency for the common case.

---

## Comparison Matrix

| Factor | Option A | Option B | Option C | Option D |
|---|---|---|---|---|
| **UX Directness** | Poor (delegation visible) | Excellent | Excellent | Excellent |
| **LLM Calls (simple msg)** | 2 | 1 | 1 | 1 |
| **LLM Calls (complex msg)** | 2 | 1-2 | 1-2 | 1-2 |
| **Wasted tokens/interaction** | ~3,500 (routing) | ~0 | ~500 (unused sections) | ~0 |
| **System prompt size** | Supervisor + Worker | Custom (3-5k) | Supervisor + addendum | Mission Lead (3.5-6k) |
| **Token cost (50 msgs/day)** | ~575k input | ~375k input | ~400k input | ~375k input |
| **Delegation capability** | Yes (static DAG) | Yes (full) | Yes (full) | Yes (full) |
| **New code** | ~50 lines | ~500+ lines | ~200 lines + refactor | ~100 lines |
| **Coupling to Supervisor** | None | Deep | Medium | Shallow |
| **Breakage risk on refactor** | Low | High | Medium | Low |
| **Future flexibility** | Low | Medium | Medium | High |

---

## Implementation Plan (Option D)

### Step 1: Mission Lead System Prompt

**File:** `src/agents/mission-lead.md` (new)

```markdown
You are the Mission Lead for OllieBot. You are responsible for guiding and executing
a strategic mission — a long-running, multi-pillar initiative with measurable goals.

Your role:
- Understand the mission's objectives, pillars, metrics, and strategies
- Answer questions about mission status, progress, and priorities
- Accept direction from the user to adjust priorities, pause/resume work, or refocus
- Create and manage TODOs when the user requests action items
- Provide strategic recommendations based on metric trends
- Delegate to specialist agents when the user's request requires research, coding, etc.

You speak with authority about the mission because you have full context. Be concise,
direct, and action-oriented. When the user gives a directive, confirm understanding
and explain what will change.
```

### Step 2: MissionLeadAgent Class

**File:** `src/agents/mission-lead.ts` (new, ~100 lines)

```typescript
export class MissionLeadAgent extends SupervisorAgentImpl {
  private missionContextProvider: () => string;

  constructor(llmService: LLMService, registry: AgentRegistry, contextProvider: () => string) {
    // Call super with standard setup
    super(llmService, registry);

    // Override identity
    this.identity = {
      id: 'mission-lead',
      name: 'Mission Lead',
      emoji: '🎯',
      role: 'supervisor',
      description: 'Mission Lead agent for strategic mission guidance',
    };

    // Override system prompt
    this.config.systemPrompt = registry.loadAgentPrompt('mission-lead');

    // Store context provider for dynamic injection
    this.missionContextProvider = contextProvider;
  }

  protected override buildSystemPrompt(additionalContext?: string, allowedTools?: string[]): string {
    // Get base prompt (includes memory, skills, RAG, delegation)
    let prompt = super.buildSystemPrompt(additionalContext, allowedTools);

    // Inject mission context
    const missionContext = this.missionContextProvider();
    if (missionContext) {
      prompt += `\n\n## Current Mission Context\n${missionContext}`;
    }

    return prompt;
  }

  override registerChannel(channel: Channel): void {
    // Register channel for sending but do NOT set up onMessage handler.
    // Message routing is handled externally by the WebSocket layer.
    this.channel = channel;
  }
}
```

### Step 3: Message Routing Layer

**File:** `src/channels/websocket.ts` (modify, ~15 lines)

Add routing logic in `handleClientMessage()`:
- Look up conversation metadata for incoming `conversationId`
- If `channel === 'mission'` or `channel === 'pillar'`, route to Mission Lead handler
- Otherwise, route to main Supervisor handler (existing behavior)
- Cache conversation channel lookups in a Map for performance

### Step 4: Server Initialization

**File:** `src/server/index.ts` (modify, ~20 lines)

- Create `MissionLeadAgent` instance alongside Supervisor
- Pass same `llmService`, `registry`, `toolRunner`, `skillManager`, `ragDataManager`
- Register the Mission Lead agent with the same WebSocket channel
- Provide a `contextProvider` function that loads mission data from MissionManager

### Step 5: Mission Context Provider

**File:** `src/agents/mission-lead.ts` or `src/missions/context.ts` (new, ~50 lines)

Function that queries MissionManager to build a text summary:
```
## Mission: Improve Developer Experience
Status: active | Last cycle: 2h ago | Next cycle: in 4h

### Pillars
1. Build Performance (active) — 3 metrics, 2 strategies, 5 todos
2. Onboarding (active) — 2 metrics, 1 strategy, 3 todos

### Current Focus
- 2 critical TODOs pending
- Build time metric: degrading (target: <30s, current: 45s)
```

This context is regenerated per request (not cached long-term) to ensure freshness,
but individual DB queries are fast (indexed SQLite lookups).

---

## Cost Projection

Assuming Claude Sonnet pricing (~$3/M input, ~$15/M output) and 50 mission chat
messages per day:

| Design | Input tokens/msg | Daily input cost | Monthly input cost |
|---|---|---|---|
| Option A (double call) | ~11,000 | $1.65 | $49.50 |
| Option D (single call) | ~7,500 | $1.13 | $33.75 |
| Option D + caching | ~3,000 effective | $0.45 | $13.50 |

With prompt caching (90% discount on repeated system prompt tokens), Option D's
effective cost drops by ~60% since the mission system prompt is largely identical
across messages in the same conversation.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Mission context too large for context window | Prune to relevant pillar for pillar-scoped chats; summarize rather than dump raw data |
| Supervisor refactor breaks subclass | Minimal override surface (3 methods) limits exposure; integration tests catch regressions |
| Two agents sharing one channel | Channel is stateless broadcast — no conflicts. Active stream tracking keyed by conversationId |
| Routing lookup adds latency | Single indexed SQLite query + in-memory cache — <1ms overhead |
| Mission Lead spawns workers that conflict with Supervisor's workers | Workers are ephemeral, keyed by unique ID — no namespace collision |

---

## Decision

**Option D (Thin Subclass)** is recommended for implementation. It provides:
1. Direct UX with no routing indirection
2. Optimal LLM token efficiency (single call for simple messages)
3. Full orchestrator capability (can delegate when needed)
4. Minimal code footprint (~100 lines)
5. Low coupling and high resilience to parent refactors
6. Natural extension path for future mission types
