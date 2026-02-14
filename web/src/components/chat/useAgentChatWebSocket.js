/**
 * useAgentChatWebSocket — self-contained WebSocket hook for AgentChat.
 *
 * Manages the WebSocket connection internally so AgentChat doesn't need
 * external sendMessage/subscribe props.
 *
 * Features:
 * - Auto-connect on mount
 * - Reconnection with exponential backoff
 * - Message routing via conversation subscription pattern
 * - Lifecycle hooks for parent integration
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Chat event types that should be routed to conversation subscribers.
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

/**
 * @typedef {Object} UseAgentChatWebSocketOptions
 * @property {boolean} [enabled=true] - Whether to connect (set false to disable)
 * @property {string} [wsUrl] - WebSocket URL (default: auto-detect from window.location)
 * @property {Function} [onBeforeSend] - Called before sending: (message) => message | null
 * @property {Function} [onAfterSend] - Called after sending: (message) => void
 * @property {Function} [onMessage] - Called for all messages: (data) => void
 * @property {Function} [onConnectionChange] - Called when connection state changes: (connected) => void
 * @property {Function} [onError] - Called on WebSocket error: (error) => void
 */

/**
 * @param {UseAgentChatWebSocketOptions} options
 */
export function useAgentChatWebSocket({
  enabled = true,
  wsUrl,
  onBeforeSend,
  onAfterSend,
  onMessage,
  onConnectionChange,
  onError,
} = {}) {
  const [isConnected, setIsConnected] = useState(false);

  // Refs
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const mountedRef = useRef(true);
  const connectRef = useRef(null);

  // Conversation subscribers: Map<conversationId, Set<callback>>
  const subscribersRef = useRef(new Map());

  // Callback refs to avoid stale closures
  const onBeforeSendRef = useRef(onBeforeSend);
  const onAfterSendRef = useRef(onAfterSend);
  const onMessageRef = useRef(onMessage);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onBeforeSendRef.current = onBeforeSend;
    onAfterSendRef.current = onAfterSend;
    onMessageRef.current = onMessage;
    onConnectionChangeRef.current = onConnectionChange;
    onErrorRef.current = onError;
  }, [onBeforeSend, onAfterSend, onMessage, onConnectionChange, onError]);

  // Compute WebSocket URL (matches main app's useWebSocket behavior)
  const getWsUrl = useCallback(() => {
    if (wsUrl) return wsUrl;
    // Use proxy if VITE_USE_WS_PROXY is set, otherwise connect directly to backend
    if (import.meta.env.VITE_USE_WS_PROXY === 'true') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return `${protocol}//${host}/ws`;
    }
    return 'ws://localhost:3000';
  }, [wsUrl]);

  // Dispatch message to conversation subscribers
  const dispatchToSubscribers = useCallback((data) => {
    if (!data.conversationId) return;
    if (!CONVERSATION_SCOPED_TYPES.has(data.type)) return;

    const set = subscribersRef.current.get(data.conversationId);
    if (!set || set.size === 0) return;

    for (const cb of set) {
      try {
        cb(data);
      } catch (err) {
        console.error('[AgentChatWebSocket] Subscriber error:', err);
      }
    }
  }, []);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error('[AgentChatWebSocket] Failed to parse message:', e);
      return;
    }

    // Notify parent
    onMessageRef.current?.(data);

    // Route to conversation subscribers
    dispatchToSubscribers(data);
  }, [dispatchToSubscribers]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!enabled) return;
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const url = getWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptsRef.current = 0;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      setIsConnected(true);
      onConnectionChangeRef.current?.(true);
    };

    ws.onmessage = handleMessage;

    ws.onerror = (error) => {
      onErrorRef.current?.(error);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      setIsConnected(false);
      onConnectionChangeRef.current?.(false);
      wsRef.current = null;

      // Attempt reconnection
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('[AgentChatWebSocket] Max reconnection attempts reached');
        onErrorRef.current?.(new Error('Connection failed after max retries'));
        return;
      }

      const delay = Math.min(
        reconnectDelayRef.current * (1 + Math.random() * 0.3),
        MAX_RECONNECT_DELAY
      );

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptsRef.current += 1;
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY);
        connectRef.current?.();
      }, delay);
    };
  }, [enabled, getWsUrl, handleMessage]);

  // Keep connectRef in sync
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Send a message via WebSocket.
   */
  const sendMessage = useCallback((message) => {
    // Allow parent to modify or cancel the message
    let finalMessage = message;
    if (onBeforeSendRef.current) {
      finalMessage = onBeforeSendRef.current(message);
      if (finalMessage === null || finalMessage === undefined) {
        return; // Message cancelled
      }
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[AgentChatWebSocket] Cannot send - not connected');
      return;
    }

    ws.send(JSON.stringify(finalMessage));

    // Notify parent
    onAfterSendRef.current?.(finalMessage);
  }, []);

  /**
   * Subscribe to events for a specific conversation.
   * Returns an unsubscribe function.
   */
  const subscribe = useCallback((conversationId, callback) => {
    if (!conversationId) return () => {};

    const subs = subscribersRef.current;
    if (!subs.has(conversationId)) {
      subs.set(conversationId, new Set());
    }
    subs.get(conversationId).add(callback);

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
   * Request active stream/tool state for a conversation.
   */
  const requestActiveState = useCallback((conversationId) => {
    sendMessage({ type: 'get-active-stream', conversationId });
  }, [sendMessage]);

  return {
    isConnected,
    sendMessage,
    subscribe,
    requestActiveState,
  };
}
