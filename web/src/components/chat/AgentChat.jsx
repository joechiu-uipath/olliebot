/**
 * AgentChat — flexible chat component for agent conversations.
 *
 * This component can either:
 * 1. Use an existing app-wide WebSocket (pass sendMessage, subscribe props)
 * 2. Create its own internal WebSocket connection (standalone mode)
 *
 * Features:
 * - Virtualized message list (react-virtuoso) for performance
 * - Message history loading with automatic pagination
 * - Expandable tool details and collapsible agent messages
 * - Citations and usage stats display
 * - Full ChatInput with attachments, voice, reasoning modes, agent commands
 * - Auto-scroll with manual scroll override
 *
 * Usage Mode 1 - With app-wide WebSocket:
 *   <AgentChat
 *     conversationId={id}
 *     sendMessage={appSendMessage}
 *     subscribe={appSubscribe}
 *     isConnected={appIsConnected}
 *   />
 *
 * Usage Mode 2 - Standalone (creates internal WebSocket):
 *   <AgentChat conversationId={id} />
 *
 * Internal WebSocket Lifecycle Hooks (only used in standalone mode):
 * - onBeforeSend: Modify or cancel outgoing messages
 * - onAfterSend: React to sent messages
 * - onWebSocketMessage: Handle all incoming WebSocket messages
 * - onConnectionChange: React to connection state changes
 * - onWebSocketError: Handle WebSocket errors
 *
 * This component is designed to be used as:
 * 1. The main chat in the Chat tab (full features)
 * 2. Embedded chats like MissionChat (same features, different context)
 */

import { useState, useEffect, useRef, useCallback, memo, useImperativeHandle } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAgentChatWebSocket } from './useAgentChatWebSocket';
import { useChatMessages } from './useChatMessages';
import { AgentChatMessage } from './AgentChatMessage';
import { AgentChatInput } from './AgentChatInput';
import './styles.css';

// Virtuoso reverse-scroll: start index high so prepending older messages works smoothly
const VIRTUOSO_START_INDEX = 10000;

/**
 * Convert a File to base64 string.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * @typedef {Object} AgentChatProps
 * @property {string} conversationId - The conversation ID
 *
 * @property {Function} [sendMessage] - External WebSocket send function: (msg) => void
 * @property {Function} [subscribe] - External subscription function: (conversationId, handler) => unsubscribe
 * @property {Function} [requestActiveState] - Request active stream/tool state: (conversationId) => void
 * @property {boolean} [isConnected] - External WebSocket connection status
 *
 * If sendMessage/subscribe are not provided, the component creates its own WebSocket:
 * @property {string} [wsUrl] - WebSocket URL (default: auto-detect from window.location)
 * @property {Function} [onBeforeSend] - Called before sending: (message) => message | null (return null to cancel)
 * @property {Function} [onAfterSend] - Called after sending: (message) => void
 * @property {Function} [onWebSocketMessage] - Called for all WebSocket messages: (data) => void
 * @property {Function} [onConnectionChange] - Called when connection state changes: (connected) => void
 * @property {Function} [onWebSocketError] - Called on WebSocket error: (error) => void
 *
 * @property {boolean} [loadHistory=true] - Load message history on mount
 * @property {boolean} [showToolDetails=true] - Show expandable tool details
 * @property {boolean} [showUsageStats=true] - Show token usage stats
 * @property {boolean} [showCitations=true] - Show citation panel
 * @property {boolean} [showTraceLink=false] - Show link to trace details
 * @property {Array} [agentTemplates=[]] - Agent templates for collapse settings
 *
 * @property {boolean} [readOnly=false] - Hide input area
 * @property {Object} [modelCapabilities] - Model capabilities for reasoning modes (auto-fetched if not provided)
 * @property {Array} [commandTriggers] - Agent command triggers for # menu (auto-fetched if not provided)
 *
 * @property {Function} [onTraceClick] - Callback: (traceId) => void
 * @property {Function} [onMessagesChange] - Callback: (messages) => void
 * @property {Function} [onStreamingChange] - Callback: (isStreaming) => void
 *
 * @property {string} [className] - Additional CSS class
 * @property {Object} [style] - Inline styles
 * @property {React.Ref} [ref] - Ref for imperative API:
 *   - getMessages(): Message[] - Get current messages
 *   - isStreaming(): boolean - Check if streaming
 *   - isConnected(): boolean - Check WebSocket connection
 *   - scrollToBottom() - Scroll to latest message
 *   - clearMessages() - Clear all messages
 *   - addMessage(content, options) - Add user message
 *   - setMessages(messages) - Replace all messages
 *   - sendMessage(message) - Send raw WebSocket message
 *   - focus() - Focus input
 *   - clearInput() - Clear input field
 */

