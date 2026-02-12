# Tasks & Events Tab — UI and System Architecture

## Overview

A new top-level "Tasks & Events" mode (alongside Chat and Eval) that consolidates scheduled tasks and external event subscriptions into a dedicated management interface.

**Layout**: Split-pane — accordion navigation on the left, detail/edit panel on the right.

---

## Part 1: UI Architecture

### 1.1 Mode Switcher

Add a third mode button to the existing mode switcher in the header:

```
┌─────────────────────────────────────────────────────┐
│  🤖 OllieBot     [💬 Chat] [📋 Tasks & Events] [📊 Eval]  │
└─────────────────────────────────────────────────────┘
```

Route: `/tasks` (new)

```jsx
// Mode definitions
const MODES = {
  CHAT: 'chat',
  TASKS: 'tasks',    // NEW
  EVAL: 'eval',
};

// In mode-switcher
<button
  className={`mode-btn ${mode === MODES.TASKS ? 'active' : ''}`}
  onClick={() => navigate('/tasks')}
>
  <span className="mode-icon">📋</span>
  Tasks & Events
</button>
```

### 1.2 Split-Pane Layout

When mode is `TASKS`, render a split pane instead of the chat container:

```
┌──────────────────────────────────────────────────────────────┐
│ Header: 🤖 OllieBot    [💬 Chat] [📋 Tasks & Events] [📊 Eval]      │
├───────────────┬──────────────────────────────────────────────┤
│ LEFT PANE     │ RIGHT PANE                                   │
│ (280px)       │ (flex: 1)                                    │
│               │                                              │
│ ▼ Agent Tasks │ ┌──────────────────────────────────────────┐ │
│   ● News  ▶   │ │  Hourly News Report                      │ │
│   ● Daily  ▶   │ │                                          │ │
│               │ │  Schedule: 0 * * * *  (every hour)        │ │
│ ▼ Events      │ │  Status:   ● active                      │ │
│   ⚡ IFTTT     │ │  Last run: 2 hours ago                   │ │
│   ⚡ Graph     │ │  Next run: in 38 min                     │ │
│               │ │                                          │ │
│               │ │  ── Handler Prompt ──────────────────── │ │
│               │ │  # Summary                               │ │
│               │ │  Report news every hour.                  │ │
│               │ │  Use web search tools to search for...   │ │
│               │ │                                          │ │
│               │ │  ── JSON Config ─────────────────────── │ │
│               │ │  { "name": "Hourly News Report", ... }   │ │
│               │ │                                          │ │
│               │ │  [Run Now]  [Edit]  [Pause]  [Delete]   │ │
│               │ └──────────────────────────────────────────┘ │
├───────────────┴──────────────────────────────────────────────┤
```

### 1.3 Left Pane — Accordion Navigation

Two accordions, following the existing accordion pattern exactly:

