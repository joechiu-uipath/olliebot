/**
 * WebSocket message handlers for App.jsx
 *
 * This module contains the handleMessage function that processes
 * incoming WebSocket messages and updates React state accordingly.
 */

import { playAudioData } from './utils/audio';

/**
 * Creates a message handler function with access to all required state setters and getters.
 *
 * @param {Object} deps - Dependencies object containing state setters and getter functions
 * @returns {Function} The handleMessage function
 */
export function createMessageHandler(deps) {
  const {
    // Getter/setter functions (to avoid passing refs directly, which React Compiler dislikes)
    getCurrentConversationId,
    setCurrentConversationIdRef, // For updating the ref immediately (race condition prevention)
    getNavigate,
    // State setters
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
    // Eval state setters
    getEvalJobId,
    setEvalProgress,
    setEvalResults,
    setEvalError,
    setEvalLoading,
  } = deps;

  /**
   * Helper to check if message belongs to current conversation
   */
  const isForCurrentConversation = (msgConversationId) => {
    const currentId = getCurrentConversationId();
    // If no conversationId specified in the message, only show in Feed
    // (prevents background task events from appearing in user conversations)
    if (!msgConversationId) {
      return currentId === 'feed';
    }
    // If no current conversation selected, only show Feed messages
    if (!currentId) {
      return msgConversationId === 'feed';
    }
    // Otherwise, check if it matches
    return msgConversationId === currentId;
  };

  /**
   * Main message handler - processes WebSocket messages by type
   */
  return function handleMessage(data) {
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
      case 'error':
        handleError(data);
        break;
      case 'connected':
        setIsConnected(true);
        break;
      case 'tool_requested':
        handleToolRequested(data);
        break;
      case 'play_audio':
        handlePlayAudio(data);
        break;
      case 'tool_execution_finished':
        handleToolFinished(data);
        break;
      case 'delegation':
        handleDelegation(data);
        break;
      case 'task_run':
        handleTaskRun(data);
        break;
      case 'conversation_created':
        handleConversationCreated(data);
        break;
      case 'conversation_updated':
        handleConversationUpdated(data);
        break;
      case 'task_updated':
        handleTaskUpdated(data);
        break;
      case 'browser_session_created':
        handleBrowserSessionCreated(data);
        break;
      case 'browser_session_updated':
        handleBrowserSessionUpdated(data);
        break;
      case 'browser_session_closed':
        handleBrowserSessionClosed(data);
        break;
      case 'browser_screenshot':
        handleBrowserScreenshot(data);
        break;
      case 'browser_click_marker':
        handleBrowserClickMarker(data);
        break;
      case 'desktop_session_created':
        handleDesktopSessionCreated(data);
        break;
      case 'desktop_session_updated':
        handleDesktopSessionUpdated(data);
        break;
      case 'desktop_session_closed':
        handleDesktopSessionClosed(data);
        break;
      case 'desktop_screenshot':
        handleDesktopScreenshot(data);
        break;
      case 'desktop_click_marker':
        handleDesktopClickMarker(data);
        break;
      case 'rag_indexing_started':
        handleRagIndexingStarted(data);
        break;
      case 'rag_indexing_progress':
        handleRagIndexingProgress(data);
        break;
      case 'rag_indexing_completed':
        handleRagIndexingCompleted(data);
        break;
      case 'rag_indexing_error':
        handleRagIndexingError(data);
        break;
      case 'rag_projects_changed':
        handleRagProjectsChanged();
        break;
      case 'eval_progress':
        handleEvalProgress(data);
        break;
      case 'eval_complete':
        handleEvalComplete(data);
        break;
      case 'eval_error':
        handleEvalError(data);
        break;
      default:
        // Unknown message type - ignore
        break;
    }
  };

  // ============================================================================
  // Message Handlers
  // ============================================================================

  function handleRegularMessage(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

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
  }

  function handleStreamStart(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

    setMessages((prev) => {
      const lastUserMsg = [...prev].reverse().find(m => m.role === 'user');
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
  }

  function handleStreamChunk(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.streamId
          ? { ...m, content: m.content + data.chunk }
          : m
      )
    );
  }

  function handleStreamEnd(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.streamId
          ? { ...m, isStreaming: false, citations: data.citations }
          : m
      )
    );
    setIsResponsePending(false);
  }

  function handleError(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

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
    setIsResponsePending(false);
  }

  function handleToolRequested(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

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
  }

  function handlePlayAudio(data) {
    if (data.audio && typeof data.audio === 'string') {
      playAudioData(data.audio, data.mimeType || 'audio/pcm;rate=24000');
    }
  }

  function handleToolFinished(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === `tool-${data.requestId}`
          ? {
              ...m,
              status: data.success ? 'completed' : 'failed',
              durationMs: data.durationMs,
              error: data.error,
              parameters: data.parameters,
              result: data.result,
            }
          : m
      )
    );
  }

  function handleDelegation(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

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
  }

  function handleTaskRun(data) {
    if (!isForCurrentConversation(data.conversationId)) return;

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
  }

  function handleConversationCreated(data) {
    const conv = data.conversation;
    setConversations((prev) => {
      if (prev.some((c) => c.id === conv.id)) return prev;
      const newConv = {
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        isWellKnown: false,
      };
      const wellKnownCount = prev.filter((c) => c.isWellKnown).length;
      return [...prev.slice(0, wellKnownCount), newConv, ...prev.slice(wellKnownCount)];
    });
    // Update ref immediately to prevent race condition with incoming stream events
    setCurrentConversationIdRef(conv.id);
    setCurrentConversationId(conv.id);
    getNavigate()(`/chat/${encodeURIComponent(conv.id)}`, { replace: true });
  }

  function handleConversationUpdated(data) {
    const { id, title, updatedAt, manuallyNamed } = data.conversation;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.manuallyNamed && !manuallyNamed) return c;
        return {
          ...c,
          title: title || c.title,
          updatedAt: updatedAt || c.updatedAt,
          manuallyNamed: manuallyNamed || c.manuallyNamed,
        };
      })
    );
  }

  function handleTaskUpdated(data) {
    setAgentTasks((prev) =>
      prev.map((t) =>
        t.id === data.task.id ? { ...t, ...data.task } : t
      )
    );
  }

  // ============================================================================
  // Browser Session Handlers
  // ============================================================================

  function handleBrowserSessionCreated(data) {
    setBrowserSessions((prev) => {
      if (prev.some((s) => s.id === data.session.id)) return prev;
      return [...prev, data.session];
    });
    setExpandedAccordions((prev) => ({ ...prev, computerUse: true }));
  }

  function handleBrowserSessionUpdated(data) {
    setBrowserSessions((prev) =>
      prev.map((s) =>
        s.id === data.sessionId ? { ...s, ...data.updates } : s
      )
    );
  }

  function handleBrowserSessionClosed(data) {
    setBrowserSessions((prev) => prev.filter((s) => s.id !== data.sessionId));
    setBrowserScreenshots((prev) => {
      const next = { ...prev };
      delete next[data.sessionId];
      return next;
    });
    setSelectedBrowserSessionId((prev) => prev === data.sessionId ? null : prev);
    setClickMarkers((prev) => prev.filter((m) => m.sessionId !== data.sessionId));
  }

  function handleBrowserScreenshot(data) {
    setBrowserScreenshots((prev) => ({
      ...prev,
      [data.sessionId]: {
        screenshot: data.screenshot,
        url: data.url,
        timestamp: data.timestamp,
      },
    }));
  }

  function handleBrowserClickMarker(data) {
    const marker = {
      ...data.marker,
      id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: data.sessionId,
    };
    setClickMarkers((prev) => [...prev, marker]);
    setTimeout(() => {
      setClickMarkers((prev) => prev.filter((m) => m.id !== marker.id));
    }, 1500);
  }

  // ============================================================================
  // Desktop Session Handlers
  // ============================================================================

  function handleDesktopSessionCreated(data) {
    setDesktopSessions((prev) => {
      if (prev.some((s) => s.id === data.session.id)) return prev;
      return [...prev, data.session];
    });
    setExpandedAccordions((prev) => ({ ...prev, computerUse: true }));
  }

  function handleDesktopSessionUpdated(data) {
    setDesktopSessions((prev) =>
      prev.map((s) =>
        s.id === data.sessionId ? { ...s, ...data.updates } : s
      )
    );
  }

  function handleDesktopSessionClosed(data) {
    setDesktopSessions((prev) => prev.filter((s) => s.id !== data.sessionId));
    setDesktopScreenshots((prev) => {
      const next = { ...prev };
      delete next[data.sessionId];
      return next;
    });
    setSelectedDesktopSessionId((prev) => prev === data.sessionId ? null : prev);
    setDesktopClickMarkers((prev) => prev.filter((m) => m.sessionId !== data.sessionId));
    // If the session was closed while the create tool was still running,
    // unlock the chat input so the user isn't stuck waiting for the LLM
    // to finish commenting on the abort. The LLM response (if any) will
    // still arrive and update messages in the background.
    setIsResponsePending(false);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.isStreaming) return { ...m, isStreaming: false };
        // Mark any running desktop_session tool calls as cancelled
        if (m.role === 'tool' && m.toolName === 'desktop_session' && m.status === 'running') {
          return { ...m, status: 'failed', error: 'Session closed' };
        }
        return m;
      })
    );
  }

  function handleDesktopScreenshot(data) {
    setDesktopScreenshots((prev) => ({
      ...prev,
      [data.sessionId]: {
        screenshot: data.screenshot,
        timestamp: data.timestamp,
      },
    }));
  }

  function handleDesktopClickMarker(data) {
    const marker = {
      ...data.marker,
      id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: data.sessionId,
    };
    setDesktopClickMarkers((prev) => [...prev, marker]);
    setTimeout(() => {
      setDesktopClickMarkers((prev) => prev.filter((m) => m.id !== marker.id));
    }, 1500);
  }

  // ============================================================================
  // RAG Indexing Handlers
  // ============================================================================

  function handleRagIndexingStarted(data) {
    setRagIndexingProgress((prev) => ({
      ...prev,
      [data.projectId]: {
        status: 'started',
        totalDocuments: data.totalDocuments,
        processedDocuments: 0,
      },
    }));
    setRagProjects((prev) =>
      prev.map((p) =>
        p.id === data.projectId ? { ...p, isIndexing: true } : p
      )
    );
  }

  function handleRagIndexingProgress(data) {
    setRagIndexingProgress((prev) => ({
      ...prev,
      [data.projectId]: {
        status: 'processing',
        totalDocuments: data.totalDocuments,
        processedDocuments: data.processedDocuments,
        currentDocument: data.currentDocument,
      },
    }));
  }

  function handleRagIndexingCompleted(data) {
    setRagIndexingProgress((prev) => {
      const next = { ...prev };
      delete next[data.projectId];
      return next;
    });
    fetch('/api/rag/projects')
      .then((res) => res.ok ? res.json() : [])
      .then((projects) => setRagProjects(projects))
      .catch(() => {});
  }

  function handleRagIndexingError(data) {
    setRagIndexingProgress((prev) => ({
      ...prev,
      [data.projectId]: {
        status: 'error',
        error: data.error,
      },
    }));
    setTimeout(() => {
      setRagIndexingProgress((prev) => {
        const next = { ...prev };
        delete next[data.projectId];
        return next;
      });
    }, 5000);
    setRagProjects((prev) =>
      prev.map((p) =>
        p.id === data.projectId ? { ...p, isIndexing: false } : p
      )
    );
  }

  function handleRagProjectsChanged() {
    fetch('/api/rag/projects')
      .then((res) => res.ok ? res.json() : [])
      .then((projects) => setRagProjects(projects))
      .catch(() => {});
  }

  // ============================================================================
  // Eval Handlers
  // ============================================================================

  function handleEvalProgress(data) {
    // Only handle if we have eval setters and the job matches
    if (!setEvalProgress || !getEvalJobId) return;
    const currentJobId = getEvalJobId();
    if (currentJobId && data.jobId === currentJobId) {
      setEvalProgress({ current: data.current, total: data.total });
    }
  }

  function handleEvalComplete(data) {
    if (!setEvalResults || !getEvalJobId) return;
    const currentJobId = getEvalJobId();
    if (currentJobId && data.jobId === currentJobId) {
      setEvalResults(data.results);
      setEvalProgress?.(null);
      setEvalLoading?.(false);
    }
  }

  function handleEvalError(data) {
    if (!setEvalError || !getEvalJobId) return;
    const currentJobId = getEvalJobId();
    if (currentJobId && data.jobId === currentJobId) {
      setEvalError(data.error || 'Evaluation failed');
      setEvalProgress?.(null);
      setEvalLoading?.(false);
    }
  }
}
