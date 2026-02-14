# Mission Lead Agent — Implementation-Ready Design

> **Selected approach**: Option D (Thin Subclass) from `mission-lead-design-eval.md`
>
> **Goal**: Embedded mission chat feels like talking directly to a Mission Lead agent
> with full mission context, not through the generic Supervisor.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  WebSocket Client (frontend)                             │
│  sends { type: 'message', content, conversationId }      │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  WebSocketChannel.handleClientMessage()                  │
│  creates Message { metadata: { conversationId } }        │
│  calls this.messageHandler(message)                      │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  Routing Function (installed as messageHandler)           │
│                                                          │
│  if isMissionConversation(conversationId):               │
│      → missionLeadAgent.handleMessage(message)           │
│  else:                                                   │
│      → supervisor.handleMessage(message)                 │
└──────┬───────────────────────────────┬───────────────────┘
       │                               │
       ▼                               ▼
┌──────────────┐            ┌────────────────────┐
│  Supervisor   │            │  MissionLeadAgent  │
│  (vanilla)    │            │  extends Supervisor│
│               │            │                    │
│  supervisor.md│            │  mission-lead.md   │
│  + delegation │            │  + delegation      │
│  + browser    │            │  + mission context │
└──────────────┘            └────────────────────┘
```

---

## Files to Create

| File | Purpose | Est. Lines |
|---|---|---|
| `src/agents/mission-lead.ts` | MissionLeadAgent class | ~120 |
| `src/agents/mission-lead.md` | System prompt | ~40 |

## Files to Modify

| File | Change | Est. Lines |
|---|---|---|
| `src/server/index.ts` | Create MissionLeadAgent, wire routing | ~40 |
| `src/missions/manager.ts` | Set `manuallyNamed` on conversation creation | ~4 |
| `src/agents/index.ts` | Re-export MissionLeadAgent | ~1 |

---

## Step 1: System Prompt — `src/agents/mission-lead.md`

```markdown
You are the Mission Lead — a strategic agent responsible for guiding and executing
long-running missions with measurable goals across multiple pillars.

Your role:
- You have deep context on the mission's objectives, pillars, metrics, and strategies
- Answer questions about mission status, progress, and priorities directly and concisely
- Accept direction from the user to adjust priorities, pause/resume pillars, or refocus strategies
- Create and manage TODOs when the user requests action items
- Provide strategic recommendations based on metric trends
- When the user's request requires research, coding, or other specialized work, delegate to a specialist

Speak with authority about the mission. Be concise, direct, and action-oriented.
When the user gives a directive, confirm understanding and state what will change.

You are NOT the generic assistant — you are the Mission Lead for a specific mission.
Every message you receive is in the context of that mission.
```

**Note**: The mission-specific context (pillars, metrics, todos, strategies) is injected
dynamically per request via `buildSystemPrompt()` — not baked into this file.

---

## Step 2: MissionLeadAgent Class — `src/agents/mission-lead.ts`

### Class Design

```typescript
import { SupervisorAgentImpl } from './supervisor.js';
import type { AgentRegistry } from './base-agent.js';
import type { LLMService } from '../llm/service.js';
import type { Channel, Message } from '../channels/types.js';
import type { MissionManager } from '../missions/index.js';
import { getDb } from '../db/index.js';

// Cached conversation → mission context mapping
interface MissionChatContext {
  channel: 'mission' | 'pillar';
  missionId: string;
  missionSlug: string;
  pillarId?: string;
  pillarSlug?: string;
}

export class MissionLeadAgent extends SupervisorAgentImpl {
  private missionManager: MissionManager | null = null;
  private conversationContextCache: Map<string, MissionChatContext | null> = new Map();
  private currentMissionContext: string | null = null; // request-scoped

  constructor(llmService: LLMService, registry: AgentRegistry) {
    super(llmService, registry);

    // Mutate identity (readonly prevents reassignment, not property mutation)
    this.identity.id = 'mission-lead';
    this.identity.name = 'Mission Lead';
    this.identity.emoji = '🎯';
    this.identity.description = 'Mission Lead agent for strategic mission guidance';

    // Override system prompt (config properties are mutable)
    this.config.systemPrompt = registry.loadAgentPrompt('mission-lead');
  }

