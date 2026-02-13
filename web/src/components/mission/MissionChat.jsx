/**
 * MissionChat — embedded chat panel for mission and pillar conversations.
 *
 * Self-contained: loads message history via REST, sends via WebSocket,
 * receives streaming responses via the conversation subscription system.
 *
 * Props:
 *   conversationId  — the mission/pillar conversation ID
 *   contextLabel    — display label (e.g., "Mission Chat", "Build Performance Chat")
 *   placeholder     — input placeholder text
 *   sendMessage     — WebSocket sendMessage function from useWebSocket
 *   subscribe       — subscribe(conversationId, callback) from useConversationSubscription
 *   readOnly        — if true, hide input (for completed task execution logs)
 *   defaultExpanded — initial expand state (default: true)
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { MessageContent } from '../MessageContent';
import './MissionChat.css';

const MESSAGE_LOAD_LIMIT = 30;

const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 600;

export const MissionChat = memo(function MissionChat({
  conversationId,
  contextLabel = 'Chat',
  placeholder = 'Type a message...',
  sendMessage,
  subscribe,
  readOnly = false,
  defaultExpanded = true,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const isResizingRef = useRef(false);

  // Track if we're at the bottom for auto-scroll
  const isAtBottomRef = useRef(true);

  // ========================================================================
  // Resize handling
  // ========================================================================

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const startY = e.clientY;
    const startHeight = panelHeight;

    const handleMouseMove = (moveEvent) => {
      if (!isResizingRef.current) return;
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, startHeight + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight]);

  // ========================================================================
  // Load message history on expand (lazy)
  // ========================================================================

  useEffect(() => {
    if (!expanded || !conversationId || historyLoaded) return;

    let cancelled = false;

    fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_LOAD_LIMIT}`)
      .then(res => res.ok ? res.json() : { items: [] })
      .then(data => {
        if (cancelled) return;
        const items = (data.items || data || []).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content || '',
          timestamp: m.createdAt || m.timestamp,
          agentName: m.agentName,
          agentEmoji: m.agentEmoji,
          isStreaming: false,
        }));
        setMessages(items);
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true);
      });

    return () => { cancelled = true; };
  }, [expanded, conversationId, historyLoaded]);

  // Reset when conversationId changes
  useEffect(() => {
    setMessages([]);
    setHistoryLoaded(false);
    setNewMessageCount(0);
    setIsStreaming(false);
  }, [conversationId]);

  // ========================================================================
  // WebSocket event handlers (defined before useEffect for React Compiler)
  // ========================================================================

  const handleIncomingMessage = useCallback((data) => {
    const msgId = data.id || `msg-${Date.now()}`;
    setMessages(prev => {
      if (prev.some(m => m.id === msgId)) return prev;
      return [...prev, {
        id: msgId,
        role: 'assistant',
        content: data.content,
        timestamp: data.timestamp,
        agentName: data.agentName,
        agentEmoji: data.agentEmoji,
      }];
    });
    if (!expanded) setNewMessageCount(c => c + 1);
  }, [expanded]);

  const handleStreamStart = useCallback((data) => {
    setIsStreaming(true);
    setMessages(prev => [
      ...prev,
      {
        id: data.id,
        role: 'assistant',
        content: '',
        timestamp: data.timestamp,
        isStreaming: true,
        agentName: data.agentName,
        agentEmoji: data.agentEmoji,
      },
    ]);
  }, []);

  const handleStreamChunk = useCallback((data) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === data.streamId
          ? { ...m, content: m.content + data.chunk }
          : m
      )
    );
  }, []);

  const handleStreamEnd = useCallback((data) => {
    setIsStreaming(false);
    setMessages(prev =>
      prev.map(m =>
        m.id === data.streamId
          ? { ...m, isStreaming: false }
          : m
      )
    );
    if (!expanded) setNewMessageCount(c => c + 1);
  }, [expanded]);

  const handleError = useCallback((data) => {
    setIsStreaming(false);
    const errId = data.id || `err-${Date.now()}`;
    setMessages(prev => {
      if (prev.some(m => m.id === errId)) return prev;
      return [...prev, {
        id: errId,
        role: 'assistant',
        content: `**Error:** ${data.error}`,
        isError: true,
        timestamp: data.timestamp,
      }];
    });
  }, []);

  const handleToolRequested = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages(prev => {
      if (prev.some(m => m.id === toolId)) return prev;
      return [...prev, {
        id: toolId,
        role: 'tool',
        toolName: data.toolName,
        status: 'running',
        timestamp: data.timestamp,
        agentName: data.agentName,
        agentEmoji: data.agentEmoji,
      }];
    });
  }, []);

  const handleToolFinished = useCallback((data) => {
    const toolId = `tool-${data.requestId}`;
    setMessages(prev =>
      prev.map(m =>
        m.id === toolId
          ? { ...m, status: data.success ? 'completed' : 'failed', durationMs: data.durationMs }
          : m
      )
    );
  }, []);

  const handleDelegation = useCallback((data) => {
    const delegationId = `delegation-${data.agentId}`;
    setMessages(prev => {
      if (prev.some(m => m.id === delegationId)) return prev;
      return [...prev, {
        id: delegationId,
        role: 'delegation',
        agentName: data.agentName,
        agentEmoji: data.agentEmoji,
        agentType: data.agentType,
        mission: data.mission,
        timestamp: data.timestamp,
      }];
    });
  }, []);

  // ========================================================================
  // Subscribe to WebSocket events for this conversation
  // ========================================================================

  useEffect(() => {
    if (!conversationId || !subscribe) return;

    const handleEvent = (data) => {
      switch (data.type) {
        case 'message':
          handleIncomingMessage(data);
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
        case 'error':
          handleError(data);
          break;
        case 'tool_requested':
          handleToolRequested(data);
          break;
        case 'tool_execution_finished':
          handleToolFinished(data);
          break;
        case 'delegation':
          handleDelegation(data);
          break;
        default:
          break;
      }
    };

    return subscribe(conversationId, handleEvent);
  }, [conversationId, subscribe, handleIncomingMessage, handleStreamStart, handleStreamChunk, handleStreamEnd, handleError, handleToolRequested, handleToolFinished, handleDelegation]);

  // ========================================================================
  // Auto-scroll
  // ========================================================================

  useEffect(() => {
    if (isAtBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 40;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // ========================================================================
  // Send message
  // ========================================================================

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || !sendMessage || !conversationId) return;

    const messageId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Optimistic add to local messages
    setMessages(prev => [...prev, {
      id: messageId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }]);

    // Send via WebSocket
    sendMessage({
      type: 'message',
      messageId,
      content: text,
      conversationId,
    });

    setInput('');
    setIsStreaming(true); // Expect a response
    isAtBottomRef.current = true;
  }, [input, sendMessage, conversationId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // ========================================================================
  // Toggle expand/collapse
  // ========================================================================

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev);
    if (!expanded) {
      setNewMessageCount(0);
    }
  }, [expanded]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  // ========================================================================
  // Render
  // ========================================================================

  if (!conversationId) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className={`mission-chat-panel ${expanded ? 'expanded' : 'collapsed'}`}
      style={expanded ? { height: panelHeight } : undefined}
    >
      {expanded && (
        <div
          className="mission-chat-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
      )}
      <div className="mission-chat-header" onClick={handleToggle}>
        <span className="mission-chat-header-label">
          {contextLabel}
          {isStreaming && expanded && <span className="mission-chat-streaming-dot" />}
        </span>
        <span className="mission-chat-header-actions">
          {!expanded && newMessageCount > 0 && (
            <span className="mission-chat-badge">{newMessageCount}</span>
          )}
          <span className="mission-chat-chevron">{expanded ? '▾' : '▸'}</span>
        </span>
      </div>

      {expanded && (
        <div className="mission-chat-body">
          <div
            className="mission-chat-messages"
            ref={messagesContainerRef}
            onScroll={handleScroll}
          >
            {messages.length === 0 && historyLoaded && (
              <div className="mission-chat-empty">
                No messages yet. Start a conversation{readOnly ? '.' : ' below.'}
              </div>
            )}

            {messages.map(msg => (
              <MissionChatMessage key={msg.id} msg={msg} />
            ))}

            <div ref={messagesEndRef} />
          </div>

          {!readOnly && (
            <div className="mission-chat-input-wrapper">
              <textarea
                ref={inputRef}
                className="mission-chat-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={1}
                disabled={isStreaming}
              />
              <button
                className="mission-chat-send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() || isStreaming}
                title="Send"
              >
                ↑
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Individual message renderer — uses same classes as main Chat tab
// ============================================================================

const MissionChatMessage = memo(function MissionChatMessage({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="message user">
        <div className="message-avatar">👤</div>
        <div className="message-content">
          <MessageContent content={msg.content} isStreaming={false} />
        </div>
      </div>
    );
  }

  if (msg.role === 'tool') {
    return (
      <div className={`tool-event ${msg.status}`}>
        <span className="tool-icon">🔧</span>
        <span className="tool-status-indicator">
          {msg.status === 'running' ? '◐' : msg.status === 'completed' ? '✓' : '✗'}
        </span>
        <span className="tool-name">{msg.toolName}</span>
        {msg.durationMs != null && (
          <span className="tool-duration">{msg.durationMs}ms</span>
        )}
      </div>
    );
  }

  if (msg.role === 'delegation') {
    return (
      <div className="delegation-event">
        <span className="delegation-icon">{msg.agentEmoji || '🤖'}</span>
        <span className="delegation-label">Delegated to <strong>{msg.agentName || msg.agentType}</strong></span>
      </div>
    );
  }

  // assistant (default)
  const label = msg.agentName || 'Mission Lead';
  const emoji = msg.agentEmoji || '🎯';

  return (
    <div className={`message assistant${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
      <div className="message-avatar">{emoji}</div>
      <div className="message-content">
        {label && <div className="agent-name">{label}</div>}
        <MessageContent
          content={msg.content}
          isStreaming={msg.isStreaming || false}
        />
      </div>
    </div>
  );
});