```jsx
<div className="tasks-events-sidebar">
  {/* Agent Tasks Accordion — moved here AS-IS from chat sidebar */}
  <div className="accordion">
    <button className={`accordion-header ${expandedAccordions.tasks ? 'expanded' : ''}`}
            onClick={() => toggleAccordion('tasks')}>
      <span className="accordion-icon">📋</span>
      <span className="accordion-title">Agent Tasks</span>
      <span className="accordion-arrow">{expandedAccordions.tasks ? '▼' : '▶'}</span>
    </button>
    {expandedAccordions.tasks && (
      <div className="accordion-content">
        {agentTasks.map(task => (
          <div key={task.id}
               className={`accordion-item task-item ${selectedItem?.id === task.id ? 'selected' : ''}`}
               onClick={() => selectItem({ type: 'task', ...task })}>
            <span className={`task-status ${task.status}`}>●</span>
            <span className="task-name">{task.name}</span>
            {nextRunDisplay && <span className="task-next-run">{nextRunDisplay}</span>}
            <button className="task-run-btn"
                    onClick={(e) => { e.stopPropagation(); handleRunTask(task.id); }}
                    title="Run now">▶</button>
          </div>
        ))}
        <button className="accordion-add-btn" onClick={() => selectItem({ type: 'task', isNew: true })}>
          + Add Task
        </button>
      </div>
    )}
  </div>

  {/* Events Accordion — NEW */}
  <div className="accordion">
    <button className={`accordion-header ${expandedAccordions.events ? 'expanded' : ''}`}
            onClick={() => toggleAccordion('events')}>
      <span className="accordion-icon">⚡</span>
      <span className="accordion-title">Events</span>
      <span className="accordion-arrow">{expandedAccordions.events ? '▼' : '▶'}</span>
    </button>
    {expandedAccordions.events && (
      <div className="accordion-content">
        {agentEvents.map(event => (
          <div key={event.id}
               className={`accordion-item event-item ${selectedItem?.id === event.id ? 'selected' : ''}`}
               onClick={() => selectItem({ type: 'event', ...event })}>
            <span className={`event-status ${event.status}`}>●</span>
            <span className="event-source-icon">{sourceIcons[event.source]}</span>
            <span className="event-name">{event.name}</span>
          </div>
        ))}
        <button className="accordion-add-btn" onClick={() => selectItem({ type: 'event', isNew: true })}>
          + Add Event
        </button>
      </div>
    )}
  </div>
</div>
```

### 1.4 Right Pane — Detail/Edit Panel

The right pane renders contextually based on what is selected in the left pane.

**States:**
1. **Nothing selected** → Welcome/empty state with guidance
2. **Task selected** → Task detail view (read mode)
3. **Event selected** → Event detail view (read mode)
4. **New task** → Task creation form
5. **New event** → Event creation form
6. **Edit mode** → In-place editing of selected item

#### Task Detail View

```
┌──────────────────────────────────────────────────────┐
│ Hourly News Report                          [Edit]   │
│                                                      │
│ Schedule     0 * * * *  (every hour)                 │
│ Status       ● active                                │
│ Last run     Feb 12, 2026 3:00 PM (2 hours ago)      │
│ Next run     Feb 12, 2026 4:00 PM (in 38 min)        │
│                                                      │
│ ── Handler Prompt ─────────────────────────────────  │
│ ┌──────────────────────────────────────────────────┐ │
│ │ # Summary                                        │ │
│ │ Report news every hour.                          │ │
│ │ Use web search tools to search for top news.     │ │
│ │ And then use web scrape tool to obtain summary...│ │
│ │                                                  │ │
│ │ ## Output                                        │ │
│ │ A concise list of bullets containing both...     │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ── Allowed Tools ──────────────────────────────────  │
│ Skills: web_search, web_scrape, summarize            │
│ MCPs: (none)                                         │
│                                                      │
│ [▶ Run Now]     [⏸ Pause]     [🗑 Delete]            │
└──────────────────────────────────────────────────────┘
```

#### Event Detail View

```
┌──────────────────────────────────────────────────────┐
│ IFTTT: Smart Home Motion Alert              [Edit]   │
│                                                      │
│ Source       IFTTT                                    │
│ Endpoint     /api/webhooks/ifttt/motion-alert        │
│ Status       ● active                                │
│ Last fired   Feb 12, 2026 2:15 PM                    │
│ Total fires  47                                      │
│                                                      │
│ ── Handler Prompt ─────────────────────────────────  │
│ ┌──────────────────────────────────────────────────┐ │
│ │ # Smart Home Motion Alert Handler                │ │
│ │                                                  │ │
│ │ When motion is detected at the front door:       │ │
│ │ 1. Log the event with timestamp                  │ │
│ │ 2. Check if it's during "away" hours (9am-5pm)   │ │
│ │ 3. If during away hours, send me a notification  │ │
│ │    in the Feed conversation                      │ │
│ │ 4. Include the IFTTT payload data in the message │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ── Allowed Tools ──────────────────────────────────  │
│ Skills: chat.messaging                               │
│ MCPs: (none)                                         │
│                                                      │
│ ── Sample Payload ─────────────────────────────────  │
│ { "source": "ifttt", "event_type": "motion", ... }   │
│                                                      │
│ [⚡ Test]     [⏸ Pause]     [🗑 Delete]              │
└──────────────────────────────────────────────────────┘
```