  setMissionManager(manager: MissionManager): void {
    this.missionManager = manager;
  }

  // --- Override 1: registerChannel ---
  // Store the channel for sending but do NOT bind onMessage.
  // Message routing is handled by the server's routing layer.
  override registerChannel(channel: Channel): void {
    this.channel = channel;
  }

  // --- Override 2: handleMessage ---
  // Set request-scoped mission context before parent processes the message.
  override async handleMessage(message: Message): Promise<void> {
    const conversationId = message.metadata?.conversationId as string | undefined;
    if (conversationId) {
      this.currentMissionContext = this.buildMissionContext(conversationId);
    }
    try {
      await super.handleMessage(message);
    } finally {
      this.currentMissionContext = null;
    }
  }

  // --- Override 3: buildSystemPrompt ---
  // Append mission context after parent builds base + delegation + browser sections.
  protected override buildSystemPrompt(
    additionalContext?: string,
    allowedTools?: string[]
  ): string {
    let prompt = super.buildSystemPrompt(additionalContext, allowedTools);

    if (this.currentMissionContext) {
      prompt += `\n\n${this.currentMissionContext}`;
    }

    return prompt;
  }

  // --- Mission context builder ---

  private lookupConversationContext(conversationId: string): MissionChatContext | null {
    if (this.conversationContextCache.has(conversationId)) {
      return this.conversationContextCache.get(conversationId)!;
    }

    const db = getDb();
    const conv = db.conversations.findById(conversationId);
    if (!conv?.metadata) {
      this.conversationContextCache.set(conversationId, null);
      return null;
    }

    const channel = conv.metadata.channel as string | undefined;
    if (channel !== 'mission' && channel !== 'pillar') {
      this.conversationContextCache.set(conversationId, null);
      return null;
    }

    const ctx: MissionChatContext = {
      channel: channel as 'mission' | 'pillar',
      missionId: conv.metadata.missionId as string,
      missionSlug: conv.metadata.missionSlug as string,
      pillarId: conv.metadata.pillarId as string | undefined,
      pillarSlug: conv.metadata.pillarSlug as string | undefined,
    };
    this.conversationContextCache.set(conversationId, ctx);
    return ctx;
  }

  private buildMissionContext(conversationId: string): string | null {
    if (!this.missionManager) return null;

    const ctx = this.lookupConversationContext(conversationId);
    if (!ctx) return null;

    const mission = this.missionManager.getMissionBySlug(ctx.missionSlug);
    if (!mission) return null;

    const pillars = this.missionManager.getPillarsByMission(mission.id);
    const allTodos = this.missionManager.getTodosByMission(mission.id);

    const lines: string[] = [];
    lines.push('## Current Mission Context');
    lines.push('');
    lines.push(`**Mission**: ${mission.name}`);
    lines.push(`**Status**: ${mission.status}`);
    if (mission.description) {
      lines.push(`**Description**: ${mission.description}`);
    }
    if (mission.lastCycleAt) {
      lines.push(`**Last cycle**: ${mission.lastCycleAt}`);
    }
    lines.push('');

    // If this is a pillar-scoped conversation, focus on that pillar
    if (ctx.channel === 'pillar' && ctx.pillarId) {
      const pillar = pillars.find(p => p.id === ctx.pillarId);
      if (pillar) {
        lines.push(`### Current Pillar: ${pillar.name}`);
        lines.push(`Status: ${pillar.status}`);
        if (pillar.description) lines.push(`Description: ${pillar.description}`);
        lines.push('');
        this.appendPillarDetail(lines, pillar);
      }

      // Also show sibling pillars (summary only) for broader context
      const siblings = pillars.filter(p => p.id !== ctx.pillarId);
      if (siblings.length > 0) {
        lines.push('');
        lines.push('### Other Pillars (summary)');
        for (const p of siblings) {
          const todoCount = allTodos.filter(t => t.pillarId === p.id).length;
          lines.push(`- **${p.name}** (${p.status}) — ${todoCount} todos`);
        }
      }
    } else {
      // Mission-level conversation — show all pillars with detail
      lines.push(`### Pillars (${pillars.length})`);
      lines.push('');
      for (const pillar of pillars) {
        lines.push(`#### ${pillar.name} (${pillar.status})`);
        if (pillar.description) lines.push(pillar.description);
        lines.push('');
        this.appendPillarDetail(lines, pillar);
        lines.push('');
      }
    }

    // Pending/in-progress todos across the mission
    const activeTodos = allTodos.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (activeTodos.length > 0) {
      lines.push('### Active TODOs');
      for (const todo of activeTodos.slice(0, 10)) {
        const pillar = pillars.find(p => p.id === todo.pillarId);
        lines.push(`- [${todo.status}] **${todo.title}** (${todo.priority}) — ${pillar?.name || 'unlinked'}`);
      }
      if (activeTodos.length > 10) {
        lines.push(`- ...and ${activeTodos.length - 10} more`);
      }
    }

    return lines.join('\n');
  }

