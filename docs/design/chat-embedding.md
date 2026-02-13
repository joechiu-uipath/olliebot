# Chat Embedding Design

> **Status:** Implemented (v1) — Feb 2026
>
> **Files:**
> - `web/src/components/mission/MissionChat.jsx` — embedded chat component
> - `web/src/hooks/useConversationSubscription.js` — pub-sub for multi-conversation WebSocket
> - `web/src/App.jsx` — wiring (dispatch + sendMessage passthrough)
> - `web/src/App.Mission.jsx` — integration into mission/pillar/todo views
> - `web/src/styles.css` — `.mission-chat-*` styles

---

## 1. Problem Statement

OllieBot's primary chat is a full-screen, single-conversation experience. But several
features need **secondary conversations embedded inside other UI panels**:

- **Mission mode:** Mission Lead conversation embedded in the mission dashboard
- **Pillar mode:** Per-pillar conversations embedded in pillar detail views
- **TODO execution:** Task execution logs displayed inline (read-only or interactive)
- **Future:** RAG project chat, evaluation chat, settings assistant, etc.

The core challenge: the frontend was designed around a single `currentConversationId`.
WebSocket events were filtered to only that conversation. Embedding a chat panel requires
receiving events for a *different* conversation simultaneously.

---

## 2. Architecture

### 2.1 Conversation Subscription System

```
┌─────────────────────────────────────────┐
│ WebSocket.onMessage(data)               │
│                                         │
│  combinedMessageHandler:                │
│    1. dispatch(data)   ← NEW            │
│    2. handleMessage(data)  ← existing   │
│    3. logsHandler(data)    ← existing   │
│                                         │
│  dispatch routes to:                    │
│    subscriptions Map<convId, Set<cb>>   │
│                                         │
│    convId_A → [MissionChat cb]          │
│    convId_B → [PillarChat cb]           │
│    convId_C → [TodoExecution cb]        │
│                                         │
│  handleMessage still filters to:        │
│    currentConversationId only           │
└─────────────────────────────────────────┘
```

**Key principle:** The subscription dispatch happens *before* the main handler's
`isForCurrentConversation()` check. This means embedded chats receive events even
when the main chat is on a different conversation. The two systems are fully independent.

### 2.2 Component Model

```
<MissionChat
  conversationId={string}       // Required: which conversation to display
  contextLabel={string}         // Header label (default: "Chat")
  placeholder={string}          // Input placeholder (default: "Type a message...")
  sendMessage={Function}        // WebSocket sendMessage from useWebSocket
  subscribe={Function}          // subscribe(convId, cb) from useConversationSubscription
  readOnly={boolean}            // Hide input (default: false)
  defaultExpanded={boolean}     // Initial expand state (default: true)
/>
```

MissionChat is **self-contained** — it manages its own:
- Message state (loaded from REST, updated by subscription)
- Streaming state (tracks active stream)
- Scroll state (auto-scroll when at bottom)
- Expand/collapse state (with new-message badge when collapsed)
- Input state (local textarea, no parent re-renders)

### 2.3 Data Flow

```
User types in embedded chat
  │
  ├── Optimistic add to local messages[]
  │
  ├── sendMessage({ type: 'message', conversationId, content })
  │     → WebSocket → Server → MissionLeadAgent
  │
  ├── Server streams response → WebSocket → dispatch()
  │     → subscription callback → setMessages()
  │
  └── Rendered in embedded panel (auto-scroll)
```

---

## 3. Current API

### 3.1 `useConversationSubscription()`

**Returns:** `{ subscribe, dispatch, hasSubscribers }`

| Method | Signature | Description |
|---|---|---|
| `subscribe` | `(conversationId: string, callback: (data) => void) => unsubscribe` | Register a callback for events on a conversation. Returns cleanup function. |
| `dispatch` | `(data: WSEvent) => boolean` | Route a WebSocket event to subscribers. Returns true if any subscriber was notified. |
| `hasSubscribers` | `(conversationId: string) => boolean` | Check if any subscribers exist for a conversation. |