#### Event Edit/Create Form

```
┌──────────────────────────────────────────────────────┐
│ New Event                           [Save] [Cancel]  │
│                                                      │
│ Name         [_________________________________]     │
│                                                      │
│ Source       [IFTTT ▾]                               │
│              Options: IFTTT, Microsoft Graph,        │
│              GitHub, Slack, Custom Webhook            │
│                                                      │
│ ── Source-Specific Config ─────────────────────────  │
│                                                      │
│ (for IFTTT:)                                         │
│ Event Key    [motion-alert___________________]       │
│ Auth Secret  [••••••••••••] [Generate] [Copy URL]    │
│ Webhook URL  https://webhooks.example.com            │
│              /api/webhooks/ifttt/motion-alert         │
│              [📋 Copy]                                │
│                                                      │
│ (for Microsoft Graph:)                               │
│ Resource     [me/mailFolders('Inbox')/messages ▾]    │
│ Change Types [☑ created] [☑ updated] [☐ deleted]    │
│ OAuth Status Connected as joe@example.com [Reconnect]│
│                                                      │
│ ── Handler Prompt ─────────────────────────────────  │
│ ┌──────────────────────────────────────────────────┐ │
│ │  (Markdown editor — full height, monospace)      │ │
│ │                                                  │ │
│ │  Write natural language instructions for how     │ │
│ │  OllieBot should handle this event when it       │ │
│ │  fires...                                        │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ── Allowed Tools ──────────────────────────────────  │
│ Skills  [☑ chat.messaging] [☐ web_search] [☐ ...]   │
│ MCPs    [☐ github] [☐ slack] [☐ ...]                │
│                                                      │
│ [Save]  [Cancel]                                     │
└──────────────────────────────────────────────────────┘
```

### 1.5 Chat Sidebar Change

**Remove** the Agent Tasks accordion from the chat sidebar. In its place, add a quick-link:

```jsx
{/* In chat sidebar, where Agent Tasks accordion used to be */}
<div className="sidebar-quick-link" onClick={() => navigate('/tasks')}>
  <span className="accordion-icon">📋</span>
  <span>Tasks & Events</span>
  <span className="quick-link-count">{agentTasks.length + agentEvents.length}</span>
  <span className="accordion-arrow">→</span>
</div>
```

This preserves discoverability without duplicating the UI.

---

## Part 2: Component Structure

### New Components

```
web/src/components/
├── TasksAndEvents/
│   ├── TasksAndEventsPage.jsx      # Top-level split-pane layout
│   ├── TasksEventsSidebar.jsx      # Left pane: two accordions
│   ├── TaskDetailPanel.jsx         # Right pane: task view/edit
│   ├── EventDetailPanel.jsx        # Right pane: event view/edit
│   ├── EventForm.jsx               # Event creation/edit form
│   ├── TaskForm.jsx                # Task creation/edit form
│   ├── EmptyState.jsx              # Nothing-selected placeholder
│   └── SourceConfig/
│       ├── IFTTTConfig.jsx         # IFTTT-specific form fields
│       ├── GraphConfig.jsx         # Microsoft Graph-specific fields
│       ├── GitHubConfig.jsx        # GitHub webhook fields
│       ├── SlackConfig.jsx         # Slack Events API fields
│       └── CustomWebhookConfig.jsx # Generic webhook fields
```

### State

