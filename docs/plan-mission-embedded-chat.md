# Plan: Embedded Chat Panel for Mission Tab

## Why This Matters

The embedded chat is the **only way users can influence mission direction**. Without it,
missions are fully autonomous with zero human steering. The design doc (sections 3.4, 5.4,
5.5) defines four specific use cases:

1. **Intervene:** "Pause work on build performance, focus on onboarding"
2. **Guide:** "We're migrating to Vite next month, factor that in"
3. **Review:** "Why did you prioritize this TODO over that one?"
4. **Override:** Manually reprioritize TODOs, modify strategies, adjust metric targets

All of these flow through conversation with the Mission Lead agent, scoped to the
appropriate `conversationId` (mission-level or pillar-level).

---

## Architecture Analysis

### What Already Exists

| Component | Status | Notes |
|---|---|---|
| `conversationId` on missions | Done | Created at mission bootstrap in `manager.ts` |
| `conversationId` on pillars | Done | Created at pillar bootstrap in `manager.ts` |
| `conversations` table rows | Done | INSERT at creation time |
| `messages` table + pagination | Done | `GET /api/conversations/:id/messages` with cursor pagination |
| `ChatInput` component | Done | Fully reusable — accepts `onSubmit(text)` |
| `MessageContent` component | Done | Fully reusable — accepts `content` string + options |
| WebSocket `sendMessage` | Done | Sends `{ type: 'message', conversationId, content }` |
| Server-side conversation routing | Done | `SupervisorAgent.handleMessage` extracts `conversationId` from metadata |
| Stream handling (start/chunk/end) | Done | Conversation-scoped in `App.websocket.js` |

### The Gap: Multi-Conversation WebSocket Routing

Currently, the app has **one active conversationId** at a time (`currentConversationId`
in App.jsx). The message handler in `App.websocket.js` filters all incoming WebSocket
events against this single ID via `isForCurrentConversation()`.

The mission embedded chat needs to receive streaming events for a **different**
conversationId (the mission's or pillar's) while the main chat may have its own.

---

## Implementation Plan

### Step 1: WebSocket Conversation Subscription System

**File:** `web/src/hooks/useConversationSubscription.js` (new)

Create a lightweight pub-sub layer that allows multiple components to subscribe to
WebSocket events for specific conversationIds.

```
┌─────────────────────────────────────┐
│ WebSocket onMessage                  │
│                                      │
│  Incoming event (with conversationId)│
│         │                            │
│         ▼                            │
│  ┌─────────────────────┐            │
│  │ ConversationRouter   │            │
│  │                      │            │
│  │  subscriptions:      │            │
│  │    convId_A → [cb1]  │ ← Main Chat tab
│  │    convId_B → [cb2]  │ ← Mission embedded chat
│  │    convId_C → [cb3]  │ ← Pillar embedded chat
│  │                      │            │
│  └─────────────────────┘            │
└─────────────────────────────────────┘
```

**API:**
```js
const { subscribe, unsubscribe } = useConversationRouter();

// Component mounts:
subscribe(conversationId, (event) => {
  // event: { type: 'message' | 'stream_start' | 'stream_chunk' | 'stream_end', ... }
});

// Component unmounts:
unsubscribe(conversationId);
```

**Integration point:** The existing `createMessageHandler` in `App.websocket.js` gains
one new line: for conversation-scoped events, also dispatch to any registered subscribers
for that conversationId (in addition to the existing main-chat handling).

This is a **minimal, backward-compatible change** — the main Chat tab continues to work
exactly as before. Mission chat components simply register as additional listeners.

### Step 2: MissionChat Component

**File:** `web/src/components/MissionChat.jsx` (new)

A reusable embedded chat panel that:
- Takes `conversationId` and `contextLabel` as props
- Loads message history via REST (`GET /api/conversations/:id/messages`)
- Renders messages with `MessageContent`
- Sends new messages via the existing WebSocket `sendMessage`
- Receives streaming responses via the subscription system from Step 1
- Supports collapse/expand (default: collapsed to single-line bar)
- Shows typing/streaming indicator during response
- Auto-scrolls on new messages

**Layout (from design doc section 5.4):**
```
│──────────────────────────────────────────────────────────│
│  💬 Mission Chat                                 [▲ ▼]   │
│  ┌──────────────────────────────────────────────────────┐│
│  │  You: Focus more on onboarding this sprint           ││
│  │  Lead: Understood. I'll reprioritize...              ││
│  │                                                      ││
│  │  [Type a message to the Mission Lead...]    [Send]   ││
│  └──────────────────────────────────────────────────────┘│
```

**Props:**
```js
<MissionChat
  conversationId={selectedMission.conversationId}
  contextLabel="Mission Chat"
  placeholder="Type a message to the Mission Lead..."
  sendMessage={sendMessage}          // from useWebSocket
  readOnly={false}                   // true for completed task execution
  defaultExpanded={false}            // collapsed by default
/>
```

**Key behaviors:**
- Only loads messages when expanded (lazy loading)
- Cursor-based pagination: scrolling up loads older messages
- Shows a "new messages" indicator when collapsed and a response arrives
- Streams tokens in real-time (same visual as main Chat tab)
- Focus trap: Enter sends, Shift+Enter for newlines (matches ChatInput)