**Supported event types (CONVERSATION_SCOPED_TYPES):**
`message`, `stream_start`, `stream_chunk`, `stream_end`, `stream_resume`, `error`,
`tool_requested`, `tool_execution_finished`, `tool_progress`, `tool_resume`,
`delegation`, `task_run`

### 3.2 `<MissionChat />`

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `conversationId` | `string` | *required* | Conversation to display. Returns null if falsy. |
| `contextLabel` | `string` | `'Chat'` | Header label. |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder. |
| `sendMessage` | `Function` | *required* | WebSocket send function. |
| `subscribe` | `Function` | *required* | Subscription function from `useConversationSubscription`. |
| `readOnly` | `boolean` | `false` | If true, hides the input area. |
| `defaultExpanded` | `boolean` | `true` | Initial collapse state. |

**Events handled:**
- `message` — non-streaming full message
- `stream_start` / `stream_chunk` / `stream_end` — streaming response
- `error` — error message display
- `tool_requested` / `tool_execution_finished` — tool usage indicators
- `delegation` — delegation to specialist agent

### 3.3 CSS Classes

All styles are prefixed `.mission-chat-*`:

| Class | Purpose |
|---|---|
| `.mission-chat-panel` | Root container (flex-shrink: 0, border-top) |
| `.mission-chat-panel.expanded` | Expanded state (max-height: 380px) |
| `.mission-chat-panel.collapsed` | Collapsed state (header only) |
| `.mission-chat-header` | Clickable header bar |
| `.mission-chat-badge` | New message count badge |
| `.mission-chat-streaming-dot` | Pulsing dot during streaming |
| `.mission-chat-messages` | Scrollable message area |
| `.mission-chat-msg.{user,assistant,tool,delegation}` | Message role variants |
| `.mission-chat-input-wrapper` | Input + send button row |

---

## 4. Current Usage

### Mission View
```jsx
<MissionChat
  conversationId={selectedMission.conversationId}
  contextLabel="Mission Chat"
  placeholder="Message the Mission Lead..."
  sendMessage={sendMessage}
  subscribe={subscribe}
/>
```

### Pillar View
```jsx
<MissionChat
  conversationId={selectedPillar.conversationId}
  contextLabel={`${selectedPillar.name} Chat`}
  placeholder={`Message about ${selectedPillar.name}...`}
  sendMessage={sendMessage}
  subscribe={subscribe}
/>
```

### TODO Execution (read-only for completed)
```jsx
<MissionChat
  conversationId={todo.conversationId}
  contextLabel="Task Execution"
  readOnly={todo.status === 'completed'}
  defaultExpanded={true}
  sendMessage={sendMessage}
  subscribe={subscribe}
/>
```

---

## 5. Improvement Plan

### Phase 1: Generalize Component (rename + decouple from mission)

**Goal:** Make the embedded chat a first-class reusable component, not mission-specific.

| Item | Description | Effort |
|---|---|---|
| **Rename to `EmbeddedChat`** | Move from `components/mission/MissionChat.jsx` to `components/EmbeddedChat.jsx`. Rename CSS classes from `mission-chat-*` to `embedded-chat-*`. Update imports in `App.Mission.jsx`. | S |
| **Extract CSS to own file** | Move `.embedded-chat-*` styles to `components/EmbeddedChat.css` (or co-located CSS module). Currently mixed into the 7000-line `styles.css` monolith. | S |
| **Remove MessageContent dependency** | Currently imports `MessageContent` for markdown rendering. Add a `renderMessage` render-prop so callers can customize rendering. Default to `MessageContent` but allow overrides. | M |
| **Add `className` prop** | Allow callers to add custom class names for theme/layout overrides. | S |

### Phase 2: Feature Parity with Main Chat

**Goal:** Bring embedded chat feature parity closer to the main chat.