```jsx
// In App.jsx (or a context/hook)
const [agentEvents, setAgentEvents] = useState([]);
const [selectedTaskOrEvent, setSelectedTaskOrEvent] = useState(null);
// selectedTaskOrEvent = { type: 'task'|'event', id: string, isNew?: boolean, isEditing?: boolean }

// expandedAccordions gains 'events' key
const [expandedAccordions, setExpandedAccordions] = useState({
  tasks: true,    // Default open in tasks mode
  events: true,   // Default open in tasks mode
  skills: false,
  mcps: false,
  tools: false,
  computerUse: false,
  ragProjects: false,
});
```

---

## Part 3: Event Configuration — File Format

### Storage Location

```
user/events/
├── ifttt-motion-alert.md         # Handler prompt
├── ifttt-motion-alert.json       # Machine-readable config
├── graph-inbox-monitor.md        # Handler prompt
├── graph-inbox-monitor.json      # Machine-readable config
└── github-pr-review.md           # Handler prompt
```

Follows the same `.md` + `.json` pair pattern as `user/tasks/`.

### Event Handler Markdown (`.md`)

The `.md` file contains a **natural language prompt** that instructs OllieBot how to handle the incoming webhook. This is the "pre-configured prompt" that pairs with the webhook payload (acting as tool call results).

```markdown
# Smart Home Motion Alert Handler

## When this event fires

Motion detected at front door (via SmartThings → IFTTT).

## How to handle

1. Log the event with timestamp and sensor name from the payload
2. Check the current time:
   - If between 9:00 AM and 5:00 PM (weekdays) → "away hours", proceed to step 3
   - Otherwise → log only, no notification
3. During away hours:
   - Send a notification to my Feed conversation
   - Format: "🚨 Motion detected at front door at {time}"
   - Include any camera snapshot URL if present in the payload

## What NOT to do

- Do not trigger any smart home actions (lights, locks)
- Do not send notifications during night hours (10 PM - 7 AM)
```

### Event Config JSON (`.json`)

```json
{
  "name": "Smart Home Motion Alert",
  "description": "Handles motion detection events from front door sensor via IFTTT",
  "source": {
    "type": "ifttt",
    "config": {
      "eventKey": "motion-alert",
      "authSecret": "sha256:a1b2c3d4..."
    }
  },
  "status": "active",
  "skills": {
    "whitelist": ["chat.messaging"],
    "blacklist": []
  },
  "mcp": {
    "whitelist": [],
    "blacklist": []
  },
  "notifications": {
    "onSuccess": false,
    "onError": true,
    "channels": ["chat"]
  },
  "stats": {
    "totalFires": 47,
    "lastFired": "2026-02-12T14:15:00Z",
    "lastError": null
  }
}
```

### Source-Specific Config Variants

**IFTTT:**
```json
{
  "source": {
    "type": "ifttt",
    "config": {
      "eventKey": "motion-alert",
      "authSecret": "sha256:abc123..."
    }
  }
}
```
Webhook URL derived: `/api/webhooks/ifttt/{eventKey}`

**Microsoft Graph:**
```json
{
  "source": {
    "type": "graph",
    "config": {
      "resource": "me/mailFolders('Inbox')/messages",
      "changeTypes": ["created", "updated"],
      "subscriptionId": "guid-from-graph",
      "expirationDateTime": "2026-02-15T00:00:00Z",
      "clientState": "random-secret",
      "includeResourceData": false
    }
  }
}
```
Webhook URL: `/api/webhooks/graph` (shared, routed by subscriptionId)

**GitHub:**
```json
{
  "source": {
    "type": "github",
    "config": {
      "events": ["pull_request", "issue_comment"],
      "repository": "owner/repo",
      "webhookSecret": "sha256:..."
    }
  }
}
```
Webhook URL: `/api/webhooks/github`

**Custom Webhook:**
```json
{
  "source": {
    "type": "custom",
    "config": {
      "endpointKey": "my-custom-hook",
      "authType": "header",
      "authHeader": "X-Custom-Secret",
      "authSecret": "sha256:..."
    }
  }
}
```
Webhook URL: `/api/webhooks/custom/{endpointKey}`

---

## Part 4: System Architecture — Event Processing Pipeline

