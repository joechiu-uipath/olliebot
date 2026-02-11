import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useWebSocket } from './hooks/useWebSocket';

import { ComputerUseSessions } from './components/ComputerUseSessions';
import { BrowserPreview } from './components/BrowserPreview';
import { DesktopPreview } from './components/DesktopPreview';
import RAGProjects from './components/RAGProjects';
import { CitationPanel } from './components/CitationPanel';
import { PDFViewerModal } from './components/PDFViewerModal';
import { ChatInput } from './components/ChatInput';
import { AudioPlayer } from './components/AudioPlayer';
import { MessageContent } from './components/MessageContent';
import { CodeBlock } from './components/CodeBlock';

// Extracted eval mode (fully self-contained)
import { useEvalMode, EvalSidebarContent, EvalMainContent } from './App.Eval';

// Extracted utilities
import { transformMessages, shouldCollapseByDefault } from './utils/messageHelpers';
import { createMessageHandler } from './App.websocket';

// Mode constants
const MODES = {
  CHAT: 'chat',
  EVAL: 'eval',
};

// Branding constants
const SUPERVISOR_ICON = '🐙';
const SUPERVISOR_NAME = 'OllieBot';
const DEFAULT_AGENT_ICON = '🤖';

// Display limits
const DELEGATION_MISSION_MAX_LENGTH = 500;

// API constants
const MESSAGE_PAGE_SIZE = 20;

// Virtuoso reverse-scroll: start index high so prepending older messages
// (which decrements this) never reaches zero. The exact value doesn't matter
// as long as it exceeds the maximum number of messages a conversation can have.
const VIRTUOSO_START_INDEX = 100000;

// Module-level flag to prevent double-fetching in React Strict Mode
// (Strict Mode unmounts/remounts component, so refs don't persist)
let appInitialLoadDone = false;

