/**
 * useConversationSubscription — pub-sub layer for multi-conversation WebSocket events.
 *
 * Allows multiple React components (e.g., embedded Mission chats) to subscribe
 * to conversation-scoped WebSocket events by conversationId. The main chat
 * handler continues to work exactly as before — this is additive only.
 *
 * Usage:
 *   const { subscribe, dispatch } = useConversationSubscription();
 *
 *   // In MissionChat component:
 *   useEffect(() => subscribe(conversationId, handler), [conversationId]);
 *
 *   // In combined message handler (App.jsx):
 *   dispatch(data);  // routes to all matching subscribers
 */

import { useCallback, useRef } from 'react';

/**
 * Event types that carry a conversationId and should be dispatched to subscribers.
 */
const CONVERSATION_SCOPED_TYPES = new Set([
  'message',
  'stream_start',
  'stream_chunk',
  'stream_end',
  'stream_resume',
  'error',
  'tool_requested',
  'tool_execution_finished',
  'tool_progress',
  'tool_resume',
  'delegation',
  'task_run',
]);

export function useConversationSubscription() {
  // Map<conversationId, Set<callback>>
  const subscribersRef = useRef(new Map());

  /**
   * Subscribe to events for a specific conversation.
   * Returns an unsubscribe function (suitable for useEffect cleanup).
   */
  const subscribe = useCallback((conversationId, callback) => {
    if (!conversationId) return () => {};

    const subs = subscribersRef.current;
    if (!subs.has(conversationId)) {
      subs.set(conversationId, new Set());
    }
    subs.get(conversationId).add(callback);

    // Return cleanup function
    return () => {
      const set = subs.get(conversationId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          subs.delete(conversationId);
        }
      }
    };
  }, []);

  /**
   * Dispatch a WebSocket event to all subscribers for its conversationId.
   * Call this from the combined message handler in App.jsx.
   * Returns true if at least one subscriber was notified.
   */
  const dispatch = useCallback((data) => {
    if (!data.conversationId) return false;
    if (!CONVERSATION_SCOPED_TYPES.has(data.type)) return false;

    const set = subscribersRef.current.get(data.conversationId);
    if (!set || set.size === 0) return false;

    for (const cb of set) {
      try {
        cb(data);
      } catch (err) {
        console.error('[ConversationSubscription] Subscriber error:', err);
      }
    }
    return true;
  }, []);

  /**
   * Check if any subscribers exist for a conversationId.
   */
  const hasSubscribers = useCallback((conversationId) => {
    const set = subscribersRef.current.get(conversationId);
    return set ? set.size > 0 : false;
  }, []);

  return { subscribe, dispatch, hasSubscribers };
}