### 4.1 The Core Insight

> Handling an incoming webhook is like running a pre-configured prompt + tool call where:
> - The **handler prompt** (from `.md`) is the system instruction
> - The **webhook payload** acts as the tool call result (the input data)
> - The **allowed tools** (from `.json` config) are the tools at the handler's disposal

This maps directly to a supervisor call:

```
supervisor.handleMessage({
  role: 'user',
  content: `
    EVENT HANDLER EXECUTION

    ## Handler Instructions
    ${event.mdContent}

    ## Incoming Event Data
    Source: ${event.source.type}
    Received at: ${timestamp}

    Payload:
    ${JSON.stringify(payload, null, 2)}
  `,
  metadata: {
    type: 'event_handler',
    eventId: event.id,
    eventName: event.name,
    source: event.source.type,
    allowedSkills: event.skills.whitelist,
    allowedMcps: event.mcp.whitelist,
  }
})
```

### 4.2 EventManager Service

New service following the TaskManager pattern:

```
src/events/
├── manager.ts          # EventManager — mirrors TaskManager
├── webhook-router.ts   # Express middleware for /api/webhooks/*
└── sources/
    ├── ifttt.ts        # IFTTT auth validation & payload normalization
    ├── graph.ts        # Graph subscription lifecycle & clientState verification
    ├── github.ts       # HMAC-SHA256 signature verification
    ├── slack.ts        # Slack signing secret verification + challenge response
    └── custom.ts       # Custom header/token auth
```

### 4.3 EventManager

```typescript
// src/events/manager.ts
export interface EventConfig {
  id: string;
  name: string;
  mdFile: string;
  mdContent: string;
  jsonConfig: {
    source: { type: string; config: Record<string, unknown> };
    status: 'active' | 'paused';
    skills: { whitelist: string[]; blacklist: string[] };
    mcp: { whitelist: string[]; blacklist: string[] };
    stats: { totalFires: number; lastFired: string | null; lastError: string | null };
  };
}

export class EventManager extends EventEmitter {
  private configWatcher: ConfigWatcher;
  private llmService: LLMService;
  private eventsDir: string;

  constructor(config: { eventsDir: string; llmService: LLMService }) {
    super();
    this.eventsDir = config.eventsDir;
    this.llmService = config.llmService;
    this.configWatcher = new ConfigWatcher(config.eventsDir);
  }

  // Same init pattern as TaskManager:
  // - Watches user/events/ for .md files
  // - Parses .md → .json via LLM if no .json exists
  // - Syncs to database
  // - Emits 'event:added', 'event:changed', 'event:removed'

  async handleWebhook(source: string, key: string, payload: unknown): Promise<void> {
    // 1. Find matching event config by source type + key
    // 2. Verify authentication (source-specific)
    // 3. Update stats (totalFires, lastFired)
    // 4. Emit 'event:fired' with handler prompt + payload
    // 5. Broadcast to UI via WebSocket
  }

  getEvents(): EventSummary[] {
    // Returns active events for UI display
  }
}
```

### 4.4 Webhook Router

```typescript
// src/events/webhook-router.ts
import { Router } from 'express';

export function createWebhookRouter(eventManager: EventManager): Router {
  const router = Router();

  // IFTTT webhooks: /api/webhooks/ifttt/:eventKey
  router.post('/ifttt/:eventKey', async (req, res) => {
    // Return 200 immediately (IFTTT 12-second timeout)
    res.status(200).json({ received: true });
    // Process async
    await eventManager.handleWebhook('ifttt', req.params.eventKey, req.body);
  });

  // Microsoft Graph: /api/webhooks/graph
  router.post('/graph', async (req, res) => {
    // Handle validation token (subscription creation)
    if (req.query.validationToken) {
      return res.type('text/plain').send(req.query.validationToken);
    }
    // Acknowledge immediately
    res.status(202).send();
    // Process notifications
    for (const notification of req.body.value) {
      await eventManager.handleWebhook('graph', notification.subscriptionId, notification);
    }
  });

  // GitHub: /api/webhooks/github
  router.post('/github', async (req, res) => {
    res.status(200).json({ received: true });
    const event = req.headers['x-github-event'] as string;
    await eventManager.handleWebhook('github', event, req.body);
  });

  // Custom: /api/webhooks/custom/:endpointKey
  router.post('/custom/:endpointKey', async (req, res) => {
    res.status(200).json({ received: true });
    await eventManager.handleWebhook('custom', req.params.endpointKey, req.body);
  });

  return router;
}
```

