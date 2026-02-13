# Plan: Embedded Chat Panel for Mission Tab

> **Status:** Revised — synced with `mission-lead-design-ready.md` (Feb 2026)
>
> **Depends on:** MissionLeadAgent (implemented), conversation routing (implemented),
> conversation DB filtering (implemented)

---

## Why This Matters

The embedded chat is the **only way users can influence mission direction**. Without it,
missions are fully autonomous with zero human steering. The feature design
(`mission-feature-design.md` sections 3.4, 5.4, 5.5) defines four use cases:

1. **Intervene:** "Pause work on build performance, focus on onboarding"
2. **Guide:** "We're migrating to Vite next month, factor that in"
3. **Review:** "Why did you prioritize this TODO over that one?"
4. **Override:** Manually reprioritize TODOs, modify strategies, adjust metric targets

All of these flow through conversation with the **MissionLeadAgent**, scoped to the
appropriate `conversationId` (mission-level or pillar-level).

---

## Architecture Inventory

### Already Implemented (Backend)

| Component | File | Notes |
|---|---|---|
| Mission/pillar `conversationId` creation | `src/missions/manager.ts:380-411` | Created at bootstrap with `channel` metadata |
| Conversation metadata: `{ channel, missionId, pillarId }` | `src/missions/manager.ts` | Immutable after creation |
| `manuallyNamed: 1` on mission conversations | `src/missions/manager.ts:381,409` | Prevents auto-rename |
| **MissionLeadAgent** class | `src/agents/mission-lead.ts` | Thin subclass of SupervisorAgentImpl with 3 overrides |
| Mission context injection (mission-scoped) | `src/agents/mission-lead.ts:112-184` | Builds full context: pillars, metrics, strategies, todos |
| Pillar-scoped context | `src/agents/mission-lead.ts:138-157` | Focused pillar detail + sibling summaries |
| Server-side message routing | `src/server/index.ts:1232-1260` | `channel === 'mission' \|\| 'pillar'` → MissionLeadAgent |
| Routing cache | `src/server/index.ts:1237` | `conversationChannelCache` Map, append-only |
| Delegation to specialists | Inherited from SupervisorAgentImpl | MissionLeadAgent can delegate to researcher, coder, writer, planner |
| DB conversation filtering | `src/db/index.ts:434-463` | `findAll()` defaults to excluding mission/pillar conversations |
| Message pagination | `GET /api/conversations/:id/messages` | Cursor-based, works for any conversationId |
| Mission REST API (15 endpoints) | `src/server/mission-routes.ts` | Full CRUD for missions, pillars, metrics, strategies, todos |

### Already Implemented (Frontend)

| Component | File | Notes |
|---|---|---|
| `ChatInput` component | `web/src/components/ChatInput.jsx` | Fully reusable — accepts callbacks |
| `MessageContent` component | `web/src/components/MessageContent.jsx` | Renders assistant messages with formatting |
| WebSocket `sendMessage` | `web/src/hooks/useWebSocket.js` | `{ type: 'message', conversationId, content }` |
| Stream handling (start/chunk/end) | `web/src/App.websocket.js` | Conversation-scoped event dispatch |
| Mission mode sidebar + main content | `web/src/App.Mission.jsx` | Full hierarchy: mission → pillar → todo |
| DashboardViewer (iframe) | `web/src/App.Mission.jsx:475-526` | Serves agent-generated HTML dashboards |
| TodoExecution placeholder | `web/src/App.Mission.jsx:748-755` | Shows conversationId, placeholder for future chat |

### Conversation Hiding — Already Working

The DB layer's `findAll()` (line 450-452 of `src/db/index.ts`) defaults to:

```sql
WHERE (metadata IS NULL
  OR json_extract(metadata, '$.channel') IS NULL
  OR json_extract(metadata, '$.channel') = 'chat')
```

This means the `/api/startup` endpoint already excludes mission and pillar conversations
from the sidebar conversation list. **No backend work needed for hiding.**

---

## The Gap: Multi-Conversation WebSocket Routing

Currently, `App.jsx` maintains a **single** `currentConversationId`. The message handler
in `App.websocket.js` filters all incoming WebSocket events against this ID via
`isForCurrentConversation()` (line 57-88).