  private appendPillarDetail(lines: string[], pillar: { id: string }): void {
    if (!this.missionManager) return;

    const metrics = this.missionManager.getMetricsByPillar(pillar.id);
    const strategies = this.missionManager.getStrategiesByPillar(pillar.id);
    const todos = this.missionManager.getTodosByPillar(pillar.id);

    if (metrics.length > 0) {
      lines.push('**Metrics**:');
      for (const m of metrics) {
        lines.push(`- ${m.name}: ${m.current} ${m.unit} (target: ${m.target}, trend: ${m.trend})`);
      }
    }

    if (strategies.length > 0) {
      lines.push('**Strategies**:');
      for (const s of strategies) {
        lines.push(`- [${s.status}] ${s.description}`);
      }
    }

    if (todos.length > 0) {
      const byStatus = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
      for (const t of todos) {
        byStatus[t.status as keyof typeof byStatus] = (byStatus[t.status as keyof typeof byStatus] || 0) + 1;
      }
      const parts = Object.entries(byStatus).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
      lines.push(`**TODOs**: ${parts.join(', ')}`);
    }
  }
}
```

### Why These Three Overrides Are Sufficient

| Override | What it does | Lines |
|---|---|---|
| `registerChannel()` | Stores channel reference without binding onMessage — routing is external | ~3 |
| `handleMessage()` | Sets request-scoped `currentMissionContext` before calling `super.handleMessage()`, clears after | ~10 |
| `buildSystemPrompt()` | Appends mission context to parent's assembled prompt (base + delegation + browser + memory + skills + RAG) | ~8 |

Everything else is inherited:
- `ensureConversation()` — mission conversationIds arrive from frontend; parent finds the existing conversation, updates its timestamp, returns it. No new conversations created.
- `autoNameConversation()` — skipped because mission conversations will have `manuallyNamed: true` (see Step 5).
- `generateStreamingResponse()` — works unmodified; calls `buildSystemPrompt()` which we override.
- `spawnAgent()` / delegation — fully inherited; Mission Lead can delegate to researcher, coder, writer, planner.
- `saveMessageInternal()` / `saveAssistantMessageWithContext()` — persist messages to the mission conversation.
- Trace context, LLM context push/pop, deduplication — all inherited.

### Field Visibility Check

| Field | Visibility | Can subclass access? | Used by override? |
|---|---|---|---|
| `this.channel` | `protected` (AbstractAgent) | Yes | Set in `registerChannel()` |
| `this.identity` | `readonly` (AbstractAgent) | Properties mutable | Mutated in constructor |
| `this.config` | `readonly` (AbstractAgent) | Properties mutable | `systemPrompt` set in constructor |
| `this.agentRegistry` | `protected declare` (Supervisor) | Yes | Inherited for delegation |
| `this.llmService` | `protected` (AbstractAgent) | Yes | Inherited |
| `this.conversationHistory` | `protected` (AbstractAgent) | Yes | Inherited |
| `this.processingMessages` | `private` (Supervisor) | No | Not needed — `super.handleMessage()` manages it |
| `this.delegatedMessages` | `private` (Supervisor) | No | Not needed — `super.handleMessage()` manages it |

---

## Step 3: Message Routing — `src/server/index.ts`

### Changes to AssistantServer

**Add field** (alongside existing `private supervisor`):
```typescript
private missionLeadAgent?: MissionLeadAgent;
```

**In `start()` method**, after `this.supervisor.registerChannel(this.wsChannel)` (line 1192):

```typescript
// Create Mission Lead agent if mission manager is available
if (this.missionManager && this.llmService) {
  const { MissionLeadAgent } = await import('../agents/mission-lead.js');
  const registry = getAgentRegistry();

  this.missionLeadAgent = new MissionLeadAgent(this.llmService, registry);

  // Share the same tool infrastructure as supervisor
  if (this.toolRunner) this.missionLeadAgent.setToolRunner(this.toolRunner);
  if (this.skillManager) this.missionLeadAgent.setSkillManager(this.skillManager);

  // Share RAG data manager (supervisor already has it set)
  // MissionLeadAgent inherits setRagDataManager from AbstractAgent

  // Set mission-specific dependency
  this.missionLeadAgent.setMissionManager(this.missionManager);

  // Register channel for sending (does NOT bind onMessage — our router handles that)
  this.missionLeadAgent.registerChannel(this.wsChannel);

  // Register with global registry
  registry.registerAgent(this.missionLeadAgent);
  await this.missionLeadAgent.init();

  console.log('[Server] Mission Lead agent initialized');
}
```

**Install routing message handler** (after both agents are set up):

```typescript
// Install message routing: mission conversations → MissionLeadAgent, else → Supervisor
if (this.missionLeadAgent) {
  const missionLead = this.missionLeadAgent;
  const supervisor = this.supervisor;
  const conversationChannelCache = new Map<string, string | null>();

  this.wsChannel.onMessage(async (message) => {
    const conversationId = message.metadata?.conversationId as string | undefined;

    if (conversationId) {
      // Check cache first
      let channel = conversationChannelCache.get(conversationId);
      if (channel === undefined) {
        // Cache miss — look up conversation metadata
        const db = getDb();
        const conv = db.conversations.findById(conversationId);
        channel = (conv?.metadata?.channel as string) ?? null;
        conversationChannelCache.set(conversationId, channel);
      }

      if (channel === 'mission' || channel === 'pillar') {
        await missionLead.handleMessage(message);
        return;
      }
    }

    // Default: route to supervisor
    await supervisor.handleMessage(message);
  });
}
```

**Note**: `this.wsChannel.onMessage()` replaces the handler that `supervisor.registerChannel()`
installed (line 1192). The Supervisor's `onAction` handler remains intact since `registerChannel`
sets `onAction` separately.

### Why Cache Works

Conversation metadata (channel, missionId, etc.) is immutable after creation — a mission
conversation never becomes a non-mission conversation. So the `conversationChannelCache` Map
is append-only and never stale.

---

## Step 4: Prevent Auto-Naming — `src/missions/manager.ts`

Mission conversations should retain their fixed titles (`"Mission: <name>"`,
`"Pillar: <name>"`). The Supervisor's `autoNameConversation()` checks
`conversation?.manuallyNamed` and skips if true. We need to set this flag.

### Change 1: Mission conversation creation (line 380-383)

```diff
- db.rawRun(
-   'INSERT INTO conversations (id, title, createdAt, updatedAt, metadata) VALUES (?, ?, ?, ?, ?)',
-   [conversationId, `Mission: ${missionName}`, now, now, JSON.stringify({ channel: 'mission', missionId, missionSlug: slug })]
- );
+ db.rawRun(
+   'INSERT INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
+   [conversationId, `Mission: ${missionName}`, now, now, 1, JSON.stringify({ channel: 'mission', missionId, missionSlug: slug })]
+ );
```

### Change 2: Pillar conversation creation (line 408-411)

```diff
- db.rawRun(
-   'INSERT INTO conversations (id, title, createdAt, updatedAt, metadata) VALUES (?, ?, ?, ?, ?)',
-   [conversationId, `Pillar: ${pillarConfig.name}`, now, now, JSON.stringify({ channel: 'pillar', missionId, pillarId, pillarSlug })]
- );
+ db.rawRun(
+   'INSERT INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
+   [conversationId, `Pillar: ${pillarConfig.name}`, now, now, 1, JSON.stringify({ channel: 'pillar', missionId, pillarId, pillarSlug })]
+ );
```

This leverages the existing `manuallyNamed INTEGER` column (already in the schema at
`src/db/index.ts` line 199).

---

## Step 5: Re-export — `src/agents/index.ts`

Add to existing exports:
```typescript
export { MissionLeadAgent } from './mission-lead.js';
```

---

## Request Flow Walkthrough

### Simple Message: "What's the status of the onboarding pillar?"

```
1. Frontend sends:
   { type: 'message', content: '...', conversationId: 'conv-pillar-xyz' }

