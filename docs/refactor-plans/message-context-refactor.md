# Refactor Plan: MessageContext for Request-Scoped State

## Problem Statement

### The Bug: Race Condition in Supervisor's `currentConversationId`

The `SupervisorAgentImpl` stores `currentConversationId` as instance state:

```typescript
// supervisor.ts:33
private currentConversationId: string | null = null;
```

When a message arrives, it overwrites this value:

```typescript
// supervisor.ts:119
this.setConversationId(msgConversationId);
```

**This causes a race condition with concurrent messages:**

```
Timeline:
─────────────────────────────────────────────────────────────────►

Message A (conv: "abc") arrives
  │ setConversationId("abc")
  │ currentConversationId = "abc"
  │ starts async processing (LLM call, tool execution)...
  │         │
  │         │  Message B (conv: "xyz") arrives
  │         │    setConversationId("xyz")     ← OVERWRITES!
  │         │    currentConversationId = "xyz"
  │         │
  │ ...Message A still processing...
  │ calls sendStreamChunk(streamId, chunk, this.currentConversationId)
  │ → sends to "xyz" instead of "abc" ← WRONG!
```

### Symptoms

1. **Messages appear in wrong conversations** - Response to User A shows up in User B's conversation
2. **WebSocket filtering fails** - Frontend's `isForCurrentConversation()` drops messages with wrong/missing conversationId
3. **Tool events routed incorrectly** - Tool execution results appear in wrong conversation
4. **Worker agents get wrong conversationId** - Supervisor passes its (potentially stale) `currentConversationId` to spawned workers

### Root Cause

The design assumed **single-threaded, sequential message processing** - one message fully completes before the next starts. But in reality:

- Multiple browser tabs can send concurrent messages
- LLM API calls are async (seconds of latency)
- Tool execution is async
- Sub-agent delegation is async

During these async gaps, another message can arrive and overwrite the shared state.

### Affected Code Paths

Places that read `this.currentConversationId` during message processing:

- `supervisor.ts:236` - `messageEventService.emitToolEvent()`
- `supervisor.ts:250` - `startStream()`
- `supervisor.ts:318` - `sendStreamChunk()`
- `supervisor.ts:352, 372, 440, 448` - `endStreamWithCitations()`
- `supervisor.ts:496, 581` - Setting `agent.conversationId` on worker
- `supervisor.ts:517, 602` - `emitDelegationEvent()`

Similarly, `currentTurnId` has the same race condition problem.

---

## Proposed Solution: MessageContext

### Design

Replace instance-level state with a **request-scoped context object** passed through the call chain:

```typescript
interface MessageContext {
  messageId: string;
  conversationId: string;
  turnId: string;
}
```

### Why This Approach?

1. **Explicit data flow** - No hidden shared state; context flows visibly through function parameters
2. **Concurrent-safe** - Each message processing has its own context instance
3. **Testable** - Easy to create context objects in tests
4. **Debuggable** - Can log/trace context at any point

### Alternative Approaches Considered

| Approach | Pros | Cons |
|----------|------|------|
| **AsyncLocalStorage** | No parameter threading | Magic/implicit, harder to trace |
| **Message ID lookup Map** | Minimal code changes | Still shared state, needs cleanup |
| **Mutex/locking** | Prevents race | Kills concurrency, adds latency |
| **Context object** (chosen) | Explicit, safe, testable | Requires parameter threading |

---

## Implementation Plan

### Phase 1: Define MessageContext

```typescript
// src/agents/types.ts

export interface MessageContext {
  /** ID of the message being processed */
  messageId: string;

  /** Conversation this message belongs to */
  conversationId: string;

  /** Turn ID - ID of originating user message for this turn */
  turnId: string;
}
```

### Phase 2: Update Supervisor

1. **Create context at entry point:**