The mission embedded chat needs to receive streaming events for a **different**
conversationId (the mission's or pillar's) while the main chat may be on another
conversation entirely.

---

## Implementation Plan

### Step 1: Conversation Subscription System

**File:** `web/src/hooks/useConversationSubscription.js` (new)

A lightweight pub-sub layer that routes incoming WebSocket events to multiple
conversation-scoped subscribers.

```
┌──────────────────────────────────────┐
│ WebSocket onMessage                   │
│                                       │
│  Incoming event (with conversationId) │
│         │                             │
│         ▼                             │
│  ┌──────────────────────┐             │
│  │ ConversationRouter    │             │
│  │                       │             │
│  │  subscriptions:       │             │
│  │    convId_A → [cb1]   │ ← Main Chat│
│  │    convId_B → [cb2]   │ ← Mission  │
│  │    convId_C → [cb3]   │ ← Pillar   │
│  │                       │             │
│  └──────────────────────┘             │
└──────────────────────────────────────┘
```

**API:**
```js
// React context provides subscribe/unsubscribe
const { subscribe, unsubscribe } = useConversationSubscriptions();

// When MissionChat mounts for a specific conversation:
useEffect(() => {
  const unsub = subscribe(conversationId, (event) => {
    // event: stream_start | stream_chunk | stream_end | message | error | ...
  });
  return unsub; // cleanup on unmount
}, [conversationId]);
```

**Integration:** In `App.websocket.js`, the existing `createMessageHandler` gains one
addition: for conversation-scoped events, also dispatch to any registered subscribers
for that conversationId. The main Chat tab continues to work exactly as before — it just
becomes one subscriber among potentially several.

**Backward compatibility:** If no subscriptions exist for a conversationId, behavior is
unchanged. The subscription layer is additive only.

### Step 2: MissionChat Component

**File:** `web/src/components/mission/MissionChat.jsx` (new)

A self-contained embedded chat panel that:
- Takes `conversationId` and `contextLabel` as props
- Loads message history via REST (`GET /api/conversations/:id/messages`)
- Renders messages using `MessageContent`
- Sends new messages via the existing WebSocket `sendMessage`
- Receives streaming responses via the subscription system from Step 1
- Supports collapse/expand (default: collapsed)
- Shows typing/streaming indicator during response
- Auto-scrolls on new messages
- Shows "new messages" badge when collapsed and a response arrives

**Layout (from `mission-feature-design.md` section 5.4):**
```
│──────────────────────────────────────────────────────────│
│  💬 Mission Chat                                 [▲ ▼]   │
│  ┌──────────────────────────────────────────────────────┐│
│  │  You: Focus more on onboarding this sprint           ││
│  │  🎯 Mission Lead: Understood. I'll reprioritize...   ││
│  │                                                      ││
│  │  [Message the Mission Lead...]               [Send]  ││
│  └──────────────────────────────────────────────────────┘│
```

**Props:**
```jsx
<MissionChat
  conversationId={selectedMission.conversationId}
  contextLabel="Mission Chat"
  placeholder="Message the Mission Lead..."
  sendMessage={sendMessage}
  subscribe={subscribe}
  readOnly={false}
  defaultExpanded={false}
/>
```

**Key behaviors:**
- Lazy loads messages only when expanded
- Cursor-based pagination — scrolling up loads older messages
- Shows "new messages" indicator when collapsed and a response arrives
- Streams tokens in real-time (same visual as main Chat tab)
- Enter sends, Shift+Enter for newlines (matches ChatInput)
- `readOnly` mode for completed task execution logs

### Step 3: Integrate into Mission Views

**File:** `web/src/App.Mission.jsx` (modify)

**Mission view** — add MissionChat below the tab content:
```jsx
<div className="mission-content">
  <div className="mission-breadcrumb">...</div>
  <div className="mission-tabs">...</div>
  <div className="mission-tab-content">
    {/* existing tab content */}
  </div>
  <MissionChat
    conversationId={selectedMission.conversationId}
    contextLabel="Mission Chat"
    placeholder="Message the Mission Lead..."
    sendMessage={sendMessage}
    subscribe={subscribe}
  />
</div>
```