2. WebSocketChannel.handleClientMessage() creates Message:
   { id, role: 'user', content, metadata: { conversationId: 'conv-pillar-xyz' } }

3. Routing function:
   - Looks up conv-pillar-xyz in cache → miss
   - DB: conversations.findById('conv-pillar-xyz')
     → metadata: { channel: 'pillar', missionId: 'm1', pillarSlug: 'onboarding' }
   - Cache: set('conv-pillar-xyz', 'pillar')
   - Routes to missionLeadAgent.handleMessage(message)

4. MissionLeadAgent.handleMessage():
   - Reads conversationId from metadata
   - Calls buildMissionContext('conv-pillar-xyz')
     → lookupConversationContext → { channel: 'pillar', pillarId: 'p1', ... }
     → missionManager.getMissionBySlug → mission data
     → missionManager.getPillarsByMission → all pillars
     → Builds focused context for onboarding pillar + sibling summaries
   - Sets this.currentMissionContext = "## Current Mission Context\n..."
   - Calls super.handleMessage(message)

5. SupervisorAgentImpl.handleMessage() (inherited):
   - Dedup check → OK
   - ensureConversation('conv-pillar-xyz') → finds existing, updates timestamp
   - Loads conversation history from DB
   - Saves user message to DB
   - Starts trace
   - No agentCommand → proceeds to generateStreamingResponse()

