/**
 * useChatMessages — hook for managing chat message state and WebSocket event handling.
 *
 * This hook provides:
 * - Message state management (messages array, streaming state)
 * - WebSocket event subscription and handling
 * - History loading from REST API
 * - Pagination for loading older messages
 *
 * Design: This hook unifies the message handling logic previously duplicated between
 * App.jsx (via createMessageHandler) and MissionChat.jsx. It uses the subscription
 * pattern from useConversationSubscription for flexibility.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const MESSAGE_PAGE_SIZE = 30;

/**
 * Chat event types that are handled by this hook.
 */
const CHAT_EVENT_TYPES = new Set([
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
 * Transform raw message from API to internal format.
 * Handles both real-time WebSocket event format and API/DB format.
 */
function transformMessage(msg) {
  // Derive role from messageType (API stores type in messageType, real-time events have role directly)
  let role = msg.role;
  if (msg.messageType === 'task_run') role = 'task_run';
  else if (msg.messageType === 'tool_event' || msg.role === 'tool') role = 'tool';
  else if (msg.messageType === 'delegation') role = 'delegation';

  // Derive status from toolSuccess for API messages (real-time events have status directly)
  let status = msg.status;
  if (status === undefined && msg.toolSuccess !== undefined) {
    status = msg.toolSuccess ? 'completed' : 'failed';
  }

  // Extract files - check both real-time format (files) and API format (toolFiles)
  const result = msg.result || msg.toolResult;
  let files = msg.files || msg.toolFiles;
  // Fallback: extract from result object if files weren't persisted separately (legacy data)
  if (!files && result && typeof result === 'object' && Array.isArray(result.files)) {
    files = result.files;
  }

  return {
    id: msg.id,
    role,
    content: msg.content || '',
    timestamp: msg.createdAt || msg.timestamp,
    agentName: msg.agentName || msg.delegationAgentId,
    agentEmoji: msg.agentEmoji,
    agentType: msg.agentType || msg.delegationAgentType || (msg.agentName?.includes('-') ? msg.agentName : undefined),
    attachments: msg.attachments,
    buttons: msg.buttons,
    html: msg.html,
    citations: msg.citations,
    usage: msg.usage,
    reasoningMode: msg.reasoningMode,
    messageType: msg.messageType,
    agentCommand: msg.agentCommand,
    isError: msg.isError || false,
    isStreaming: false,
    // Tool-specific fields (handle both real-time and API naming)
    toolName: msg.toolName,
    source: msg.source || msg.toolSource,
    parameters: msg.parameters || msg.toolParameters,
    status,
    result,
    files,
    error: msg.error || msg.toolError,
    durationMs: msg.durationMs || msg.toolDurationMs,
    // Delegation/Task-specific fields (handle both real-time and API naming)
    mission: msg.mission || msg.delegationMission,
    taskId: msg.taskId,
    taskName: msg.taskName,
    taskDescription: msg.taskDescription,
  };
}

/**
 * @typedef {Object} UseChatMessagesOptions
 * @property {string} conversationId - The conversation ID to manage
 * @property {Function} subscribe - Subscribe function: (conversationId, handler) => unsubscribe
 * @property {boolean} [loadHistory=true] - Whether to load message history on mount
 * @property {Function} [onMessagesChange] - Callback when messages change: (messages) => void
 * @property {Function} [onStreamingChange] - Callback when streaming state changes: (isStreaming) => void
 */

/**
 * @param {UseChatMessagesOptions} options
 */
export function useChatMessages({
  conversationId,
  subscribe,
  loadHistory = true,
  onMessagesChange,
  onStreamingChange,
}) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Pagination state
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Refs for preventing stale closures and race conditions
  const conversationIdRef = useRef(conversationId);
  const fetchCounterRef = useRef(0);

  // Update ref when conversationId changes
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Notify parent when messages change
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages);
    }
  }, [messages, onMessagesChange]);

  // Notify parent when streaming state changes
  useEffect(() => {
    if (onStreamingChange) {
      onStreamingChange(isStreaming);
    }
  }, [isStreaming, onStreamingChange]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleRegularMessage = useCallback((data) => {
    const messageId = data.id || `msg-${Date.now()}`;
    setMessages((prev) => {
      if (prev.some((m) => m.id === messageId)) return prev;
      return [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content: data.content,
          timestamp: data.timestamp,
          buttons: data.buttons,
          html: data.html,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
        },
      ];
    });
  }, []);

  const handleStreamStart = useCallback((data) => {
    setIsStreaming(true);
    setMessages((prev) => {
      // Get the last user message to inherit reasoning mode
      const lastUserMsg = [...prev].reverse().find((m) => m.role === 'user');
      return [
        ...prev,
        {
          id: data.id,
          role: 'assistant',
          content: '',
          timestamp: data.timestamp,
          isStreaming: true,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
          reasoningMode: lastUserMsg?.reasoningMode || null,
          messageType: lastUserMsg?.messageType || null,
        },
      ];
    });
  }, []);

  const handleStreamChunk = useCallback((data) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.streamId
          ? { ...m, content: m.content + data.chunk }
          : m
      )
    );
  }, []);

  const handleStreamEnd = useCallback((data) => {
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.streamId
          ? { ...m, isStreaming: false, citations: data.citations, usage: data.usage }
          : m
      )
    );
  }, []);

  const handleStreamResume = useCallback((data) => {
    if (data.active === false || !data.streamId) return;

    setMessages((prev) => {
      const existingStream = prev.find((m) => m.id === data.streamId);
      if (existingStream) {
        return prev.map((m) =>
          m.id === data.streamId
            ? { ...m, content: data.accumulatedContent, isStreaming: true }
            : m
        );
      }
      return [
        ...prev,
        {
          id: data.streamId,
          role: 'assistant',
          content: data.accumulatedContent || '',
          isStreaming: true,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
          timestamp: data.startTime,
        },
      ];
    });
    setIsStreaming(true);
  }, []);

  const handleError = useCallback((data) => {
    const errorId = data.id || `err-${Date.now()}`;
    setMessages((prev) => {
      if (prev.some((m) => m.id === errorId)) return prev;
      return [
        ...prev,
        {
          id: errorId,
          role: 'assistant',
          content: `**Error:** ${data.error}${data.details ? `\n\n\`\`\`\n${data.details}\n\`\`\`` : ''}`,
          timestamp: data.timestamp,
          isError: true,
        },
      ];
    });
    setIsStreaming(false);
  }, []);

  const handleToolRequested = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages((prev) => {
      if (prev.some((m) => m.id === toolId)) return prev;
      return [
        ...prev,
        {
          id: toolId,
          role: 'tool',
          toolName: data.toolName,
          source: data.source,
          parameters: data.parameters,
          status: 'running',
          timestamp: data.timestamp,
          agentId: data.agentId,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
        },
      ];
    });
  }, []);

  const handleToolFinished = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === toolId
          ? {
              ...m,
              status: data.success ? 'completed' : 'failed',
              durationMs: data.durationMs,
              error: data.error,
              parameters: data.parameters,
              result: data.result,
              files: data.files,
              progress: undefined,
            }
          : m
      )
    );
  }, []);

  const handleToolProgress = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === toolId && m.status === 'running'
          ? { ...m, progress: data.progress }
          : m
      )
    );
  }, []);

  const handleToolResume = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages((prev) => {
      const existingTool = prev.find((m) => m.id === toolId);
      if (existingTool) {
        if (data.progress) {
          return prev.map((m) =>
            m.id === toolId
              ? { ...m, progress: data.progress, status: 'running' }
              : m
          );
        }
        return prev;
      }
      return [
        ...prev,
        {
          id: toolId,
          role: 'tool',
          toolName: data.toolName,
          source: data.source,
          parameters: data.parameters,
          status: 'running',
          timestamp: data.startTime || data.timestamp,
          agentId: data.agentId,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
          progress: data.progress,
        },
      ];
    });
    setIsStreaming(true);
  }, []);

  const handleDelegation = useCallback((data) => {
    const delegationId = `delegation-${data.agentId}`;
    setMessages((prev) => {
      if (prev.some((m) => m.id === delegationId)) return prev;
      return [
        ...prev,
        {
          id: delegationId,
          role: 'delegation',
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
          mission: data.mission,
          timestamp: data.timestamp,
        },
      ];
    });
  }, []);

  const handleTaskRun = useCallback((data) => {
    const taskRunId = `task-run-${data.taskId}-${Date.now()}`;
    setMessages((prev) => {
      if (prev.some((m) => m.taskId === data.taskId && m.role === 'task_run')) return prev;
      return [
        ...prev,
        {
          id: taskRunId,
          role: 'task_run',
          taskId: data.taskId,
          taskName: data.taskName,
          taskDescription: data.taskDescription,
          timestamp: data.timestamp,
        },
      ];
    });
  }, []);

  // ============================================================================
  // Main Event Handler
  // ============================================================================

  const handleEvent = useCallback((data) => {
    if (!CHAT_EVENT_TYPES.has(data.type)) return;

    switch (data.type) {
      case 'message':
        handleRegularMessage(data);
        break;
      case 'stream_start':
        handleStreamStart(data);
        break;
      case 'stream_chunk':
        handleStreamChunk(data);
        break;
      case 'stream_end':
        handleStreamEnd(data);
        break;
      case 'stream_resume':
        handleStreamResume(data);
        break;
      case 'error':
        handleError(data);
        break;
      case 'tool_requested':
        handleToolRequested(data);
        break;
      case 'tool_execution_finished':
        handleToolFinished(data);
        break;
      case 'tool_progress':
        handleToolProgress(data);
        break;
      case 'tool_resume':
        handleToolResume(data);
        break;
      case 'delegation':
        handleDelegation(data);
        break;
      case 'task_run':
        handleTaskRun(data);
        break;
      default:
        break;
    }
  }, [
    handleRegularMessage,
    handleStreamStart,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamResume,
    handleError,
    handleToolRequested,
    handleToolFinished,
    handleToolProgress,
    handleToolResume,
    handleDelegation,
    handleTaskRun,
  ]);

  // ============================================================================
  // Subscribe to WebSocket Events
  // ============================================================================

  useEffect(() => {
    if (!conversationId || !subscribe) return;
    return subscribe(conversationId, handleEvent);
  }, [conversationId, subscribe, handleEvent]);

  // ============================================================================
  // Load History
  // ============================================================================

  useEffect(() => {
    if (!loadHistory || !conversationId || historyLoaded) return;

    let cancelled = false;
    setIsLoadingHistory(true);
    const fetchId = ++fetchCounterRef.current;

    fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_PAGE_SIZE}&includeTotal=true`)
      .then((res) => (res.ok ? res.json() : { items: [], pagination: {} }))
      .then((data) => {
        if (cancelled || fetchId !== fetchCounterRef.current) return;
        const pagination = data.pagination || {};
        const items = (data.items || data || []).map(transformMessage);
        setMessages(items);
        setHistoryLoaded(true);
        setIsLoadingHistory(false);
        setHasMoreOlder(pagination.hasOlder || false);
        setOldestCursor(pagination.oldestCursor || null);
      })
      .catch(() => {
        if (!cancelled && fetchId === fetchCounterRef.current) {
          setHistoryLoaded(true);
          setIsLoadingHistory(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadHistory, conversationId, historyLoaded]);

  // Reset state when conversationId changes
  useEffect(() => {
    setMessages([]);
    setHistoryLoaded(false);
    setIsStreaming(false);
    setHasMoreOlder(false);
    setOldestCursor(null);
  }, [conversationId]);

  // ============================================================================
  // Load Older Messages (Pagination)
  // ============================================================================

  const loadOlderMessages = useCallback(async () => {
    if (isLoadingOlder || !hasMoreOlder || !oldestCursor) return;

    const convId = conversationIdRef.current;
    if (!convId) return;

    setIsLoadingOlder(true);
    const fetchId = fetchCounterRef.current;

    let data = null;
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(convId)}/messages?limit=20&before=${encodeURIComponent(oldestCursor)}`
      );
      if (fetchId !== fetchCounterRef.current) {
        setIsLoadingOlder(false);
        return;
      }
      if (res.ok) {
        data = await res.json();
      }
    } catch (error) {
      console.error('Failed to load older messages:', error);
    }

    // Process data outside try/catch to satisfy React Compiler
    if (data) {
      const items = data.items;
      const olderMessages = (items ? items : []).map(transformMessage);
      const pagination = data.pagination;
      const paginationObj = pagination ? pagination : {};

      if (olderMessages.length > 0) {
        setMessages((prev) => [...olderMessages, ...prev]);
        setHasMoreOlder(paginationObj.hasOlder ? paginationObj.hasOlder : false);
        setOldestCursor(paginationObj.oldestCursor ? paginationObj.oldestCursor : null);
      } else {
        setHasMoreOlder(false);
      }
    }
    setIsLoadingOlder(false);
  }, [isLoadingOlder, hasMoreOlder, oldestCursor]);

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Add a user message optimistically (before server confirmation).
   */
  const addUserMessage = useCallback((content, options = {}) => {
    const messageId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const message = {
      id: messageId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachments: options.attachments,
      reasoningMode: options.reasoningMode,
      messageType: options.messageType,
      agentCommand: options.agentCommand,
    };

    setMessages((prev) => [...prev, message]);
    setIsStreaming(true); // Expect a response

    return messageId;
  }, []);

  /**
   * Clear all messages.
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setIsStreaming(false);
    setHistoryLoaded(false);
    setHasMoreOlder(false);
    setOldestCursor(null);
  }, []);

  return {
    // State
    messages,
    isStreaming,
    historyLoaded,
    isLoadingHistory,
    hasMoreOlder,
    isLoadingOlder,

    // Actions
    addUserMessage,
    clearMessages,
    loadOlderMessages,

    // Direct state access for advanced use cases
    setMessages,
  };
}