**Pillar view** — add MissionChat scoped to pillar conversation:
```jsx
<MissionChat
  conversationId={selectedPillar.conversationId}
  contextLabel={`${selectedPillar.name} Chat`}
  placeholder={`Message about ${selectedPillar.name}...`}
  sendMessage={sendMessage}
  subscribe={subscribe}
/>
```

**Task Execution view** — replace placeholder with full embedded chat:
```jsx
<MissionChat
  conversationId={todo.conversationId}
  contextLabel="Task Execution Log"
  placeholder="Intervene in this task..."
  sendMessage={sendMessage}
  subscribe={subscribe}
  readOnly={todo.status === 'completed'}
  defaultExpanded={true}
/>
```

### Step 4: Wire WebSocket Dependencies

**File:** `web/src/App.jsx` (modify)

The `MissionMainContent` currently doesn't have access to `sendMessage` or `subscribe`.

**Approach:** Create a `ConversationSubscriptionProvider` context at the App level that
wraps the subscription system from Step 1. Pass `sendMessage` through the missionMode
object:

```jsx
// In App.jsx, where useMissionMode is called:
const missionMode = useMissionMode();

// Pass sendMessage alongside missionMode:
<MissionMainContent missionMode={{ ...missionMode, sendMessage, subscribe }} />
```

The `subscribe` function comes from the ConversationSubscriptionProvider context,
available to any component in the tree.

### Step 5: CSS for Embedded Chat Panel

**File:** `web/src/App.jsx` (styles section) or dedicated CSS file

New styles for the collapsible chat panel:

```css
.mission-chat-panel { /* bottom-pinned, flex child */ }
.mission-chat-panel.collapsed { /* single-line bar only */ }
.mission-chat-header { /* "💬 Mission Chat  [▲ ▼]" clickable bar */ }
.mission-chat-messages { /* scrollable message area, max-height: 300px */ }
.mission-chat-input { /* ChatInput wrapper at bottom of panel */ }
.mission-chat-streaming { /* typing/streaming indicator */ }
.mission-chat-badge { /* "New messages" count badge when collapsed */ }
```

Layout: `mission-tab-content` gets `flex: 1; min-height: 0; overflow-y: auto` and
the chat panel sits below with `flex-shrink: 0; max-height: 300px` (expandable in
future iteration via drag handle).

---

## Data Flow (Complete)

```
User types in Mission Chat (pillar-level)
       │
       ▼
MissionChat.handleSubmit(text)
       │
       ├── Add user message to local state (optimistic)
       │
       ├── sendMessage({
       │     type: 'message',
       │     conversationId: pillar.conversationId,   ← scoped
       │     content: text,
       │   })
       │
       ▼
Server: WebSocketChannel receives message
       │
       ▼
Routing function (src/server/index.ts:1237-1260):
       │
       ├── conversationChannelCache lookup → 'pillar'
       │
       ▼
MissionLeadAgent.handleMessage(message)
       │
       ├── lookupConversationContext(conversationId)
       │     → { channel: 'pillar', missionId, pillarId, pillarSlug }
       │
       ├── buildMissionContext(conversationId)
       │     → Focused pillar context + sibling summaries
       │
       ├── Sets this.currentMissionContext (request-scoped)
       │
       ▼
super.handleMessage(message)  [inherited from SupervisorAgentImpl]
       │
       ├── ensureConversation(pillar.conversationId) → finds existing
       ├── Loads conversation history from DB
       ├── Saves user message to DB
       │
       ├── generateStreamingResponse()
       │     ├── buildSystemPrompt() [override appends mission context]
       │     │     → mission-lead.md + delegation + memory + skills + RAG
       │     │       + Current Mission Context (pillar-focused)
       │     └── LLM call with full context
       │
       ▼
Stream response back via WebSocket
       │
       ├── stream_start  { conversationId: pillar.conversationId }
       ├── stream_chunk   (N times)
       ├── stream_end     { citations, usage }
       │
       ▼
ConversationRouter dispatches to MissionChat subscriber
       │
       ▼
MissionChat renders streaming response in embedded panel
```

---

## Design Holes (Require Resolution Before Implementation)

### Hole 1: Pillar Lead Agent — Delegation Target

**Context:** The user specified "Mission Pillar chat — with Mission Lead Agent but with
possible delegation to pillar Agents." Currently, MissionLeadAgent can delegate to
generic specialist types (researcher, coder, writer, planner) but there is no
pillar-specific agent type.