### 4.5 Event Execution Flow

```
External HTTP POST → /api/webhooks/ifttt/motion-alert
    │
    ▼
Webhook Router
    │ 1. Acknowledge immediately (200 OK)
    │ 2. Dispatch to EventManager.handleWebhook()
    ▼
EventManager.handleWebhook('ifttt', 'motion-alert', payload)
    │ 1. Lookup event config by source + eventKey
    │ 2. Validate auth (check X-OllieBot-Secret header)
    │ 3. Check status === 'active'
    │ 4. Update stats (totalFires++, lastFired = now)
    │ 5. Read handler .md content
    ▼
MessageEventService.emitEventFiredEvent(...)
    │ 1. Create event_fired message (persisted + broadcast to UI)
    │ 2. Returns turnId
    ▼
Supervisor.handleMessage({
    content: "EVENT HANDLER EXECUTION\n\n## Handler Instructions\n{md content}\n\n## Payload\n{JSON}",
    metadata: {
      type: 'event_handler',
      eventId, eventName, source, turnId,
      allowedSkills: [...],
      allowedMcps: [...]
    }
  })
    │
    ▼
Supervisor routes to appropriate agents/tools
    │ (constrained by allowedSkills/allowedMcps from event config)
    ▼
Response broadcast to UI + persisted to DB
```

### 4.6 Database Schema

Add to `src/db/index.ts`:

```typescript
export interface Event {
  id: string;
  name: string;
  mdFile: string;               // Path to handler .md
  jsonConfig: Record<string, unknown>;
  source: string;               // 'ifttt' | 'graph' | 'github' | 'slack' | 'custom'
  status: 'active' | 'paused' | 'error';
  totalFires: number;
  lastFired: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

SQL table:
```sql
CREATE TABLE events (
  id STRING PRIMARY KEY,
  name STRING,
  mdFile STRING,
  jsonConfig STRING,
  source STRING,
  status STRING DEFAULT 'active',
  totalFires INT DEFAULT 0,
  lastFired STRING,
  lastError STRING,
  createdAt STRING,
  updatedAt STRING
)
```

### 4.7 API Routes

```
GET    /api/events                    # List all events
GET    /api/events/:id               # Get single event (with md content)
POST   /api/events                    # Create event (writes .md + .json)
PUT    /api/events/:id               # Update event
DELETE /api/events/:id               # Delete event (removes .md + .json)
POST   /api/events/:id/test          # Fire a test event with sample payload

POST   /api/webhooks/ifttt/:eventKey  # IFTTT incoming
POST   /api/webhooks/graph            # Microsoft Graph incoming
POST   /api/webhooks/github           # GitHub incoming
POST   /api/webhooks/custom/:key      # Custom webhook incoming
```

### 4.8 WebSocket Messages

```typescript
// Event fired (broadcast to UI)
{
  type: 'event_fired',
  eventId: string,
  eventName: string,
  source: string,
  timestamp: string,
  conversationId?: string
}

// Event config updated (hot-reload from file watcher)
{
  type: 'event_updated',
  event: {
    id: string,
    name: string,
    source: string,
    status: string,
    totalFires: number,
    lastFired: string | null
  }
}
```

---

## Part 5: Initialization

In `src/index.ts`, add alongside TaskManager:

```typescript
// Create EventManager
const eventManager = new EventManager({
  eventsDir: path.join(USER_DIR, 'events'),
  llmService,
});
await eventManager.init();