export const AgentChat = memo(function AgentChat({
  // Required
  conversationId,

  // External WebSocket (if provided, uses these instead of internal WebSocket)
  sendMessage: externalSendMessage,
  subscribe: externalSubscribe,
  requestActiveState: externalRequestActiveState,
  isConnected: externalIsConnected,

  // Internal WebSocket configuration (only used if external not provided)
  wsUrl,
  onBeforeSend,
  onAfterSend,
  onWebSocketMessage,
  onConnectionChange,
  onWebSocketError,

  // Features
  loadHistory = true,
  showToolDetails = true,
  showUsageStats = true,
  showCitations = true,
  showTraceLink = false,
  agentTemplates = [],

  // Input configuration
  readOnly = false,
  modelCapabilities: externalModelCapabilities,
  commandTriggers: externalCommandTriggers,

  // Callbacks
  onTraceClick,
  onMessagesChange,
  onStreamingChange,

  // Styling
  className = '',
  style,

  // Ref
  ref,
}) {
  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  // Use external WebSocket if provided, otherwise create internal one
  const useInternalWebSocket = !externalSendMessage || !externalSubscribe;

  const internalWs = useAgentChatWebSocket({
    enabled: useInternalWebSocket,
    wsUrl,
    onBeforeSend,
    onAfterSend,
    onMessage: onWebSocketMessage,
    onConnectionChange,
    onError: onWebSocketError,
  });

  // Select external or internal WebSocket functions
  const isConnected = externalIsConnected ?? internalWs.isConnected;
  const sendMessage = externalSendMessage ?? internalWs.sendMessage;
  const subscribe = externalSubscribe ?? internalWs.subscribe;
  const requestActiveState = externalRequestActiveState ?? internalWs.requestActiveState;

  // ============================================================================
  // Model Capabilities & Command Triggers (auto-fetch if not provided)
  // ============================================================================

  const [internalModelCapabilities, setInternalModelCapabilities] = useState({ reasoningEfforts: [] });
  const [internalCommandTriggers, setInternalCommandTriggers] = useState([]);

  // Fetch startup data if not provided externally
  useEffect(() => {
    // Skip fetch if external values are provided
    if (externalModelCapabilities || externalCommandTriggers) return;

    fetch('/api/startup')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          if (data.modelCapabilities) {
            setInternalModelCapabilities(data.modelCapabilities);
          }
          if (data.commandTriggers) {
            setInternalCommandTriggers(data.commandTriggers);
          }
        }
      })
      .catch((err) => {
        console.error('[AgentChat] Failed to fetch startup data:', err);
      });
  }, [externalModelCapabilities, externalCommandTriggers]);

  // Use external values if provided, otherwise use internal
  const modelCapabilities = externalModelCapabilities ?? internalModelCapabilities;
  const commandTriggers = externalCommandTriggers ?? internalCommandTriggers;

  // ============================================================================
  // UI State
  // ============================================================================

  // Expanded state for tools and collapsible agent messages
  const [expandedTools, setExpandedTools] = useState(new Set());
  const [expandedAgentMessages, setExpandedAgentMessages] = useState(new Set());

  // Scroll state
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Pagination state for Virtuoso
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_START_INDEX);

  // Input state (managed internally)
  const [attachments, setAttachments] = useState([]);
  const [reasoningMode, setReasoningMode] = useState(null);
  const [messageType, setMessageType] = useState(null);
  const [agentCommand, setAgentCommand] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Refs
  const virtuosoRef = useRef(null);
  const chatInputRef = useRef(null);

  // ============================================================================
  // Chat Messages Hook
  // ============================================================================

  // Use the chat messages hook
  const {
    messages,
    isStreaming,
    historyLoaded,
    isLoadingHistory,
    hasMoreOlder,
    isLoadingOlder,
    addUserMessage,
    clearMessages,
    loadOlderMessages,
    setMessages,
  } = useChatMessages({
    conversationId,
    subscribe,
    loadHistory,
    onMessagesChange,
    onStreamingChange,
  });

  // Request active stream/tool state on mount and reconnect
  const hasRequestedActiveStateRef = useRef(false);
  useEffect(() => {
    if (requestActiveState && conversationId && isConnected && !hasRequestedActiveStateRef.current) {
      hasRequestedActiveStateRef.current = true;
      requestActiveState(conversationId);
    }
    // Reset when WebSocket disconnects so we request again after reconnect
    if (!isConnected) {
      hasRequestedActiveStateRef.current = false;
    }
  }, [requestActiveState, conversationId, isConnected]);

  // Adjust firstItemIndex when loading older messages
  useEffect(() => {
    // This effect runs after loadOlderMessages prepends messages
    // We need to adjust firstItemIndex to maintain scroll position
  }, [messages.length]);

  // ============================================================================
  // Toggle Functions
  // ============================================================================

  const toggleToolExpand = useCallback((toolId) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  const toggleAgentMessageExpand = useCallback((messageId) => {
    setExpandedAgentMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  // ============================================================================
  // Scroll Handling
  // ============================================================================

  const scrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: 'smooth',
      align: 'end',
    });
  }, [messages.length]);

  const handleAtBottomStateChange = useCallback((atBottom) => {
    setShowScrollButton(!atBottom);
  }, []);

  // Load older messages when reaching the top
  const handleStartReached = useCallback(() => {
    if (hasMoreOlder && !isLoadingOlder) {
      // Adjust firstItemIndex before loading to maintain scroll position
      const currentLength = messages.length;
      loadOlderMessages().then(() => {
        // Adjust firstItemIndex by the number of new messages
        const newLength = messages.length;
        const added = newLength - currentLength;
        if (added > 0) {
          setFirstItemIndex((prev) => prev - added);
        }
      });
    }
  }, [hasMoreOlder, isLoadingOlder, messages.length, loadOlderMessages]);

  // ============================================================================
  // Attachment Handling
  // ============================================================================

  const processFiles = useCallback((files) => {
    const validFiles = [];
    for (const file of files) {
      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        console.warn(`File ${file.name} exceeds 10MB limit`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setAttachments((prev) => [...prev, ...validFiles]);
    }
  }, []);

  const handleRemoveAttachment = useCallback((index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            // Create a named file (clipboard images don't have names)
            const namedFile = new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
            imageFiles.push(namedFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        setAttachments((prev) => [...prev, ...imageFiles]);
      }
    },
    []
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  // ============================================================================
  // Message Submission
  // ============================================================================

  const handleSubmit = useCallback(
    async (text) => {
      const content = typeof text === 'string' ? text.trim() : '';
      if ((!content && attachments.length === 0) || !sendMessage || !conversationId) return;

      // Process attachments to base64 for sending
      const processedAttachments = await Promise.all(
        attachments.map(async (file) => {
          const base64 = await fileToBase64(file);
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            data: base64,
          };
        })
      );

      // Add user message optimistically
      const messageId = addUserMessage(content, {
        attachments: attachments.map((a) => ({ name: a.name, type: a.type, size: a.size })),
        reasoningMode,
        messageType,
        agentCommand,
      });

      // Send via WebSocket
      sendMessage({
        type: 'message',
        messageId,
        content,
        conversationId,
        ...(processedAttachments.length > 0 && { attachments: processedAttachments }),
        ...(reasoningMode && { reasoningEffort: reasoningMode }),
        ...(messageType && { messageType }),
        ...(agentCommand && { agentCommand }),
      });

      // Clear input state
      setAttachments([]);
      setReasoningMode(null);
      setMessageType(null);
      setAgentCommand(null);

      // Scroll to bottom
      setTimeout(() => scrollToBottom(), 50);
    },
    [sendMessage, conversationId, attachments, reasoningMode, messageType, agentCommand, addUserMessage, scrollToBottom]
  );

  // ============================================================================
  // Imperative API
  // ============================================================================

  useImperativeHandle(
    ref,
    () => ({
      // State access
      getMessages: () => messages,
      isStreaming: () => isStreaming,
      isConnected: () => isConnected,

      // Actions
      scrollToBottom,
      clearMessages,
      addMessage: addUserMessage,
      setMessages,
      sendMessage, // For programmatic message sending

      // Input control
      focus: () => chatInputRef.current?.focus?.(),
      clearInput: () => chatInputRef.current?.clear?.(),

      // Virtuoso ref
      virtuoso: virtuosoRef.current,
    }),
    [messages, isStreaming, isConnected, scrollToBottom, clearMessages, addUserMessage, setMessages, sendMessage]
  );

  // ============================================================================
  // Message Rendering Options
  // ============================================================================

  const messageOptions = {
    showToolDetails,
    showUsageStats,
    showCitations,
    agentTemplates,
    expandedTools,
    expandedAgentMessages,
    onToggleToolExpand: toggleToolExpand,
    onToggleAgentExpand: toggleAgentMessageExpand,
    onTraceClick: showTraceLink ? onTraceClick : undefined,
  };

  // ============================================================================
  // Virtuoso Item Renderer
  // ============================================================================

  const renderItem = useCallback(
    (index, msg) => (
      <AgentChatMessage key={msg.id} msg={msg} options={messageOptions} />
    ),
    [messageOptions]
  );

  // Virtuoso header for loading indicator
  const VirtuosoHeader = useCallback(() => {
    if (isLoadingOlder) {
      return (
        <div className="agent-chat-loading-older">
          <span className="loading-spinner" />
          Loading older messages...
        </div>
      );
    }
    if (!hasMoreOlder && historyLoaded && messages.length > 0) {
      return <div className="agent-chat-start-of-conversation">Start of conversation</div>;
    }
    return null;
  }, [isLoadingOlder, hasMoreOlder, historyLoaded, messages.length]);

  // ============================================================================
  // Render
  // ============================================================================

  if (!conversationId) {
    return null;
  }

  return (
    <div
      className={`agent-chat ${className} ${isDragOver ? 'drag-over' : ''}`}
      style={style}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="agent-chat-messages">
        {isLoadingHistory && messages.length === 0 ? (
          <div className="agent-chat-loading">
            <span className="loading-spinner" />
            Loading messages...
          </div>
        ) : messages.length === 0 && historyLoaded ? (
          <div className="agent-chat-empty">
            No messages yet. {readOnly ? '' : 'Start a conversation below.'}
          </div>
        ) : (
          <Virtuoso
            key={conversationId}
            ref={virtuosoRef}
            data={messages}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={messages.length - 1}
            itemContent={renderItem}
            followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
            atBottomStateChange={handleAtBottomStateChange}
            atBottomThreshold={100}
            startReached={handleStartReached}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            components={{
              Header: VirtuosoHeader,
            }}
            className="agent-chat-virtuoso"
          />
        )}

        {showScrollButton && (
          <button
            type="button"
            className="agent-chat-scroll-button"
            onClick={scrollToBottom}
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>

      {!readOnly && (
        <div className="agent-chat-input-area">
          <AgentChatInput
            ref={chatInputRef}
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            attachments={attachments}
            onRemoveAttachment={handleRemoveAttachment}
            isConnected={isConnected}
            isResponsePending={isStreaming}
            reasoningMode={reasoningMode}
            messageType={messageType}
            onReasoningModeChange={setReasoningMode}
            onMessageTypeChange={setMessageType}
            modelCapabilities={modelCapabilities}
            commandTriggers={commandTriggers}
            agentCommand={agentCommand}
            onAgentCommandChange={setAgentCommand}
          />
        </div>
      )}
    </div>
  );
});

export default AgentChat;