| Item | Description | Effort |
|---|---|---|
| **Attachments support** | Allow file/image attachments in embedded chat input (currently text-only). Requires passing attachment handling callbacks. | M |
| **Cursor-based pagination** | When scrolling up, load older messages via REST cursor API. Currently loads only the most recent 30 messages. | M |
| **Stream resume** | Handle `stream_resume` events when switching back to a view with an active stream. Currently only handles `stream_start/chunk/end`. | S |
| **Tool progress** | Show progress bars for long-running tools (web scraping, browser, etc.). Currently shows running/completed status only. | S |
| **Reasoning mode support** | Support extended thinking / reasoning mode in embedded chat input. Currently sends plain messages only. | M |
| **Agent command triggers** | Support `#Deep Research`, `#Modify` and other command triggers in embedded chat. | M |

### Phase 3: Layout Flexibility

**Goal:** Support multiple layout modes beyond the current bottom-pinned panel.

| Item | Description | Effort |
|---|---|---|
| **Resizable panel** | Add drag handle to resize chat panel height. Currently fixed max-height: 380px. | M |
| **Side panel mode** | Support rendering as a side panel (e.g., right-docked) instead of bottom-docked. Add `position` prop: `'bottom' | 'right' | 'inline'`. | M |
| **Full-screen mode** | Allow expanding to full-screen overlay (useful for deep conversation review). | S |
| **Detached window** | Pop out into a separate browser window (using `window.open` with shared state). | L |

### Phase 4: Multi-Chat & State Management

**Goal:** Support complex multi-chat scenarios and shared state.

| Item | Description | Effort |
|---|---|---|
| **Conversation context provider** | Create `<ConversationProvider conversationId={...}>` that wraps subscription + state. Child components can use `useConversation()` to access messages, streaming state, send function. Eliminates prop drilling. | L |
| **Shared typing indicators** | When user is typing in any embedded chat, show a typing indicator on the server side (for multi-user scenarios). | M |
| **Cross-chat references** | Allow agent to reference messages from other conversations (e.g., "As discussed in the Build Performance chat..."). Requires message ID cross-referencing. | L |
| **Chat registry** | Centralized registry of all active embedded chats. Enables features like "jump to chat" navigation, global search across all mission chats, and activity overview. | M |

### Phase 5: Codebase Maintainability

**Goal:** Reduce complexity and improve testability.

| Item | Description | Effort |
|---|---|---|
| **Extract main chat to `EmbeddedChat`** | Refactor the 2300-line `App.jsx` main chat to use the same `EmbeddedChat` component internally. The main chat becomes just another subscriber with extra features (virtualized scroll, pagination). This is the single highest-impact refactor for maintainability. | XL |
| **Typed WebSocket protocol** | Define TypeScript types for all WebSocket event types. Currently the event payloads are untyped `data` objects throughout. | M |
| **Storybook stories** | Add Storybook stories for EmbeddedChat in various states: empty, loading, streaming, read-only, collapsed with badge. Enables visual testing without running the full app. | M |
| **Unit tests** | Test `useConversationSubscription` in isolation (subscribe/dispatch/cleanup). Test `EmbeddedChat` with mock WebSocket events. | M |
| **Split styles.css** | Break the 7000-line monolith `styles.css` into per-component CSS files. CSS modules or co-located `.css` files. | L |

---

## 6. Priority Recommendations

For the next iteration, focus on:

1. **Rename to EmbeddedChat** (Phase 1) — Sets the right abstraction boundary. Low effort, high signal.
2. **Cursor-based pagination** (Phase 2) — Users will hit the 30-message limit quickly in active conversations.
3. **Extract CSS** (Phase 1) — Prevents the `styles.css` monolith from growing further.
4. **Conversation context provider** (Phase 4) — Eliminates the `sendMessage` + `subscribe` prop drilling that will become painful as more UIs embed chat.

The long-term goal (Phase 5, item 1) of making the main chat also use `EmbeddedChat`
internally would be the single biggest maintainability win — it unifies two parallel
message-rendering codepaths into one.