// In server mode: mount webhook router
const webhookRouter = createWebhookRouter(eventManager);
app.use('/api/webhooks', webhookRouter);

// Wire event:fired → supervisor
eventManager.on('event:fired', async ({ event, payload, turnId }) => {
  const message = {
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: buildEventHandlerPrompt(event, payload),
    createdAt: new Date(),
    metadata: {
      type: 'event_handler',
      eventId: event.id,
      eventName: event.name,
      source: event.source,
      turnId,
    },
  };
  await supervisor.handleMessage(message);
});
```

---

## Part 6: CSS

### Left Pane

```css
/* Tasks & Events mode layout */
.tasks-events-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.tasks-events-sidebar {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  padding: 0.5rem;
}

.tasks-events-detail {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 2rem;
}

/* Selected state for accordion items */
.accordion-item.selected {
  background: var(--accent-color-alpha);
  color: var(--text-primary);
  border-left: 2px solid var(--accent-color);
}

/* Add button at bottom of accordion */
.accordion-add-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem 0.375rem 2rem;
  font-size: 0.8rem;
  color: var(--accent-color);
  background: transparent;
  border: none;
  cursor: pointer;
  width: 100%;
  transition: all 0.2s;
}

.accordion-add-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}
```

### Event Status Indicators

```css
.event-status.active { color: #4caf50; }
.event-status.paused { color: #ff9800; }
.event-status.error  { color: #f44336; }

.event-source-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}
```

### Detail Panel

```css
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.detail-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.detail-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.detail-meta-label {
  color: var(--text-secondary);
}

.detail-section {
  margin-bottom: 1.5rem;
}

.detail-section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.25rem;
  margin-bottom: 0.75rem;
}

.detail-md-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 1rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
}

.detail-actions {
  display: flex;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}
```

---

## Part 7: Migration — Moving Agent Tasks Accordion

### What Moves

The Agent Tasks accordion (currently `App.jsx:1827-1905`) moves **as-is** into the `TasksEventsSidebar.jsx` component. The rendering logic, status indicators, tooltips, run buttons, and `formatNextRun` helper all transfer unchanged.

### What Stays in Chat Sidebar

A slim quick-link replaces the full accordion in the chat sidebar:

```jsx
<div className="sidebar-quick-link" onClick={() => navigate('/tasks')}>
  <span className="accordion-icon">📋</span>
  <span className="accordion-title">Tasks & Events</span>
  <span className="quick-link-badge">
    {agentTasks.length + agentEvents.length}
  </span>
  <span className="quick-link-arrow">→</span>
</div>
```

### State Sharing

`agentTasks` and `agentEvents` state arrays remain in `App.jsx` (or a shared context) since:
- Chat sidebar needs the count for the quick-link badge
- WebSocket handlers update them globally
- Tasks & Events page reads and displays them

---

## Part 8: Summary

| Aspect | Tasks (existing) | Events (new) |
|--------|-----------------|--------------|
| Config location | `user/tasks/*.md` + `*.json` | `user/events/*.md` + `*.json` |
| `.md` content | Task description + schedule | Event handler prompt |
| `.json` content | Trigger, actions, skills | Source config, auth, skills |
| Trigger mechanism | Cron schedule / manual run | Incoming webhook POST |
| Manager service | `TaskManager` | `EventManager` |
| File watcher | `ConfigWatcher` on `user/tasks/` | `ConfigWatcher` on `user/events/` |
| DB table | `tasks` | `events` |
| API routes | `/api/tasks`, `/api/tasks/:id/run` | `/api/events`, `/api/webhooks/:source` |
| WS message | `task_run`, `task_updated` | `event_fired`, `event_updated` |
| Execution | `supervisor.handleMessage(taskConfig)` | `supervisor.handleMessage(handlerPrompt + payload)` |
| UI location | Tasks & Events tab → left accordion | Tasks & Events tab → left accordion |