6. generateStreamingResponse() (inherited):
   - Calls this.buildSystemPrompt()

7. MissionLeadAgent.buildSystemPrompt() (override):
   - super.buildSystemPrompt() assembles:
     - mission-lead.md (base prompt)
     - DELEGATION_SECTION (specialist types)
     - Memory context
     - Skill instructions
     - RAG data
   - Appends this.currentMissionContext (pillar-focused mission data)
   - Returns full prompt (~3,500-5,000 tokens)

8. LLM generates response (single call):
   - System prompt: mission-lead.md + delegation + mission context
   - History: conversation messages
   - User: "What's the status of the onboarding pillar?"
   → Responds directly with pillar status, metrics, trends

9. Stream response back to frontend via channel

10. MissionLeadAgent.handleMessage() finally:
    - Clears this.currentMissionContext = null
```

**Total LLM calls: 1**

### Complex Message: "Research best practices for developer onboarding metrics"

Same flow through steps 1-7, then:

```
8. LLM decides to delegate (has delegate tool):
   - Calls delegate tool: { type: 'researcher', mission: 'Research best...' }

9. SupervisorAgentImpl.handleDelegationFromTool() (inherited):
   - Creates WorkerAgent with type 'researcher'
   - Loads researcher.md prompt
   - Worker executes research with web_search, web_scrape tools
   - Worker streams response to frontend (appears as Research Agent)
   - Worker reports result back to Mission Lead