```typescript
// supervisor.ts - handleMessage()
async handleMessage(message: Message): Promise<void> {
  const ctx: MessageContext = {
    messageId: message.id,
    conversationId: this.resolveConversationId(message),
    turnId: (message.metadata?.turnId as string) || message.id,
  };

  await this.processMessage(message, ctx);
}
```

2. **Remove instance state:**

```typescript
// DELETE these:
private currentConversationId: string | null = null;
private currentTurnId: string | null = null;
```

3. **Thread context through internal methods:**

```typescript
private async processMessage(message: Message, ctx: MessageContext): Promise<void> {
  // Use ctx.conversationId instead of this.currentConversationId
  channel.startStream(streamId, {
    conversationId: ctx.conversationId,
    // ...
  });
}
```

4. **Update worker spawning:**

```typescript
private async delegateToAgent(agentType: string, ctx: MessageContext, ...): Promise<void> {
  const agent = new WorkerAgent(...);
  agent.conversationId = ctx.conversationId;
  agent.turnId = ctx.turnId;
  // ...
}
```

### Phase 3: Update Base Agent

1. **Add context parameter to sendToChannel:**

```typescript
// base-agent.ts
async sendToChannel(
  channel: Channel,
  content: string,
  options?: { markdown?: boolean; ctx?: MessageContext }
): Promise<void> {
  await this.sendAgentMessage(channel, agentMessage, options);
}
```

2. **Update sendAgentMessage:**

```typescript
protected async sendAgentMessage(
  channel: Channel,
  message: AgentMessage,
  options?: { markdown?: boolean; ctx?: MessageContext }
): Promise<void> {
  await extendedChannel.sendAsAgent(message.content, {
    ...options,
    conversationId: options?.ctx?.conversationId,  // ← Now included!
    agentId: message.agentId,
    // ...
  });
}
```

### Phase 4: Update WebChannel

```typescript
// web.ts
async sendAsAgent(
  content: string,
  options?: {
    markdown?: boolean;
    conversationId?: string;  // ← Add this
    agentId?: string;
    // ...
  }
): Promise<void> {
  const payload = {
    type: 'message',
    conversationId: options?.conversationId,  // ← Include in payload
    // ...
  };
  this.broadcast(payload);
}
```

### Phase 5: Update Worker Agent

Worker already has `conversationId` as instance property (set by supervisor). Options:

**Option A:** Keep as-is - worker is short-lived, single-task, so instance state is fine

**Option B:** Also use MessageContext for consistency

Recommend **Option A** for now - workers are spawned per-task and don't have the concurrency issue.

---

## Migration Strategy

1. **Add context as optional parameter first** - Backwards compatible
2. **Update callers one by one** - Pass context where available
3. **Add deprecation warnings** - For calls without context
4. **Remove old instance state** - Once all callers updated
5. **Make context required** - Final cleanup

---

## Testing Plan

1. **Unit test:** Create MessageContext, verify it flows through to WebSocket payload
2. **Concurrency test:** Send 2 messages to different conversations simultaneously, verify responses go to correct conversations
3. **Integration test:** Multi-tab scenario with overlapping requests

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/agents/types.ts` | Add `MessageContext` interface |
| `src/agents/supervisor.ts` | Remove instance state, thread context |
| `src/agents/base-agent.ts` | Add context param to `sendToChannel`, `sendAgentMessage` |
| `src/agents/worker.ts` | Pass context when calling base methods |
| `src/channels/web.ts` | Add `conversationId` to `sendAsAgent` |
| `src/channels/types.ts` | Update `ExtendedChannel` interface |

---

## Estimated Effort

- **Phase 1-2:** 2-3 hours (Supervisor changes)
- **Phase 3-4:** 1-2 hours (Base agent + WebChannel)
- **Phase 5:** 30 min (Worker updates)
- **Testing:** 1-2 hours

**Total:** ~5-8 hours

---

## Related Issues

- PR review feedback: "WebChannel.sendAsAgent() broadcasts 'message' payloads without conversationId"
- Non-streaming assistant messages disappearing from conversations
- Potential for messages appearing in wrong conversations under load