**The question:** Should a "pillar lead" be:

**(A) A new specialist template in the registry** — e.g., `pillar-worker` that receives
the pillar's context (metrics, strategies, todos) in its system prompt and can perform
pillar-scoped work (metric collection, strategy review, TODO execution)?

**(B) Just the existing specialist types, but called with pillar context** — the Mission
Lead already knows pillar context and passes relevant information when delegating.
The delegate's task description includes pillar context naturally.

**(C) A separate agent instance per pillar** — each pillar gets its own persistent agent
that maintains state across conversations. This is heavier but allows pillar-specific
memory and specialization.

**Recommendation:** Option B for PoC. The MissionLeadAgent already has full pillar
context and passes it to specialists via delegation. Creating per-pillar agent instances
(option C) adds significant complexity for unclear benefit at this stage. The system
prompt's `## Current Pillar` context block (already implemented in mission-lead.ts
lines 138-157) gives the Mission Lead everything it needs to delegate intelligently.

**If Option A is desired:** Add a `pillar-worker` template to `src/agents/registry.ts`
with a system prompt that focuses on executing within a pillar's scope. The Mission
Lead would delegate to `pillar-worker` with the pillar context. This is a ~30-line
addition to the registry.

### Hole 2: TODO Execution Conversation Routing

**Context:** TODOs have a `conversationId` field that links to the worker agent's
execution log. When a worker agent executes a TODO, it creates a conversation.

**The question:** What metadata does this conversation get? If it gets
`channel: 'pillar'` or `channel: 'todo'`, the routing function would send user
messages to MissionLeadAgent. But TODO execution conversations are worker agent
execution logs — should the user be able to intervene in a running TODO via chat?

**Options:**
**(A) Route to MissionLeadAgent with `channel: 'todo'`** — User messages in a TODO
execution chat go to Mission Lead, which can then relay instructions to the running
worker or decide to cancel/redirect the task.

**(B) Route to the assigned worker agent directly** — Harder to implement since worker
agents are ephemeral (created per task). Would need to keep the worker alive and
listening for user input.

**(C) Read-only during execution, intervene via pillar chat** — TODO execution
conversations are view-only logs. If the user wants to intervene, they message in
the pillar chat: "Stop the webpack profiling task and focus on..."

**Recommendation:** Option C for PoC. Keep TODO execution conversations as read-only
logs. User intervention flows through the pillar or mission chat, which is the
single point of human-in-the-loop control (consistent with design decision #5 in
`mission-feature-design.md`). This avoids the complexity of routing messages to
ephemeral worker agents.

### Hole 3: Conversation Lifecycle for TODO Execution

**Context:** Who creates the TODO execution conversation? When?

**Current state:** `MissionTodo.conversationId` is `null` until execution starts.
The Mission Manager's TODO dispatch logic needs to:
1. Create a conversation with appropriate metadata
2. Set `conversationId` on the TODO
3. Route the worker's execution output to that conversation

**This is Mission Manager orchestration logic**, not embedded chat logic. The embedded
chat plan assumes the `conversationId` already exists when the TodoExecution component
renders. If it's null, the component shows "Awaiting execution" instead of a chat panel.

---

## Implementation Order

| Step | Description | Files Changed | Depends On |
|---|---|---|---|
| 1 | Conversation subscription system | `useConversationSubscription.js` (new), `App.websocket.js` (modify) | — |
| 2 | MissionChat component | `MissionChat.jsx` (new) | Step 1 |
| 3 | Integrate into Mission views | `App.Mission.jsx` (modify) | Step 2 |
| 4 | Wire WebSocket to Mission mode | `App.jsx` (modify) | Step 3 |
| 5 | CSS polish | `App.jsx` or CSS file (modify) | Step 2 |

Steps 1-2 can be developed in parallel. Steps 3-4 are integration. Step 5 is polish.

**Not in scope of this plan (already implemented):**
- MissionLeadAgent class + system prompt
- Server-side message routing (conversationChannelCache)
- Pillar-scoped vs mission-scoped context injection
- Mission/pillar conversation creation with metadata
- DB filtering to hide mission conversations from sidebar
- Mission REST API endpoints