10. Mission Lead receives result, synthesizes if needed
```

**Total LLM calls: 2** (Mission Lead routing + Researcher execution) — but the
first call is an informed decision by the Mission Lead, not generic Supervisor routing.

---

## Token Budget Analysis

### System Prompt Composition (per LLM call)

| Component | Source | Est. Tokens |
|---|---|---|
| `mission-lead.md` (base) | File | ~300 |
| DELEGATION_SECTION | Supervisor constant | ~500 |
| Memory context | memoryService | ~200-500 |
| Skill instructions | skillManager | ~300-500 |
| RAG data | ragDataManager | ~0-500 |
| Mission context (full) | buildMissionContext | ~1,000-3,000 |
| Mission context (pillar-scoped) | buildMissionContext | ~500-1,500 |
| **Total** | | **~2,300-5,300** |

### Per-Message Cost (Claude Sonnet, ~$3/M input)

| Scenario | System Prompt | History | Total Input | Cost |
|---|---|---|---|---|
| Simple Q (pillar-scoped) | ~3,000 | ~1,000 | ~4,000 | $0.012 |
| Simple Q (mission-scoped) | ~4,500 | ~1,000 | ~5,500 | $0.017 |
| Complex (delegation) | ~4,500 + ~2,000 (worker) | ~1,000 | ~7,500 | $0.023 |
| With prompt caching (90% discount) | ~450 effective | ~1,000 | ~1,450 | $0.004 |

### Monthly Projection (50 messages/day)

| Scenario | Monthly Input Cost |
|---|---|
| No caching | ~$25-50 |
| With prompt caching | ~$6-12 |
| Option A equivalent (double-call) | ~$50-75 |

---

## Edge Cases

### 1. Mission Deleted While Conversation Exists
- `buildMissionContext()` returns `null` if `getMissionBySlug()` returns undefined
- Mission Lead still responds but without mission context — degrades gracefully to
  a generic assistant response
- Frontend should navigate away from deleted mission

### 2. Concurrent Messages to Same Mission Conversation
- Parent's `processingMessages` Set prevents reprocessing of duplicate message IDs
- `currentMissionContext` is set/cleared per `handleMessage()` call — but if two
  calls interleave, one could read the other's context. Mitigation: Node.js is
  single-threaded; `handleMessage` runs to the first `await` before yielding, and
  `buildMissionContext()` is synchronous (all DB calls are sync in better-sqlite3).
  The context is set and consumed before the first yield point.

### 3. Frontend Sends Message Without conversationId
- Routing function falls through to Supervisor (no conversationId to check)
- Supervisor's `ensureConversation()` creates or finds a recent conversation
- This is correct behavior — only messages with an explicit mission conversationId
  should reach Mission Lead

### 4. Conversation Cache Grows Unbounded
- `conversationChannelCache` in the router is append-only (metadata doesn't change)
- Bounded by total number of conversations — typically hundreds, not millions
- Each entry is ~100 bytes (string key + string|null value)
- No eviction needed for practical deployments

### 5. MissionManager Not Available
- `setMissionManager()` not called → `this.missionManager` is null
- `buildMissionContext()` returns null → no mission context in prompt
- Mission Lead still functions as a capable agent, just without mission awareness
- Server logs should warn if MissionLeadAgent is created without MissionManager

---

## Testing Strategy

### Unit Tests — `src/agents/mission-lead.test.ts`

1. **Constructor**: Verify identity override (id, name, emoji) and system prompt override
2. **registerChannel**: Verify channel stored but onMessage NOT bound
3. **buildSystemPrompt**: Verify mission context appended after parent prompt
4. **buildMissionContext**: Test mission-scoped vs pillar-scoped context generation
5. **lookupConversationContext**: Test cache hit, cache miss, non-mission conversation
6. **handleMessage lifecycle**: Verify currentMissionContext set before super, cleared after

### Integration Tests

1. **Routing**: Send message with mission conversationId → reaches MissionLeadAgent
2. **Routing**: Send message with normal conversationId → reaches Supervisor
3. **Routing**: Send message without conversationId → reaches Supervisor
4. **Delegation**: Mission Lead delegates to researcher → response streams correctly
5. **Auto-naming skipped**: Mission conversation title unchanged after 3+ messages

---

## Implementation Order

1. **`src/agents/mission-lead.md`** — system prompt (no dependencies)
2. **`src/missions/manager.ts`** — add `manuallyNamed: 1` to conversation inserts
3. **`src/agents/mission-lead.ts`** — the agent class
4. **`src/agents/index.ts`** — re-export
5. **`src/server/index.ts`** — create agent, wire routing
6. **Tests**