### Step 3: Integrate into Mission Views

**File:** `web/src/App.Mission.jsx` (modify)

**Mission view** — add MissionChat below the tab content:
```jsx
// In MissionMainContent, mission view section:
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
  />
</div>
```

**Pillar view** — add MissionChat scoped to pillar conversation:
```jsx
// In MissionMainContent, pillar view section:
<div className="mission-content">
  <div className="mission-breadcrumb">...</div>
  <div className="mission-tabs">...</div>
  <div className="mission-tab-content">
    {/* existing tab content */}
  </div>
  <MissionChat
    conversationId={selectedPillar.conversationId}
    contextLabel={`${selectedPillar.name} Chat`}
    placeholder={`Message about ${selectedPillar.name}...`}
    sendMessage={sendMessage}
  />
</div>
```

**Task Execution view** — replace placeholder with full chat:
```jsx
// In TodoExecution:
<MissionChat
  conversationId={todo.conversationId}
  contextLabel="Task Execution Log"
  placeholder="Intervene in this task..."
  sendMessage={sendMessage}
  readOnly={todo.status === 'completed'}
  defaultExpanded={true}              // expanded by default in execution view
/>
```

### Step 4: Pass WebSocket Dependencies Down

**File:** `web/src/App.jsx` (modify)

The `useMissionMode` hook and MissionMainContent currently don't have access to
`sendMessage` from `useWebSocket`. Two options:

**Option A (recommended for PoC):** Pass `sendMessage` through `missionMode`:
```js
// In App.jsx:
const missionMode = useMissionMode();
// Add sendMessage to the object passed to MissionMainContent:
<MissionMainContent missionMode={{ ...missionMode, sendMessage }} />
```

**Option B (cleaner long-term):** Create a context provider for WebSocket functions.
This avoids prop drilling but adds complexity. Defer to future refactor.

### Step 5: CSS for Embedded Chat Panel

**File:** `web/src/styles.css` (modify)

New styles for the collapsible chat panel:

```css
/* Embedded chat panel — pinned to bottom of mission content */
.mission-chat-panel { ... }
.mission-chat-panel.collapsed { ... }
.mission-chat-header { ... }       /* "💬 Mission Chat  [▲ ▼]" bar */
.mission-chat-messages { ... }     /* Scrollable message area */
.mission-chat-input { ... }        /* ChatInput wrapper */
.mission-chat-streaming { ... }    /* Typing indicator */
.mission-chat-new-badge { ... }    /* "New messages" indicator when collapsed */
```

The panel uses `flex` layout: the `mission-tab-content` gets `flex: 1; min-height: 0`
and the chat panel sits below it with a fixed max-height (resizable via drag handle
in future iteration, fixed 200px for PoC).

---

## Data Flow

```
User types in Mission Chat
       │
       ▼
MissionChat.handleSubmit(text)
       │
       ├── Add user message to local state (optimistic)
       │
       ├── sendMessage({
       │     type: 'message',
       │     conversationId: mission.conversationId,   ← scoped to mission
       │     content: text,
       │   })
       │
       ▼
Server: WebSocketChannel receives message
       │
       ▼
SupervisorAgent.handleMessage(message)
       │
       ├── Extracts conversationId from metadata
       ├── Loads conversation history (mission chat history)
       ├── Saves user message to DB
       │
       ├── Processes with LLM (Mission Lead context)
       │     ├── Mission Lead system prompt
       │     ├── Full mission context (pillars, metrics, todos)
       │     └── Conversation history
       │
       ▼
Stream response back via WebSocket
       │
       ├── stream_start  { conversationId: mission.conversationId }
       ├── stream_chunk   (N times)
       ├── stream_end
       │
       ▼
ConversationRouter dispatches to MissionChat subscriber
       │
       ▼
MissionChat renders streaming response
```

---

## What This Does NOT Cover (Future Work)

1. **Mission Lead agent context injection** — The server-side Mission Lead agent needs
   to be wired up to receive the full mission context (pillars, metrics, strategies,
   todos) when processing messages from a mission conversation. This is agent-layer work,
   separate from the UI.

2. **Pillar-scoped context** — When a message comes from a pillar's conversationId, the
   Mission Lead should scope its context to that pillar. Also agent-layer work.

3. **TODO creation via chat** — Design decision #5 says users create TODOs only through
   conversation. The Mission Lead agent needs tool access to `createTodo`. Agent-layer.

4. **Drag-resizable chat panel** — PoC uses fixed height. Drag handle is a UX polish item.

5. **Chat history search** — Decision #4 notes this as future work.

---

## Implementation Order & Estimates

| Step | Description | Files Changed | Depends On |
|---|---|---|---|
| 1 | Conversation subscription system | `useConversationSubscription.js` (new), `App.websocket.js` (modify) | — |
| 2 | MissionChat component | `MissionChat.jsx` (new), `styles.css` (modify) | Step 1 |
| 3 | Integrate into Mission views | `App.Mission.jsx` (modify) | Step 2 |
| 4 | Pass WebSocket to Mission mode | `App.jsx` (modify) | Step 3 |
| 5 | CSS polish | `styles.css` (modify) | Step 2 |

Steps 1-2 can be developed in parallel. Steps 3-4 are integration. Step 5 is polish.
