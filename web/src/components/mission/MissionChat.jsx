/**
 * MissionChat — embedded chat panel for mission and pillar conversations.
 *
 * This is a panel wrapper around AgentChat that provides:
 * - Collapsible header with expand/collapse
 * - Resizable panel height
 * - New message badge when collapsed
 * - Streaming indicator in header
 *
 * Props:
 *   conversationId  — the mission/pillar conversation ID
 *   contextLabel    — display label (e.g., "Mission Chat", "Build Performance Chat")
 *   placeholder     — input placeholder text (not used, AgentChat has its own)
 *   sendMessage     — WebSocket sendMessage function from useWebSocket
 *   subscribe       — subscribe(conversationId, callback) from useConversationSubscription
 *   readOnly        — if true, hide input (for completed task execution logs)
 *   defaultExpanded — initial expand state (default: true)
 */

import { useState, useRef, useCallback, memo } from 'react';
import { AgentChat } from '../chat/AgentChat';
import './MissionChat.css';

const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 600;

export const MissionChat = memo(function MissionChat({
  conversationId,
  contextLabel = 'Chat',
  placeholder, // Not used - AgentChat has its own placeholder
  sendMessage,
  subscribe,
  readOnly = false,
  defaultExpanded = true,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [isStreaming, setIsStreaming] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const panelRef = useRef(null);
  const isResizingRef = useRef(false);
  const agentChatRef = useRef(null);

  // Track message count changes for badge
  const lastMessageCountRef = useRef(0);

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
  // Toggle expand/collapse
  // ========================================================================

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev);
    if (!expanded) {
      setNewMessageCount(0);
    }
  }, [expanded]);

  // ========================================================================
  // Track streaming state from AgentChat
  // ========================================================================

  const handleStreamingChange = useCallback((streaming) => {
    setIsStreaming(streaming);
  }, []);

  // ========================================================================
  // Track message count for badge when collapsed
  // ========================================================================

  const handleMessagesChange = useCallback((messages) => {
    const count = messages.length;
    if (!expanded && count > lastMessageCountRef.current) {
      setNewMessageCount(prev => prev + (count - lastMessageCountRef.current));
    }
    lastMessageCountRef.current = count;
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
          role="slider"
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_HEIGHT}
          aria-valuemax={MAX_PANEL_HEIGHT}
          aria-valuenow={panelHeight}
          title="Drag to resize"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setPanelHeight(prev => Math.min(MAX_PANEL_HEIGHT, prev + 20));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setPanelHeight(prev => Math.max(MIN_PANEL_HEIGHT, prev - 20));
            }
          }}
        />
      )}
      <button
        className="mission-chat-header"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${contextLabel}`}
        type="button"
      >
        <span className="mission-chat-header-label">
          {contextLabel}
          {isStreaming && expanded && <span className="mission-chat-streaming-dot" aria-label="Agent is typing" />}
        </span>
        <span className="mission-chat-header-actions">
          {!expanded && newMessageCount > 0 && (
            <span className="mission-chat-badge" aria-label={`${newMessageCount} new messages`}>
              {newMessageCount}
            </span>
          )}
          <span className="mission-chat-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </span>
      </button>

      {expanded && (
        <div className="mission-chat-body">
          <AgentChat
            ref={agentChatRef}
            conversationId={conversationId}
            sendMessage={sendMessage}
            subscribe={subscribe}
            isConnected={true}
            readOnly={readOnly}
            loadHistory={true}
            showToolDetails={true}
            showUsageStats={false}
            showCitations={false}
            showTraceLink={false}
            onMessagesChange={handleMessagesChange}
            onStreamingChange={handleStreamingChange}
            className="mission-chat-agent-chat"
          />
        </div>
      )}
    </div>
  );
});
