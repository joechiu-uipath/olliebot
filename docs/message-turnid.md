# Message Turn ID

The `turnId` field tracks which messages belong to the same "turn" of conversation - a user's question and all the subsequent agent responses that stem from it.

## Purpose

- **Grouping**: All messages in a turn share the same `turnId`, making it easy to group related messages
- **Context Tracking**: Understand what user message prompted a given response
- **UI Features**: Enable collapsing/expanding turns, showing turn boundaries

## How turnId is Assigned

### For User Messages
The user message's own `id` becomes the `turnId` for the entire turn:
```
User message (id: "abc123") → turnId = "abc123"
```

### For Task Runs (No User Message)
When a scheduled task runs, there's no user message. The `task_run` event's message ID becomes the `turnId`:
```
task_run event (id: "task-run-xyz") → turnId = "task-run-xyz"
```

## Message Flow

```
User message (id: "abc123") → turnId = "abc123"
  ├─ Tool call → turnId = "abc123"
  ├─ Delegation to Worker → worker.turnId = "abc123"
  │   ├─ Worker tool call → turnId = "abc123"
  │   ├─ Sub-delegation → sub-worker.turnId = "abc123"
  │   │   └─ Sub-worker response → turnId = "abc123"
  │   └─ Worker response → turnId = "abc123"
  └─ Assistant response → turnId = "abc123"
```

## Implementation Details

### Database Schema

The `messages` table includes a `turnId` column:
```sql
CREATE TABLE messages (
  id STRING PRIMARY KEY,
  conversationId STRING,
  channel STRING,
  role STRING,
  content STRING,
  metadata STRING,
  createdAt STRING,
  turnId STRING
)
```

### Key Files

| File | Changes |
|------|---------|
| `src/db/index.ts` | Added `turnId` to Message interface and schema |
| `src/services/message-event-service.ts` | All emit methods accept and persist `turnId` |
| `src/agents/supervisor.ts` | Sets `currentTurnId` at message handling, passes to workers |
| `src/agents/worker.ts` | Receives `turnId` from parent, passes to sub-agents |
| `src/server/index.ts` | Captures `turnId` from task_run events for task messages |

### Supervisor Flow

1. `handleMessage()` is called with a user message or task message
2. `currentTurnId` is set:
   - User message: `turnId = message.id`
   - Task message: `turnId = message.metadata.turnId` (from task_run event)
3. All subsequent operations use `currentTurnId`:
   - Tool events via `MessageEventService.emitToolEvent()`
   - Delegations via `MessageEventService.emitDelegationEvent()`
   - Saved messages via `saveMessage()` and `saveAssistantMessage()`
4. Workers receive `turnId` when spawned and propagate it to sub-agents

### Worker Flow

1. Worker is spawned by supervisor or parent worker
2. `conversationId` and `turnId` are set on the worker
3. Worker uses `turnId` for:
   - Tool events
   - Delegation events (when spawning sub-agents)
   - Saving assistant messages
4. Sub-agents inherit the same `turnId`