function App() {
  // Router hooks
  const navigate = useNavigate();
  const location = useLocation();

  // Derive mode from URL path
  const mode = location.pathname.startsWith('/eval') ? MODES.EVAL : MODES.CHAT;

  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Accordion states
  const [expandedAccordions, setExpandedAccordions] = useState({
    tasks: false,
    skills: false,
    mcps: false,
    tools: false,
    computerUse: false,
    ragProjects: false,
  });
  const [agentTasks, setAgentTasks] = useState([]);
  const [skills, setSkills] = useState([]);
  const [mcps, setMcps] = useState([]);
  const [tools, setTools] = useState({ builtin: [], user: [], mcp: {} });
  const [expandedToolGroups, setExpandedToolGroups] = useState({});

  // Browser session state
  const [browserSessions, setBrowserSessions] = useState([]);
  const [selectedBrowserSessionId, setSelectedBrowserSessionId] = useState(null);
  const [browserScreenshots, setBrowserScreenshots] = useState({});
  const [clickMarkers, setClickMarkers] = useState([]);

  // Desktop session state
  const [desktopSessions, setDesktopSessions] = useState([]);
  const [selectedDesktopSessionId, setSelectedDesktopSessionId] = useState(null);
  const [desktopScreenshots, setDesktopScreenshots] = useState({});
  const [desktopClickMarkers, setDesktopClickMarkers] = useState([]);

  // RAG projects state
  const [ragProjects, setRagProjects] = useState([]);
  const [ragIndexingProgress, setRagIndexingProgress] = useState({}); // { projectId: { status, ... } }

  // Eval state (shared via WebSocket, not a separate connection)
  const [evalJobId, setEvalJobId] = useState(null);
  const [evalProgress, setEvalProgress] = useState(null);
  const [evalResults, setEvalResults] = useState(null);
  const [evalError, setEvalError] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const evalJobIdRef = useRef(null);

  // Agent templates metadata (fetched from backend for collapse settings, display names, etc.)
  const [agentTemplates, setAgentTemplates] = useState([]);

  // Actions menu state
  const [openMenuId, setOpenMenuId] = useState(null);

  // Inline rename state
  const [editingConversationId, setEditingConversationId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const renameInputRef = useRef(null);

  // Auto-scroll state
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Pagination state for virtualization
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_START_INDEX);

  // Expanded tool events
  const [expandedTools, setExpandedTools] = useState(new Set());

  // Expanded agent messages (for agents that collapse by default, like research-worker)
  const [expandedAgentMessages, setExpandedAgentMessages] = useState(new Set());

  // Eval mode - managed by useEvalMode hook (state lives in App.Eval.jsx)
  const evalMode = useEvalMode();

  // Response pending state (disable input while waiting)
  const [isResponsePending, setIsResponsePending] = useState(false);

  // PDF viewer modal state
  const [pdfViewerState, setPdfViewerState] = useState({
    isOpen: false,
    fileUrl: null,
    filename: null,
    initialPage: 1,
  });

  // Reasoning mode state
  const [reasoningMode, setReasoningMode] = useState(null); // null | 'high' | 'xhigh'
  const [messageType, setMessageType] = useState(null); // null | 'deep_research' (legacy, may be removed)
  const [modelCapabilities, setModelCapabilities] = useState({ reasoningEfforts: [] });
  const [commandTriggers, setCommandTriggers] = useState([]); // Agent command triggers from backend
  const [agentCommand, setAgentCommand] = useState(null); // { command: 'Deep Research', icon: '🔬' }

  const virtuosoRef = useRef(null);
  const chatInputRef = useRef(null);

  // Ref for scrollToBottom function (used by WebSocket handler)
  const scrollToBottomRef = useRef(null);

  // Ref to track current conversation ID for use in callbacks
  const currentConversationIdRef = useRef(currentConversationId);

  // Ref to track navigate function for use in callbacks
  const navigateRef = useRef(navigate);

  // Update refs via effect (not during render - React Compiler requirement)
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Listen for PDF view events from citation components
  useEffect(() => {
    const handlePdfView = (event) => {
      const { fileUrl, filename, initialPage } = event.detail;
      setPdfViewerState({
        isOpen: true,
        fileUrl,
        filename,
        initialPage: initialPage || 1,
      });
    };

    window.addEventListener('pdf-view', handlePdfView);
    return () => window.removeEventListener('pdf-view', handlePdfView);
  }, []);

  // Close PDF viewer
  const closePdfViewer = useCallback(() => {
    setPdfViewerState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // WebSocket message handler - created once using useState lazy initializer
  // (useState initializer only runs once and avoids ref-access-during-render)
  const [handleMessage] = useState(() => createMessageHandler({
    // Getter/setter functions for ref values (called at message time, not render time)
    getCurrentConversationId: () => currentConversationIdRef.current,
    setCurrentConversationIdRef: (id) => { currentConversationIdRef.current = id; },
    getNavigate: () => navigateRef.current,
    // State setters (stable by React guarantee)
    setMessages,
    setIsResponsePending,
    setIsConnected,
    setConversations,
    setCurrentConversationId,
    setAgentTasks,
    setBrowserSessions,
    setBrowserScreenshots,
    setSelectedBrowserSessionId,
    setClickMarkers,
    setExpandedAccordions,
    // Desktop session state setters
    setDesktopSessions,
    setDesktopScreenshots,
    setSelectedDesktopSessionId,
    setDesktopClickMarkers,
    setRagProjects,
    setRagIndexingProgress,
    // Eval state (shared WebSocket, no separate connection needed)
    getEvalJobId: () => evalJobIdRef.current,
    setEvalProgress,
    setEvalResults,
    setEvalError,
    setEvalLoading,
    // Scroll callback (accessed via ref since it's defined later)
    scrollToBottom: () => scrollToBottomRef.current?.(),
  }));

  // Callback to set evalJobId - updates both ref (for WebSocket handler) and state
  const setEvalJobIdWithRef = useCallback((jobId) => {
    evalJobIdRef.current = jobId;
    setEvalJobId(jobId);
  }, []);

  // Eval state object to pass to EvalMainContent
  const evalState = useMemo(() => ({
    jobId: evalJobId,
    progress: evalProgress,
    results: evalResults,
    error: evalError,
    loading: evalLoading,
    setJobId: setEvalJobIdWithRef,
    setProgress: setEvalProgress,
    setResults: setEvalResults,
    setError: setEvalError,
    setLoading: setEvalLoading,
  }), [evalJobId, evalProgress, evalResults, evalError, evalLoading, setEvalJobIdWithRef]);

  // Ref to hold the loadStartupData function (updated via effect)
  const loadStartupDataRef = useRef(null);

  // Helper to process startup data (outside try/catch for React Compiler compatibility)
  const processStartupData = useCallback((data) => {
    // Model capabilities
    setModelCapabilities(data.modelCapabilities);

    // Conversations
    const mappedConversations = data.conversations.map(c => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt || c.updated_at,
      isWellKnown: c.isWellKnown || false,
      icon: c.icon,
    }));
    setConversations(mappedConversations);

    // Set default conversation
    const feedConversation = mappedConversations.find(c => c.id === 'feed');
    if (feedConversation) {
      setCurrentConversationId(feedConversation.id);
    } else if (mappedConversations.length > 0) {
      setCurrentConversationId(mappedConversations[0].id);
    }

    // Messages - handle new feedMessages paginated structure
    const feedData = data.feedMessages;
    if (feedData && feedData.items) {
      const pagination = feedData.pagination || {};
      const items = transformMessages(feedData.items);
      setMessages(items);
      // Initialize pagination state
      setHasMoreOlder(pagination.hasOlder || false);
      setOldestCursor(pagination.oldestCursor || null);
      // Reset to starting high index for prepending
      setFirstItemIndex(VIRTUOSO_START_INDEX);
    } else {
      // Fallback for backwards compatibility
      setMessages([]);
      setHasMoreOlder(false);
      setOldestCursor(null);
      setFirstItemIndex(0);
    }

    // Sidebar data
    setAgentTasks(data.tasks);
    setSkills(data.skills);
    setMcps(data.mcps);
    setTools(data.tools);
    const ragProjectsData = data.ragProjects;
    if (ragProjectsData) {
      setRagProjects(ragProjectsData);
    } else {
      setRagProjects([]);
    }

    // Agent templates (for collapse settings, display names, etc.)
    if (data.agentTemplates) {
      setAgentTemplates(data.agentTemplates);
    }

    // Command triggers for #menu (agent commands like #Deep Research, #Modify)
    if (data.commandTriggers) {
      setCommandTriggers(data.commandTriggers);
    }
  }, []);

  // Update loadStartupData ref via effect (not during render)
  useEffect(() => {
    loadStartupDataRef.current = async () => {
      let res = null;
      try {
        res = await fetch('/api/startup');
      } catch (error) {
        console.error('Failed to load startup data:', error);
      }

      if (res && res.ok) {
        const data = await res.json();
        processStartupData(data);
      } else {
        setConversations([]);
        setCurrentConversationId(null);
        setMessages([]);
      }
      setConversationsLoading(false);
      setShowSkeleton(false);
    };
  }, [processStartupData]);

  // Track if this is the first connection (to avoid refreshing on initial connect)
  const hasConnectedOnce = useRef(false);

  const handleOpen = () => {
    setIsConnected(true);
    // Only refresh data on REconnection, not initial connection
    // (initial data load is handled by the mount useEffect)
    if (hasConnectedOnce.current) {
      loadStartupDataRef.current?.();
    }
    hasConnectedOnce.current = true;
  };
  const handleClose = () => setIsConnected(false);

  const { sendMessage, connectionState } = useWebSocket({
    onMessage: handleMessage,
    onOpen: handleOpen,
    onClose: handleClose,
  });

  // Load all startup data on mount (single consolidated API call)
  useEffect(() => {
    // Guard against React Strict Mode double-invocation
    if (appInitialLoadDone) return;
    appInitialLoadDone = true;

    // Show skeleton after 500ms if still loading
    const skeletonTimer = setTimeout(() => {
      setShowSkeleton(true);
    }, 500);

    loadStartupDataRef.current?.().finally(() => clearTimeout(skeletonTimer));

    return () => clearTimeout(skeletonTimer);
  }, []);

  // Sync URL to state for chat mode deep linking
  // Ref to prevent re-triggering when we programmatically set state
  const isNavigatingRef = useRef(false);
  // Fetch counter to prevent stale responses from overwriting newer ones
  const messageFetchCounter = useRef(0);

  useEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    const path = location.pathname;

    // Handle chat routes - all conversations use /chat/:id pattern
    if (path.startsWith('/chat/')) {
      const convId = decodeURIComponent(path.slice(6)); // Remove '/chat/'
      if (convId && convId !== currentConversationId) {
        setCurrentConversationId(convId);
        // Load conversation messages with pagination
        const apiConvId = encodeURIComponent(convId);
        const fetchId = ++messageFetchCounter.current;
        fetch(`/api/conversations/${apiConvId}/messages?limit=${MESSAGE_PAGE_SIZE}&includeTotal=true`)
          .then(res => res.ok ? res.json() : { items: [], pagination: {} })
          .then(data => {
            // Only update if this is still the latest fetch
            if (fetchId !== messageFetchCounter.current) return;
            const pagination = data.pagination || {};
            setMessages(transformMessages(data.items || []));
            setHasMoreOlder(pagination.hasOlder || false);
            setOldestCursor(pagination.oldestCursor || null);
            setFirstItemIndex(VIRTUOSO_START_INDEX);

            // Request active stream/tool state for this conversation (to resume in-progress displays)
            sendMessage({ type: 'get-active-stream', conversationId: convId });
          })
          .catch(() => {
            if (fetchId !== messageFetchCounter.current) return;
            setMessages([]);
            setHasMoreOlder(false);
            setOldestCursor(null);
          });
      }
    }
    // Note: Eval routes are handled by useEvalMode hook in App.Eval.jsx
  }, [location.pathname, conversations, currentConversationId, transformMessages, sendMessage]);

  // Redirect root and /chat to Feed conversation
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/chat') {
      navigate('/chat/feed', { replace: true });
    }
  }, [location.pathname, navigate]);

  // Request active stream/tool state when WebSocket connects (handles page refresh case)
  const hasRequestedActiveStateRef = useRef(false);
  useEffect(() => {
    if (isConnected && currentConversationId && !hasRequestedActiveStateRef.current) {
      hasRequestedActiveStateRef.current = true;
      sendMessage({ type: 'get-active-stream', conversationId: currentConversationId });
    }
    // Reset when WebSocket disconnects so we request again after reconnect
    if (!isConnected) {
      hasRequestedActiveStateRef.current = false;
    }
  }, [isConnected, currentConversationId, sendMessage]);

  // Scroll to bottom handler for Virtuoso
  const scrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: 'smooth',
      align: 'end',
    });
  }, [messages.length]);

  // Keep ref updated for WebSocket handler access
  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  // Load older messages when scrolling near unloaded area
  const loadOlderMessages = useCallback(async () => {
    if (isLoadingOlder || !hasMoreOlder || !oldestCursor) return;

    const convId = currentConversationIdRef.current;
    if (!convId) return;

    setIsLoadingOlder(true);
    // Capture current fetch counter to verify conversation hasn't changed
    const fetchId = messageFetchCounter.current;
    let res = null;
    try {
      const apiConvId = encodeURIComponent(convId);
      res = await fetch(
        `/api/conversations/${apiConvId}/messages?limit=20&before=${encodeURIComponent(oldestCursor)}`
      );
    } catch (error) {
      console.error('Failed to load older messages:', error);
    }

    // Bail if conversation changed while fetching
    if (fetchId !== messageFetchCounter.current) {
      setIsLoadingOlder(false);
      return;
    }

    let data = null;
    if (res && res.ok) {
      data = await res.json();
    }

    if (data) {
      const olderMessages = transformMessages(data.items || []);
      const pagination = data.pagination || {};

      if (olderMessages.length > 0) {
        // Prepend messages and adjust firstItemIndex for scroll position stability
        setFirstItemIndex((prev) => prev - olderMessages.length);
        setMessages((prev) => [...olderMessages, ...prev]);
        setHasMoreOlder(pagination.hasOlder || false);
        setOldestCursor(pagination.oldestCursor || null);
      } else {
        setHasMoreOlder(false);
      }
    }
    setIsLoadingOlder(false);
  }, [isLoadingOlder, hasMoreOlder, oldestCursor]);

  // Handle Virtuoso atBottomStateChange
  const handleAtBottomStateChange = useCallback((atBottom) => {
    setShowScrollButton(!atBottom);
  }, []);



  // Helper to insert a new conversation after well-known ones
  const insertConversation = (prev, newConv) => {
    const wellKnownCount = prev.filter((c) => c.isWellKnown).length;
    return [...prev.slice(0, wellKnownCount), newConv, ...prev.slice(wellKnownCount)];
  };

  // Start a new conversation
  const handleNewConversation = async () => {
    let res = null;
    try {
      // Create conversation on server
      res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
    } catch (error) {
      console.error('Failed to create new conversation:', error);
    }

    let newConv = null;
    if (res && res.ok) {
      newConv = await res.json();
    }

    if (newConv) {
      setConversations((prev) => insertConversation(prev, {
        id: newConv.id,
        title: newConv.title,
        updatedAt: newConv.updatedAt || new Date().toISOString(),
        isWellKnown: false,
      }));
      setCurrentConversationId(newConv.id);
      // Navigate to the new conversation URL
      navigate(`/chat/${encodeURIComponent(newConv.id)}`, { replace: true });
    } else {
      // Fallback to local-only
      const newId = `conv-${Date.now()}`;
      setConversations((prev) => insertConversation(prev, {
        id: newId,
        title: 'New Conversation',
        updatedAt: new Date().toISOString(),
        isWellKnown: false,
      }));
      setCurrentConversationId(newId);
      // Navigate to the new conversation URL
      navigate(`/chat/${encodeURIComponent(newId)}`, { replace: true });
    }

    // Tell server to start new conversation context
    sendMessage({ type: 'new-conversation' });

    // Clear local messages and reset pagination
    setMessages([]);
    setShowScrollButton(false);
    setIsResponsePending(false);
    setHasMoreOlder(false);
    setOldestCursor(null);
  };

  // Delete conversation (soft delete)
  const handleDeleteConversation = async (convId, e) => {
    e.stopPropagation(); // Prevent selecting the conversation
    setOpenMenuId(null);

    let deleteSuccess = false;
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
      });
      deleteSuccess = res.ok;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }

    if (!deleteSuccess) return;

    // Remove from local state
    setConversations((prev) => prev.filter((c) => c.id !== convId));

    // If deleted conversation was current, switch to another or clear
    if (convId === currentConversationId) {
      const remaining = conversations.filter((c) => c.id !== convId);
      if (remaining.length > 0) {
        const nextConv = remaining[0];
        setCurrentConversationId(nextConv.id);
        // Navigate to the next conversation
        navigate(`/chat/${encodeURIComponent(nextConv.id)}`);
        // Load messages for new current conversation with pagination
        const apiConvId = encodeURIComponent(nextConv.id);
        const fetchId = ++messageFetchCounter.current;
        fetch(`/api/conversations/${apiConvId}/messages?limit=${MESSAGE_PAGE_SIZE}&includeTotal=true`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            // Only update if this is still the latest fetch
            if (fetchId !== messageFetchCounter.current) return;
            if (data) {
              const pagination = data.pagination || {};
              setMessages(transformMessages(data.items || []));
              setHasMoreOlder(pagination.hasOlder || false);
              setOldestCursor(pagination.oldestCursor || null);
              setFirstItemIndex(VIRTUOSO_START_INDEX);
            }
          });
      } else {
        setCurrentConversationId(null);
        setMessages([]);
        setHasMoreOlder(false);
        setOldestCursor(null);
        setFirstItemIndex(VIRTUOSO_START_INDEX);
        navigate('/chat/feed');
      }
    }
  };

  // Clear all messages in a conversation (for well-known conversations like Feed)
  const handleClearConversation = async (convId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);

    let clearSuccess = false;
    try {
      const apiConvId = encodeURIComponent(convId);
      const res = await fetch(`/api/conversations/${apiConvId}/messages`, {
        method: 'DELETE',
      });
      clearSuccess = res.ok;
    } catch (error) {
      console.error('Failed to clear conversation:', error);
    }

    if (!clearSuccess) return;

    // If this is the current conversation, clear local messages
    if (convId === currentConversationId) {
      setMessages([]);
      setHasMoreOlder(false);
      setOldestCursor(null);
      setFirstItemIndex(VIRTUOSO_START_INDEX);
    }
  };

  // Start inline rename
  const handleRenameConversation = (convId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);

    const conversation = conversations.find((c) => c.id === convId);
    if (!conversation) return;

    setEditingConversationId(convId);
    setEditingTitle(conversation.title);
    // Focus and select the input text after render
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  // Save the rename
  const handleSaveRename = async () => {
    if (!editingConversationId) return;

    const originalConv = conversations.find((c) => c.id === editingConversationId);
    const newTitle = editingTitle.trim();

    // Cancel if empty or unchanged
    if (!newTitle || newTitle === originalConv?.title) {
      setEditingConversationId(null);
      setEditingTitle('');
      return;
    }

    let res = null;
    try {
      res = await fetch(`/api/conversations/${editingConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }

    let data = null;
    if (res && res.ok) {
      data = await res.json();
    }
    if (data) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === editingConversationId
            ? { ...c, title: data.conversation.title, manuallyNamed: true }
            : c
        )
      );
    }

    setEditingConversationId(null);
    setEditingTitle('');
  };

  // Cancel the rename
  const handleCancelRename = () => {
    setEditingConversationId(null);
    setEditingTitle('');
  };

  // Handle keydown in rename input
  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelRename();
    }
  };

  // Toggle actions menu
  const toggleActionsMenu = (convId, e) => {
    e.stopPropagation(); // Prevent selecting the conversation
    setOpenMenuId((prev) => (prev === convId ? null : convId));
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);


  // Switch conversation - navigates to the conversation URL
  const handleSelectConversation = (convId) => {
    if (convId === currentConversationId) return;

    // Mark that we're navigating to prevent URL sync effect from re-triggering
    isNavigatingRef.current = true;
    setShowScrollButton(false);
    // Reset pending state - the previous conversation's response shouldn't block the new one
    setIsResponsePending(false);

    // Navigate to the conversation URL
    navigate(`/chat/${encodeURIComponent(convId)}`);

    // Update state and load messages with pagination
    setCurrentConversationId(convId);
    const apiConvId = encodeURIComponent(convId);
    // Increment fetch counter to invalidate any in-flight fetches
    const fetchId = ++messageFetchCounter.current;
    fetch(`/api/conversations/${apiConvId}/messages?limit=${MESSAGE_PAGE_SIZE}&includeTotal=true`)
      .then(res => res.ok ? res.json() : { items: [], pagination: {} })
      .then(data => {
        // Only update if this is still the latest fetch
        if (fetchId !== messageFetchCounter.current) return;
        const pagination = data.pagination || {};
        setMessages(transformMessages(data.items || []));
        setHasMoreOlder(pagination.hasOlder || false);
        setOldestCursor(pagination.oldestCursor || null);
        setFirstItemIndex(VIRTUOSO_START_INDEX);

        // Request active stream state for this conversation (to resume streaming display)
        sendMessage({ type: 'get-active-stream', conversationId: convId });
      })
      .catch(() => {
        if (fetchId !== messageFetchCounter.current) return;
        setMessages([]);
        setHasMoreOlder(false);
        setOldestCursor(null);
      });
  };

  // Handle chat submission - receives input text from ChatInput component
  // Uses refs to avoid dependencies that would cause callback recreation
  const attachmentsRef = useRef(attachments);
  const reasoningModeRef = useRef(reasoningMode);
  const messageTypeRef = useRef(messageType);
  const agentCommandRef = useRef(agentCommand);

  // Keep refs in sync (currentConversationIdRef is already synced above)
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { reasoningModeRef.current = reasoningMode; }, [reasoningMode]);
  useEffect(() => { messageTypeRef.current = messageType; }, [messageType]);
  useEffect(() => { agentCommandRef.current = agentCommand; }, [agentCommand]);

  // Convert file to base64 (defined before handleSubmit which uses it)
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = useCallback(async (inputText) => {
    const currentAttachments = attachmentsRef.current;
    const currentReasoningMode = reasoningModeRef.current;
    const currentMessageType = messageTypeRef.current;
    const currentAgentCommand = agentCommandRef.current;
    const convId = currentConversationIdRef.current;

    if (!inputText.trim() && currentAttachments.length === 0) return;

    // Process attachments to base64
    const processedAttachments = await Promise.all(
      currentAttachments.map(async (file) => {
        const base64 = await fileToBase64(file);
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64,
        };
      })
    );

    // Generate a unique message ID for deduplication (prevents React Strict Mode double-sends)
    const messageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Add user message to UI immediately
    const userMessage = {
      id: messageId,
      role: 'user',
      content: inputText,
      attachments: currentAttachments.map(f => ({ name: f.name, type: f.type, size: f.size })),
      timestamp: new Date().toISOString(),
      reasoningMode: currentReasoningMode,
      messageType: currentMessageType,
      agentCommand: currentAgentCommand,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Scroll to bottom after adding user message (user expects to see the response)
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        behavior: 'smooth',
      });
    }, 50);

    // Send via WebSocket with conversation ID, attachments, reasoning effort, message type, and agent command
    sendMessage({
      type: 'message',
      messageId: messageId,
      content: inputText,
      attachments: processedAttachments,
      conversationId: convId,
      reasoningEffort: currentReasoningMode,
      messageType: currentMessageType,
      agentCommand: currentAgentCommand,
    });
    setAttachments([]);
    setReasoningMode(null);
    setMessageType(null);
    setAgentCommand(null);
    setIsResponsePending(true);
  }, [sendMessage]);

  // Handle file drop
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setAttachments((prev) => [...prev, ...files]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Handle paste - extract images from clipboard
  const handlePaste = useCallback((e) => {
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
  }, []);

  // Remove attachment
  const removeAttachment = useCallback((index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAction = (action, data) => {
    sendMessage({ type: 'action', action, data, conversationId: currentConversationId });
  };

  // Run a task immediately
  const handleRunTask = async (taskId) => {
    let success = false;
    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversationId }),
      });
      success = res.ok;
    } catch (error) {
      console.error('Error running task:', error);
    }

    if (success) {
      // Update the task in local state to show it's running
      setAgentTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'running' } : t
        )
      );
    } else {
      console.error('Failed to run task');
    }
  };

  // Toggle MCP enabled/disabled status
  const handleToggleMcp = async (mcpId, currentEnabled) => {
    const newEnabled = !currentEnabled;
    try {
      const res = await fetch(`/api/mcps/${mcpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (res.ok) {
        const updatedMcp = await res.json();
        // Update local state
        setMcps((prev) =>
          prev.map((mcp) =>
            mcp.id === mcpId ? { ...mcp, enabled: updatedMcp.enabled, toolCount: updatedMcp.toolCount } : mcp
          )
        );
        // Also update tools if the MCP was enabled/disabled
        // Refetch tools to reflect the change
        try {
          const toolsRes = await fetch('/api/tools');
          if (toolsRes.ok) {
            const toolsData = await toolsRes.json();
            setTools(toolsData);
          }
        } catch (e) {
          console.warn('Failed to refresh tools after MCP toggle:', e);
        }
      } else {
        console.error('Failed to toggle MCP:', await res.text());
      }
    } catch (error) {
      console.error('Error toggling MCP:', error);
    }
  };

  // Helper to check if a value is a data URL image
  const isDataUrlImage = (value) => {
    return typeof value === 'string' && value.startsWith('data:image/');
  };

  // Helper to check if result contains audio data (tool-agnostic)
  // Audio can be in obj.audio (legacy) or obj.output.audio (nested from native tools)
  const isAudioResult = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    // Check for audio field with base64 data (long string)
    if (obj.audio && typeof obj.audio === 'string' && obj.audio.length > 100) {
      return true;
    }
    // Check nested output.audio structure
    if (obj.output && typeof obj.output === 'object' && obj.output.audio && typeof obj.output.audio === 'string' && obj.output.audio.length > 100) {
      return true;
    }
    return false;
  };

  // Helper to extract audio data from result (handles both legacy and nested structures)
  const getAudioData = (obj) => {
    if (obj.audio && typeof obj.audio === 'string') {
      return { audio: obj.audio, mimeType: obj.mimeType };
    }
    if (obj.output && typeof obj.output === 'object' && obj.output.audio) {
      return { audio: obj.output.audio, mimeType: obj.output.mimeType };
    }
    return null;
  };

  // Helper to render output that might contain markdown code blocks
  const renderOutput = (output) => {
    if (typeof output !== 'string') {
      // Object output - render as property list
      const entries = Object.entries(output).filter(([key]) =>
        !['audio', 'mimeType', 'files'].includes(key)
      );
      if (entries.length === 0) return null;
      return (
        <div className="tool-result-properties">
          {entries.map(([key, value]) => (
            <div key={key} className="tool-result-property">
              <span className="tool-result-key">{key}:</span>{' '}
              <span className="tool-result-value">
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // Normalize escaped newlines (literal \n) to actual newlines
    let normalizedOutput = output;
    if (output.includes('\\n')) {
      normalizedOutput = output.replace(/\\n/g, '\n');
    }

    // Check for markdown code blocks (```language ... ```)
    const codeBlockRegex = /^```(\w+)?\n([\s\S]*?)\n```$/;
    const match = normalizedOutput.match(codeBlockRegex);
    if (match) {
      const language = match[1] || 'text';
      const code = match[2];
      return <CodeBlock language={language}>{code}</CodeBlock>;
    }

    // Plain text output (use normalized version so newlines display properly)
    return <pre className="tool-details-content" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{normalizedOutput}</pre>;
  };

  // Render tool result with special handling for images and audio
  const renderToolResult = (result) => {
    if (!result) return null;

    // If result is a string, try to parse it as JSON first
    let parsedResult = result;
    if (typeof result === 'string') {
      // Check if it's a direct image data URL
      if (isDataUrlImage(result)) {
        return (
          <div className="tool-result-image">
            <img src={result} alt="Tool result" style={{ maxWidth: '100%', maxHeight: '400px' }} />
          </div>
        );
      }

      // Try to parse as JSON (result might be stringified, possibly double-stringified)
      let trimmed = result.trim();
      // Handle double-stringified JSON (starts and ends with ")
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        let unwrapped = null;
        try {
          unwrapped = JSON.parse(trimmed);
        } catch {
          // Continue with original
        }
        if (unwrapped && typeof unwrapped === 'string') {
          trimmed = unwrapped.trim();
        }
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Not valid JSON
        }
        if (parsed === null) {
          return <pre className="tool-details-content">{result}</pre>;
        }
        parsedResult = parsed;
      } else {
        // Not JSON - check if it's a code block or plain text
        return renderOutput(trimmed);
      }
    }

    // If parsedResult is an object, check for special content types
    if (typeof parsedResult === 'object' && parsedResult !== null) {
      // Check for files array with dataUrl (from tools like run_python, speak, create_image)
      if (parsedResult.files && Array.isArray(parsedResult.files) && parsedResult.files.length > 0) {
        // Categorize files by type
        const imageFiles = parsedResult.files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:image/'));
        const audioFiles = parsedResult.files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:audio/'));
        const hasMediaFiles = imageFiles.length > 0 || audioFiles.length > 0;

        if (hasMediaFiles) {
          return (
            <div className="tool-result-with-media">
              {/* Render images */}
              {imageFiles.map((file, idx) => (
                <div key={`img-${idx}`} className="tool-result-image">
                  {imageFiles.length > 1 && <div className="tool-result-image-label">{file.name}:</div>}
                  <img src={file.dataUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
                </div>
              ))}
              {/* Render audio players */}
              {audioFiles.map((file, idx) => (
                <div key={`audio-${idx}`} className="tool-result-audio">
                  {audioFiles.length > 1 && <div className="tool-result-audio-label">{file.name}:</div>}
                  <AudioPlayer
                    audioDataUrl={file.dataUrl}
                    mimeType={file.mediaType}
                  />
                </div>
              ))}
              {/* Render output with syntax highlighting support */}
              {parsedResult.output && (
                <div className="tool-result-output" style={{ marginTop: '0.5rem' }}>
                  {renderOutput(parsedResult.output)}
                </div>
              )}
            </div>
          );
        }
      }

      // Check for audio result (any tool returning audio data)
      if (isAudioResult(parsedResult)) {
        const audioData = getAudioData(parsedResult);
        // Get non-audio properties to display alongside player (exclude audio, output with audio, mimeType)
        const nonAudioEntries = Object.entries(parsedResult).filter(
          ([key, value]) => {
            if (key === 'audio' || key === 'mimeType') return false;
            // If output contains audio, skip it (audio player handles it)
            if (key === 'output' && typeof value === 'object' && value && 'audio' in value) return false;
            return true;
          }
        );

        return (
          <div className="tool-result-with-audio">
            <AudioPlayer
              audioBase64={audioData.audio}
              mimeType={audioData.mimeType || 'audio/pcm;rate=24000'}
            />
            {nonAudioEntries.length > 0 && (
              <div className="tool-result-properties">
                {nonAudioEntries.map(([key, value]) => (
                  <div key={key} className="tool-result-property">
                    <span className="tool-result-key">{key}:</span>{' '}
                    <span className="tool-result-value">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // Check for image data URLs
      const imageEntries = Object.entries(parsedResult).filter(
        ([, value]) => isDataUrlImage(value)
      );
      const hasImageData = imageEntries.length > 0;

      if (hasImageData) {
        // Render with image preview - show images first, then other properties
        const nonImageEntries = Object.entries(parsedResult).filter(
          ([, value]) => !isDataUrlImage(value)
        );

        return (
          <div className="tool-result-with-image">
            {/* Render images first */}
            {imageEntries.map(([key, value]) => (
              <div key={key} className="tool-result-image">
                <div className="tool-result-image-label">{key}:</div>
                <img src={value} alt={key} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
              </div>
            ))}
            {/* Render other properties */}
            {nonImageEntries.map(([key, value]) => (
              <div key={key} className="tool-result-property">
                <span className="tool-result-key">{key}:</span>{' '}
                <span className="tool-result-value">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        );
      }

      // Check for output property (from tools like generate_python, run_python without files)
      if (parsedResult.output !== undefined) {
        return (
          <div className="tool-result-with-output">
            {renderOutput(parsedResult.output)}
            {/* Show error if present */}
            {parsedResult.error && (
              <div className="tool-result-error" style={{ marginTop: '0.5rem', color: '#ff6b6b' }}>
                <pre className="tool-details-content" style={{ margin: 0 }}>{parsedResult.error}</pre>
              </div>
            )}
          </div>
        );
      }
    }

    // Default: render as JSON
    return <pre className="tool-details-content">{JSON.stringify(parsedResult, null, 2)}</pre>;
  };

  // Format file size for display
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Toggle accordion - memoized since it only uses state setter
  const toggleAccordion = useCallback((key) => {
    setExpandedAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Format tool tooltip with description and inputs
  const formatToolTooltip = (tool) => {
    let tooltip = tool.description || tool.name;
    if (tool.inputs && tool.inputs.length > 0) {
      tooltip += '\n\nInputs:';
      for (const input of tool.inputs) {
        const req = input.required ? '(required)' : '(optional)';
        tooltip += `\n  • ${input.name}: ${input.type} ${req}`;
        if (input.description) {
          tooltip += `\n      ${input.description}`;
        }
      }
    }
    return tooltip;
  };

  // Toggle tool event expansion
  const toggleToolExpand = (toolId) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  };

  // Toggle agent message expansion (for messages that collapse by default)
  const toggleAgentMessageExpand = (msgId) => {
    setExpandedAgentMessages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  };

  // Format date for conversation list
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // Note: Eval mode handlers are now in useEvalMode hook (App.Eval.jsx)


  // Close browser preview
  const handleCloseBrowserPreview = useCallback(() => {
    setSelectedBrowserSessionId(null);
  }, []);

  // Close browser session (terminate the browser process) - memoized
  const handleCloseBrowserSession = useCallback((sessionId) => {
    // Optimistically remove from UI immediately
    setBrowserSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setBrowserScreenshots((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    // Use functional update to check selected session without dependency
    setSelectedBrowserSessionId((prev) => prev === sessionId ? null : prev);
    // Send close request to server
    sendMessage({ type: 'browser-action', action: 'close', sessionId });
  }, [sendMessage]);

  // Toggle computer use accordion - memoized
  const handleToggleComputerUse = useCallback(() => {
    toggleAccordion('computerUse');
  }, [toggleAccordion]);

  // Select session for preview - routes to browser or desktop based on kind
  const handleSelectSession = useCallback((sessionId, kind) => {
    if (kind === 'desktop') {
      setSelectedDesktopSessionId(sessionId);
    } else {
      setSelectedBrowserSessionId(sessionId);
    }
  }, []);

  // Close desktop preview
  const handleCloseDesktopPreview = useCallback(() => {
    setSelectedDesktopSessionId(null);
  }, []);

  // Close desktop session (terminate the sandbox) - memoized
  const handleCloseDesktopSession = useCallback((sessionId) => {
    // Optimistically remove from UI immediately
    setDesktopSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setDesktopScreenshots((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    // Use functional update to check selected session without dependency
    setSelectedDesktopSessionId((prev) => prev === sessionId ? null : prev);
    // Unlock chat input — the user explicitly chose to stop, don't make them
    // wait for the LLM to comment on the abort. Any in-flight LLM response
    // will still arrive and update messages in the background.
    setIsResponsePending(false);
    // Mark any streaming message as done so it doesn't show the spinner
    setMessages((prev) =>
      prev.map((m) => {
        if (m.isStreaming) return { ...m, isStreaming: false };
        // Also mark any running desktop_session tool calls as cancelled
        // so the tool indicator stops spinning (tool_execution_finished
        // may never arrive if the abort kills the pipeline).
        if (m.role === 'tool' && m.toolName === 'desktop_session' && m.status === 'running') {
          return { ...m, status: 'failed', error: 'Session closed by user' };
        }
        return m;
      })
    );
    // Send close request to server
    sendMessage({ type: 'desktop-action', action: 'close', sessionId });
  }, [sendMessage]);

  // Toggle RAG projects accordion - memoized
  const handleToggleRagProjects = useCallback(() => {
    toggleAccordion('ragProjects');
  }, [toggleAccordion]);

  // Handle RAG project indexing (force=true for full re-index) - memoized
  const handleIndexProject = useCallback(async (projectId, force = false) => {
    let url = '/api/rag/projects/' + projectId + '/index';
    if (force) {
      url = url + '?force=true';
    }
    let res = null;
    try {
      res = await fetch(url, { method: 'POST' });
    } catch (error) {
      console.error('Failed to start indexing:', error);
      return;
    }
    if (!res.ok) {
      res.json().then(data => console.error('Failed to start indexing:', data.error));
    }
  }, []);

  // Handle file upload to RAG project via drag-and-drop - memoized
  const handleUploadToProject = useCallback(async (projectId, files) => {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    let res = null;
    try {
      res = await fetch(`/api/rag/projects/${projectId}/upload?index=true`, {
        method: 'POST',
        body: formData,
      });
    } catch (error) {
      console.error('Failed to upload files:', error);
      return;
    }
    if (!res.ok) {
      res.json().then(data => console.error('Failed to upload files:', data.error));
    } else {
      res.json().then(data => console.log('Upload successful:', data));
    }
  }, []);

  // Get selected browser session object
  const selectedBrowserSession = browserSessions.find(
    (s) => s.id === selectedBrowserSessionId
  );

  // Get selected desktop session object
  const selectedDesktopSession = desktopSessions.find(
    (s) => s.id === selectedDesktopSessionId
  );

  // Render a single message item for Virtuoso (index-based for totalCount mode)
  // Render a single message item for Virtuoso
  const renderMessageItem = useCallback((index, msg) => {
    if (msg.role === 'tool') {
      // Expandable tool invocation display
      return (
        <div className={`tool-event-wrapper ${expandedTools.has(msg.id) ? 'expanded' : ''}`}>
          <div
            className={`tool-event ${msg.status}`}
            onClick={() => toggleToolExpand(msg.id)}
            style={{ cursor: 'pointer' }}
          >
            <span className="tool-icon">
              {msg.source === 'mcp' ? '🔌' : msg.source === 'skill' ? '⚡' : '🔧'}
            </span>
            <span className="tool-status-indicator">
              {msg.status === 'running' ? '◐' : msg.status === 'completed' ? '✓' : '✗'}
            </span>
            <span className="tool-name">{msg.toolName}</span>
            {msg.parameters?.task && (
              <span className="tool-mission">{msg.parameters.task}</span>
            )}
            {msg.status === 'running' && msg.progress && (
              <span className="tool-progress">
                <span className="tool-progress-bar">
                  <span
                    className="tool-progress-fill"
                    style={{ width: msg.progress.total ? `${Math.min(100, (msg.progress.current / msg.progress.total) * 100)}%` : '0%' }}
                  />
                </span>
                {msg.progress.message && (
                  <span className="tool-progress-message">{msg.progress.message}</span>
                )}
              </span>
            )}
            {msg.durationMs !== undefined && (
              <span className="tool-duration">{msg.durationMs}ms</span>
            )}
            <span className="tool-expand-icon">
              {expandedTools.has(msg.id) ? '▼' : '▶'}
            </span>
          </div>
          {expandedTools.has(msg.id) && (
            <div className="tool-details">
              {(msg.agentName || msg.agentEmoji) && (
                <div className="tool-details-section">
                  <div className="tool-details-label">Called By</div>
                  <div className="tool-details-agent">
                    {msg.agentEmoji && <span className="tool-agent-emoji">{msg.agentEmoji}</span>}
                    {msg.agentName && <span className="tool-agent-name">{msg.agentName}</span>}
                  </div>
                </div>
              )}
              {msg.parameters && Object.keys(msg.parameters).length > 0 && (
                <div className="tool-details-section">
                  <div className="tool-details-label">Parameters</div>
                  <pre className="tool-details-content">
                    {JSON.stringify(msg.parameters, null, 2)}
                  </pre>
                </div>
              )}
              {msg.result && (
                <div className="tool-details-section">
                  <div className="tool-details-label">Response</div>
                  {renderToolResult(msg.result)}
                </div>
              )}
              {msg.error && (
                <div className="tool-details-section error">
                  <div className="tool-details-label">Error</div>
                  <pre className="tool-details-content">{msg.error}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (msg.role === 'delegation') {
      // Compact delegation display
      const mission = msg.mission || '';
      const truncatedMission = mission.length > DELEGATION_MISSION_MAX_LENGTH
        ? mission.slice(0, DELEGATION_MISSION_MAX_LENGTH) + '...'
        : mission;
      return (
        <div className="delegation-event">
          <span className="delegation-icon">🎯</span>
          <span className="delegation-agent">
            {msg.agentEmoji} {msg.agentName}
          </span>
          <span className="delegation-mission" title={mission}>
            {truncatedMission}
          </span>
        </div>
      );
    }

    if (msg.role === 'task_run') {
      // Compact task run display
      return (
        <div className="task-run-event">
          <span className="task-run-icon">📋</span>
          <span className="task-run-label">Running Task</span>
          <span className="task-run-name">{msg.taskName}</span>
          {msg.taskDescription && (
            <span className="task-run-description">{msg.taskDescription}</span>
          )}
        </div>
      );
    }

    if (shouldCollapseByDefault(msg.agentType, msg.agentName, agentTemplates)) {
      // Collapsible agent message (uses collapseResponseByDefault from backend)
      return (
        <div className={`collapsible-agent-message ${expandedAgentMessages.has(msg.id) ? 'expanded' : 'collapsed'}`}>
          <div
            className="collapsible-agent-header"
            onClick={() => toggleAgentMessageExpand(msg.id)}
          >
            <span className="collapsible-agent-icon">{msg.agentEmoji || '📚'}</span>
            <span className="collapsible-agent-name">{msg.agentName || 'Agent'}</span>
            <span className="collapsible-agent-preview">
              {msg.content ? (msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')) : 'Processing...'}
            </span>
            <span className="collapsible-agent-expand-icon">
              {expandedAgentMessages.has(msg.id) ? '▼' : '▶'}
            </span>
          </div>
          {expandedAgentMessages.has(msg.id) && (
            <div className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
              <div className="message-avatar">
                {msg.isError ? '⚠️' : (msg.agentEmoji || DEFAULT_AGENT_ICON)}
              </div>
              <div className="message-content">
                <MessageContent content={msg.content} html={msg.html} isStreaming={msg.isStreaming} citations={msg.citations} messageId={msg.id} />
                {msg.role === 'assistant' && msg.citations && !msg.isStreaming && (
                  <CitationPanel citations={msg.citations} messageId={msg.id} />
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Default message display
    return (
      <div className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
        <div className="message-avatar">
          {msg.isError ? '⚠️' : msg.role === 'user' ? '👤' : (msg.agentEmoji || DEFAULT_AGENT_ICON)}
        </div>
        <div className="message-content">
          {msg.agentName && msg.role === 'assistant' && (
            <div className="agent-name">{msg.agentName}</div>
          )}
          <MessageContent content={msg.content} html={msg.html} isStreaming={msg.isStreaming} citations={msg.citations} messageId={msg.id} />
          {msg.role === 'assistant' && msg.citations && !msg.isStreaming && (
            <CitationPanel citations={msg.citations} messageId={msg.id} />
          )}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="message-attachments">
              {msg.attachments.map((att, attIndex) => (
                <div key={attIndex} className="message-attachment-chip">
                  <span className="attachment-icon">
                    {att.type?.startsWith('image/') ? '🖼️' : '📎'}
                  </span>
                  <span className="attachment-name" title={att.name}>
                    {att.name?.length > 25 ? att.name.slice(0, 22) + '...' : att.name}
                  </span>
                  <span className="attachment-size">
                    {formatFileSize(att.size)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {msg.agentCommand && (
            <div className="message-reasoning-chip message-command-chip">
              <span className="reasoning-chip-icon">{msg.agentCommand.icon}</span>
              <span className="reasoning-chip-label">{msg.agentCommand.command}</span>
            </div>
          )}
          {msg.messageType && !msg.agentCommand && (
            <div className="message-reasoning-chip message-type-chip">
              <span className="reasoning-chip-icon">🔬</span>
              <span className="reasoning-chip-label">
                {msg.messageType === 'deep_research' ? 'Deep Research' : msg.messageType}
              </span>
            </div>
          )}
          {msg.reasoningMode && (
            <div className="message-reasoning-chip">
              <span className="reasoning-chip-icon">🧠</span>
              <span className="reasoning-chip-label">
                {msg.reasoningMode === 'xhigh' ? 'Think+' : 'Think'}
              </span>
            </div>
          )}
          {msg.isStreaming && !msg.content && (
            <span className="typing-indicator">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </span>
          )}
          {msg.isStreaming && msg.content && (
            <span className="streaming-cursor"></span>
          )}
          {msg.buttons && (
            <div className="message-buttons">
              {msg.buttons.map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => handleAction(btn.action, btn.data)}
                  className="action-button"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }, [expandedTools, expandedAgentMessages, handleAction, formatFileSize, renderToolResult, toggleToolExpand, toggleAgentMessageExpand, agentTemplates]);

  // Virtuoso header component for loading indicator
  const VirtuosoHeader = useCallback(() => {
    if (isLoadingOlder) {
      return (
        <div className="virtuoso-loading-header">
          <span className="loading-spinner"></span>
          Loading older messages...
        </div>
      );
    }
    return null;
  }, [isLoadingOlder]);

  return (
    <div className="app-layout">
      {/* Collapsible Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <div className="sidebar-header">
          <button
            className="new-conversation-btn"
            onClick={handleNewConversation}
            title="New Chat"
          >
            <span className="btn-icon">+</span>
            {sidebarOpen && <span>New Chat</span>}
          </button>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {sidebarOpen && mode === MODES.EVAL && (
          <EvalSidebarContent evalMode={evalMode} />
        )}

        {sidebarOpen && mode === MODES.CHAT && (
          <>
          <div className="conversation-list">
            <div className="conversation-list-header">History</div>

            {/* Skeleton loading state */}
            {conversationsLoading && showSkeleton && (
              <>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="conversation-item skeleton">
                    <div className="conversation-info">
                      <div className="skeleton-title" />
                      <div className="skeleton-date" />
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Loaded conversations */}
            {!conversationsLoading && conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''} ${conv.isWellKnown ? 'well-known' : ''} ${editingConversationId === conv.id ? 'editing' : ''}`}
                onClick={() => editingConversationId !== conv.id && handleSelectConversation(conv.id)}
              >
                <div className="conversation-info">
                  {editingConversationId === conv.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="conversation-rename-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={handleSaveRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="conversation-title">
                        {conv.icon && <span className="conversation-icon">{conv.icon}</span>}
                        {conv.title}
                      </div>
                      <div className="conversation-date">{formatDate(conv.updatedAt)}</div>
                    </>
                  )}
                </div>
                {/* Actions menu - different options for well-known vs regular conversations */}
                <div className="conversation-actions">
                  <button
                    className="actions-menu-btn"
                    onClick={(e) => toggleActionsMenu(conv.id, e)}
                    title="Actions"
                  >
                    ⋯
                  </button>
                  {openMenuId === conv.id && (
                    <div className="actions-menu">
                      {conv.isWellKnown ? (
                        /* Well-known conversations (like Feed) only have Clear option */
                        <button
                          className="actions-menu-item delete"
                          onClick={(e) => handleClearConversation(conv.id, e)}
                        >
                          Clear
                        </button>
                      ) : (
                        /* Regular conversations have Rename and Delete */
                        <>
                          <button
                            className="actions-menu-item"
                            onClick={(e) => handleRenameConversation(conv.id, e)}
                          >
                            Rename
                          </button>
                          <button
                            className="actions-menu-item delete"
                            onClick={(e) => handleDeleteConversation(conv.id, e)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {!conversationsLoading && conversations.length === 0 && (
              <div className="no-conversations">No conversations yet</div>
            )}
          </div>

          {/* Accordions Section */}
          <div className="sidebar-accordions">
            {/* Agent Tasks Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.tasks ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('tasks')}
              >
                <span className="accordion-icon">📋</span>
                <span className="accordion-title">Agent Tasks</span>
                <span className="accordion-arrow">{expandedAccordions.tasks ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.tasks && (
                <div className="accordion-content">
                  {agentTasks.length === 0 ? (
                    <div className="accordion-empty">No active tasks</div>
                  ) : (
                    agentTasks.map((task) => {
                      // Build tooltip content
                      const tooltipLines = [];
                      if (task.description) {
                        tooltipLines.push(task.description);
                      }
                      if (task.schedule) {
                        tooltipLines.push(`Schedule: ${task.schedule}`);
                      }
                      if (task.lastRun) {
                        tooltipLines.push(`Last run: ${new Date(task.lastRun).toLocaleString()}`);
                      }
                      const tooltip = tooltipLines.join('\n') || task.name;

                      // Format next run time
                      const formatNextRun = (nextRun) => {
                        if (!nextRun) return null;
                        const date = new Date(nextRun);
                        const now = new Date();
                        const diffMs = date - now;

                        // If in the past, show "Overdue"
                        if (diffMs < 0) return 'Overdue';

                        // If within 24 hours, show relative time
                        const diffHours = diffMs / (1000 * 60 * 60);
                        if (diffHours < 1) {
                          const diffMins = Math.round(diffMs / (1000 * 60));
                          return `in ${diffMins}m`;
                        }
                        if (diffHours < 24) {
                          return `in ${Math.round(diffHours)}h`;
                        }

                        // Otherwise show date
                        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                      };

                      const nextRunDisplay = formatNextRun(task.nextRun);

                      return (
                        <div key={task.id} className="accordion-item task-item" title={tooltip}>
                          <span className={`task-status ${task.status}`}>●</span>
                          <span className="task-name">{task.name}</span>
                          {nextRunDisplay && (
                            <span className="task-next-run">{nextRunDisplay}</span>
                          )}
                          <button
                            className="task-run-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRunTask(task.id);
                            }}
                            title="Run now"
                          >
                            ▶
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* RAG Projects Accordion */}
            <RAGProjects
              projects={ragProjects}
              indexingProgress={ragIndexingProgress}
              expanded={expandedAccordions.ragProjects}
              onToggle={handleToggleRagProjects}
              onIndex={handleIndexProject}
              onUpload={handleUploadToProject}
            />

            {/* Agent Skills Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.skills ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('skills')}
              >
                <span className="accordion-icon">⚡</span>
                <span className="accordion-title">Agent Skills</span>
                <span className="accordion-arrow">{expandedAccordions.skills ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.skills && (
                <div className="accordion-content">
                  {skills.length === 0 ? (
                    <div className="accordion-empty">No skills loaded</div>
                  ) : (
                    skills.map((skill) => (
                      <div key={skill.id} className="accordion-item" title={skill.description}>
                        <span className="skill-icon">🔧</span>
                        <span className="skill-name">{skill.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Tools Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.tools ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('tools')}
              >
                <span className="accordion-icon">🔧</span>
                <span className="accordion-title">Tools</span>
                <span className="accordion-arrow">{expandedAccordions.tools ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.tools && (
                <div className="accordion-content tools-tree">
                  {tools.builtin.length === 0 && tools.user.length === 0 && Object.keys(tools.mcp).length === 0 ? (
                    <div className="accordion-empty">No tools available</div>
                  ) : (
                    <>
                      {/* Builtin Tools */}
                      {tools.builtin.length > 0 && (
                        <div className="tool-group">
                          <button
                            className={`tool-group-header ${expandedToolGroups.builtin ? 'expanded' : ''}`}
                            onClick={() => setExpandedToolGroups(prev => ({ ...prev, builtin: !prev.builtin }))}
                          >
                            <span className="tool-group-arrow">{expandedToolGroups.builtin ? '▼' : '▶'}</span>
                            <span className="tool-group-icon">⚙️</span>
                            <span className="tool-group-name">Builtin</span>
                            <span className="tool-group-count">{tools.builtin.length}</span>
                          </button>
                          {expandedToolGroups.builtin && (
                            <div className="tool-group-items">
                              {tools.builtin.map((tool) => (
                                <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                  <span className="tool-name">{tool.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* User Defined Tools */}
                      {tools.user.length > 0 && (
                        <div className="tool-group">
                          <button
                            className={`tool-group-header ${expandedToolGroups.user ? 'expanded' : ''}`}
                            onClick={() => setExpandedToolGroups(prev => ({ ...prev, user: !prev.user }))}
                          >
                            <span className="tool-group-arrow">{expandedToolGroups.user ? '▼' : '▶'}</span>
                            <span className="tool-group-icon">📝</span>
                            <span className="tool-group-name">User Defined</span>
                            <span className="tool-group-count">{tools.user.length}</span>
                          </button>
                          {expandedToolGroups.user && (
                            <div className="tool-group-items">
                              {tools.user.map((tool) => (
                                <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                  <span className="tool-name">{tool.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* MCP Tools by Server */}
                      {Object.entries(tools.mcp).map(([serverName, serverTools]) => {
                        const groupKey = 'mcp_' + serverName;
                        const isExpanded = expandedToolGroups[groupKey];
                        return (
                          <div key={serverName} className="tool-group">
                            <button
                              className={`tool-group-header ${isExpanded ? 'expanded' : ''}`}
                              onClick={() => setExpandedToolGroups(prev => {
                                const updated = { ...prev };
                                updated[groupKey] = !prev[groupKey];
                                return updated;
                              })}
                            >
                              <span className="tool-group-arrow">{isExpanded ? '▼' : '▶'}</span>
                              <span className="tool-group-icon">🔌</span>
                              <span className="tool-group-name">MCP: {serverName}</span>
                              <span className="tool-group-count">{serverTools.length}</span>
                            </button>
                            {isExpanded && (
                              <div className="tool-group-items">
                                {serverTools.map((tool) => (
                                  <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                    <span className="tool-name">{tool.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* MCPs Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.mcps ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('mcps')}
              >
                <span className="accordion-icon">🔌</span>
                <span className="accordion-title">MCPs</span>
                <span className="accordion-arrow">{expandedAccordions.mcps ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.mcps && (
                <div className="accordion-content">
                  {mcps.length === 0 ? (
                    <div className="accordion-empty">No MCPs connected</div>
                  ) : (
                    mcps.map((mcp) => (
                      <div key={mcp.id} className="accordion-item mcp-item">
                        <label className="mcp-toggle" title={mcp.enabled ? 'Disable MCP' : 'Enable MCP'}>
                          <input
                            type="checkbox"
                            checked={mcp.enabled}
                            onChange={() => handleToggleMcp(mcp.id, mcp.enabled)}
                          />
                          <span className="mcp-toggle-slider"></span>
                        </label>
                        <span className={`mcp-status ${mcp.enabled ? 'connected' : 'disconnected'}`}>●</span>
                        <span className="mcp-name">{mcp.name}</span>
                        {mcp.toolCount > 0 && (
                          <span className="mcp-tool-count" title={`${mcp.toolCount} tools`}>
                            {mcp.toolCount}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Computer Use Sessions Accordion - browser + desktop */}
            <ComputerUseSessions
              browserSessions={browserSessions}
              desktopSessions={desktopSessions}
              browserScreenshots={browserScreenshots}
              desktopScreenshots={desktopScreenshots}
              selectedSessionId={selectedBrowserSessionId || selectedDesktopSessionId}
              onSelectSession={handleSelectSession}
              onCloseBrowserSession={handleCloseBrowserSession}
              onCloseDesktopSession={handleCloseDesktopSession}
              expanded={expandedAccordions.computerUse}
              onToggle={handleToggleComputerUse}
            />
          </div>
          </>
        )}
      </aside>

      {/* Main Chat Area */}
      <div className="main-content">
        <header className="header">
          <div className="header-left">
            {!sidebarOpen && (
              <button
                className="mobile-menu-btn"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
              >
                ☰
              </button>
            )}
            <div className="logo">
              <span className="logo-icon">{SUPERVISOR_ICON}</span>
              <h1>{SUPERVISOR_NAME}</h1>
            </div>
            {/* Mode Switcher */}
            <div className="mode-switcher">
              <button
                className={`mode-btn ${mode === MODES.CHAT ? 'active' : ''}`}
                onClick={() => navigate(currentConversationId ? `/chat/${encodeURIComponent(currentConversationId)}` : '/chat/feed')}
              >
                <span className="mode-icon">💬</span>
                Chat
              </button>
              <button
                className={`mode-btn ${mode === MODES.EVAL ? 'active' : ''}`}
                onClick={() => navigate('/eval')}
              >
                <span className="mode-icon">📊</span>
                Eval
              </button>
            </div>
          </div>
          <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </header>

        {/* Eval Mode Content */}
        {mode === MODES.EVAL && <EvalMainContent evalMode={evalMode} evalState={evalState} />}

        {/* Chat Mode Content */}
        {mode === MODES.CHAT && (
        <>
        <main className="chat-container">
          <div className="messages">
          {messages.length === 0 ? (
            <div className="welcome">
              <h2>Welcome to {SUPERVISOR_NAME}</h2>
              <p>Your personal support agent is ready to help.</p>
            </div>
          ) : (
            <Virtuoso
              key={currentConversationId}
              ref={virtuosoRef}
              data={messages}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={messages.length - 1}
              followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
              atBottomStateChange={handleAtBottomStateChange}
              atBottomThreshold={100}
              startReached={loadOlderMessages}
              increaseViewportBy={{ top: 200, bottom: 200 }}
              components={{
                Header: VirtuosoHeader,
              }}
              itemContent={renderMessageItem}
              className="virtuoso-scroller"
            />
          )}
          </div>

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <button className="scroll-to-bottom" onClick={scrollToBottom}>
              ↓ Scroll to bottom
            </button>
          )}

        {/* Browser Preview Modal */}
        {selectedBrowserSession && (
          <BrowserPreview
            session={selectedBrowserSession}
            screenshot={browserScreenshots[selectedBrowserSessionId]}
            clickMarkers={clickMarkers}
            onClose={handleCloseBrowserPreview}
            onCloseSession={handleCloseBrowserSession}
          />
        )}

        {/* Desktop Preview Modal */}
        {selectedDesktopSession && (
          <DesktopPreview
            session={selectedDesktopSession}
            screenshot={desktopScreenshots[selectedDesktopSessionId]}
            clickMarkers={desktopClickMarkers}
            onClose={handleCloseDesktopPreview}
            onCloseSession={handleCloseDesktopSession}
          />
        )}
        </main>

        <footer
          className={`input-container ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <ChatInput
            ref={chatInputRef}
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            isConnected={isConnected}
            isResponsePending={isResponsePending}
            reasoningMode={reasoningMode}
            messageType={messageType}
            onReasoningModeChange={setReasoningMode}
            onMessageTypeChange={setMessageType}
            modelCapabilities={modelCapabilities}
            commandTriggers={commandTriggers}
            agentCommand={agentCommand}
            onAgentCommandChange={setAgentCommand}
          />
        </footer>
        </>
        )}
      </div>

      {/* PDF Viewer Modal */}
      <PDFViewerModal
        isOpen={pdfViewerState.isOpen}
        onClose={closePdfViewer}
        fileUrl={pdfViewerState.fileUrl}
        filename={pdfViewerState.filename}
        initialPage={pdfViewerState.initialPage}
      />
    </div>
  );
}

export default App;
