import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useWebSocket } from './hooks/useWebSocket.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatArea } from './components/ChatArea.js';
import { InputArea } from './components/InputArea.js';
import { Header } from './components/Header.js';
import { SlashMenu } from './components/SlashMenu.js';
import type { Message, Conversation, ScheduledTask, ToolsData, McpServer, Skill, WsMessage } from './types.js';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3000';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 120;
  const terminalHeight = stdout?.rows || 40;

  // App state
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [tools, setTools] = useState<ToolsData>({ builtin: [], user: [], mcp: {} });
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(30);
  const [inputValue, setInputValue] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [focusArea, setFocusArea] = useState<'sidebar' | 'chat' | 'input'>('input');
  const [isResponsePending, setIsResponsePending] = useState(false);

  // Sidebar accordion state
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({
    conversations: true,
    tasks: false,
    tools: false,
    mcps: false,
    skills: false,
  });

  // Handle WebSocket messages
  const handleWsMessage = useCallback((data: WsMessage) => {
    if (data.type === 'message') {
      const msg = data as WsMessage & { id?: string; content: string; conversationId?: string; agentName?: string; agentEmoji?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => {
        const messageId = msg.id || `msg-${Date.now()}`;
        if (prev.some(m => m.id === messageId)) return prev;
        return [...prev, {
          id: messageId,
          role: 'assistant',
          content: msg.content,
          timestamp: new Date().toISOString(),
          agentName: msg.agentName,
          agentEmoji: msg.agentEmoji,
        }];
      });
      setIsResponsePending(false);
    } else if (data.type === 'stream_start') {
      const msg = data as WsMessage & { id: string; conversationId?: string; agentName?: string; agentEmoji?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => [...prev, {
        id: msg.id,
        role: 'assistant',
        content: '',
        isStreaming: true,
        agentName: msg.agentName,
        agentEmoji: msg.agentEmoji,
      }]);
    } else if (data.type === 'stream_chunk') {
      const msg = data as WsMessage & { streamId: string; chunk: string; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => prev.map(m =>
        m.id === msg.streamId ? { ...m, content: m.content + msg.chunk } : m
      ));
    } else if (data.type === 'stream_end') {
      const msg = data as WsMessage & { streamId: string; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => prev.map(m =>
        m.id === msg.streamId ? { ...m, isStreaming: false } : m
      ));
      setIsResponsePending(false);
    } else if (data.type === 'error') {
      const msg = data as WsMessage & { error: string; details?: string; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${msg.error}${msg.details ? `\n${msg.details}` : ''}`,
        isError: true,
      }]);
      setIsResponsePending(false);
    } else if (data.type === 'tool_requested') {
      const msg = data as WsMessage & { requestId: string; toolName: string; source: string; parameters: Record<string, unknown>; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => {
        const toolId = `tool-${msg.requestId}`;
        if (prev.some(m => m.id === toolId)) return prev;
        return [...prev, {
          id: toolId,
          role: 'tool',
          content: '',
          toolName: msg.toolName,
          source: msg.source as 'native' | 'mcp' | 'skill',
          parameters: msg.parameters,
          status: 'running',
        }];
      });
    } else if (data.type === 'tool_execution_finished') {
      const msg = data as WsMessage & { requestId: string; success: boolean; durationMs: number; error?: string; result?: unknown; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => prev.map(m =>
        m.id === `tool-${msg.requestId}` ? {
          ...m,
          status: msg.success ? 'completed' : 'failed',
          durationMs: msg.durationMs,
          error: msg.error,
          result: msg.result,
        } : m
      ));
    } else if (data.type === 'delegation') {
      const msg = data as WsMessage & { agentId: string; agentName: string; agentEmoji: string; agentType: string; mission: string; conversationId?: string };
      if (msg.conversationId && msg.conversationId !== currentConversationId) return;

      setMessages(prev => {
        const delegationId = `delegation-${msg.agentId}`;
        if (prev.some(m => m.id === delegationId)) return prev;
        return [...prev, {
          id: delegationId,
          role: 'delegation',
          content: '',
          agentName: msg.agentName,
          agentEmoji: msg.agentEmoji,
          agentType: msg.agentType,
          mission: msg.mission,
        }];
      });
    } else if (data.type === 'conversation_created') {
      const msg = data as WsMessage & { conversation: Conversation };
      setConversations(prev => {
        if (prev.some(c => c.id === msg.conversation.id)) return prev;
        const wellKnownCount = prev.filter(c => c.isWellKnown).length;
        return [...prev.slice(0, wellKnownCount), msg.conversation, ...prev.slice(wellKnownCount)];
      });
      setCurrentConversationId(msg.conversation.id);
    } else if (data.type === 'conversation_updated') {
      const msg = data as WsMessage & { conversation: { id: string; title?: string; updatedAt?: string } };
      setConversations(prev => prev.map(c =>
        c.id === msg.conversation.id ? { ...c, ...msg.conversation } : c
      ));
    }
  }, [currentConversationId]);

  // Load all data from API (called on initial mount and websocket reconnect)
  const loadData = useCallback(async () => {
    try {
      // Load conversations
      const convRes = await fetch(`${API_URL}/api/conversations`);
      if (convRes.ok) {
        const convData = await convRes.json() as Array<Record<string, unknown>>;
        setConversations(convData.map((c) => ({
          id: c.id as string,
          title: c.title as string,
          updatedAt: (c.updatedAt || c.updated_at) as string | undefined,
          isWellKnown: (c.isWellKnown || false) as boolean,
          icon: c.icon as string | undefined,
        })));
        // Default to Feed conversation if none selected
        setCurrentConversationId(prev => {
          if (prev) return prev; // Keep current selection on reconnect
          const feed = convData.find((c) => c.id === 'feed');
          return feed ? feed.id as string : null;
        });
      }

      // Load tasks
      const tasksRes = await fetch(`${API_URL}/api/tasks`);
      if (tasksRes.ok) setTasks(await tasksRes.json() as ScheduledTask[]);

      // Load tools
      const toolsRes = await fetch(`${API_URL}/api/tools`);
      if (toolsRes.ok) setTools(await toolsRes.json() as ToolsData);

      // Load MCPs
      const mcpsRes = await fetch(`${API_URL}/api/mcps`);
      if (mcpsRes.ok) setMcpServers(await mcpsRes.json() as McpServer[]);

      // Load skills
      const skillsRes = await fetch(`${API_URL}/api/skills`);
      if (skillsRes.ok) setSkills(await skillsRes.json() as Skill[]);
    } catch {
      // API might not be available yet
    }
  }, []);

  const { isConnected, sendMessage } = useWebSocket({
    url: WS_URL,
    onMessage: handleWsMessage,
    onOpen: loadData, // Reload data on every connect/reconnect
  });

  // Load initial data on mount
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load messages when conversation changes
  useEffect(() => {
    // Clear messages immediately when conversation changes
    setMessages([]);

    if (!currentConversationId) {
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      try {
        const url = `${API_URL}/api/conversations/${currentConversationId}/messages?limit=100`;
        const res = await fetch(url);
        if (res.ok && !cancelled) {
          const data = await res.json() as { items: Array<Record<string, unknown>>; pagination: unknown };
          const messages = data.items || [];
          setMessages(messages.map((msg) => ({
            id: msg.id as string,
            role: (msg.messageType === 'tool_event' ? 'tool' :
                  msg.messageType === 'delegation' ? 'delegation' :
                  msg.messageType === 'task_run' ? 'task_run' : msg.role) as Message['role'],
            content: (msg.content || '') as string,
            timestamp: msg.createdAt as string | undefined,
            agentName: msg.agentName as string | undefined,
            agentEmoji: msg.agentEmoji as string | undefined,
            toolName: msg.toolName as string | undefined,
            status: (msg.toolSuccess === true ? 'completed' : msg.toolSuccess === false ? 'failed' : undefined) as Message['status'],
            mission: msg.delegationMission as string | undefined,
            taskName: msg.taskName as string | undefined,
          })));
        }
      } catch {
        // Keep messages empty on error
      }
    };
    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [currentConversationId]);

  // Global key handling
  useInput((input, key) => {
    // Ctrl+C to exit
    if (input === 'c' && key.ctrl) {
      exit();
      return;
    }

    // Tab to cycle focus areas
    if (key.tab) {
      setFocusArea(prev => {
        if (prev === 'input') return sidebarOpen ? 'sidebar' : 'chat';
        if (prev === 'sidebar') return 'chat';
        return 'input';
      });
      return;
    }

    // Ctrl+B to toggle sidebar
    if (input === 'b' && key.ctrl) {
      setSidebarOpen(prev => !prev);
      return;
    }

    // Escape to close slash menu or unfocus
    if (key.escape) {
      if (showSlashMenu) {
        setShowSlashMenu(false);
      }
      return;
    }
  });

  // Handle sending message
  const handleSendMessage = useCallback(() => {
    if (!inputValue.trim() || isResponsePending || !isConnected) return;

    // Add user message to UI
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString(),
    }]);

    // Send via WebSocket
    sendMessage({
      type: 'message',
      content: inputValue,
      conversationId: currentConversationId,
    });

    setInputValue('');
    setIsResponsePending(true);
  }, [inputValue, currentConversationId, sendMessage, isResponsePending, isConnected]);

  // Handle slash command selection
  const handleSlashCommand = useCallback((command: string) => {
    setShowSlashMenu(false);

    if (command === 'new') {
      sendMessage({ type: 'new-conversation' });
      setMessages([]);
      setCurrentConversationId(null);
    } else if (command === 'switch') {
      setFocusArea('sidebar');
      setExpandedAccordions(prev => ({ ...prev, conversations: true }));
    } else if (command === 'tasks') {
      setExpandedAccordions(prev => ({ ...prev, tasks: !prev.tasks }));
    } else if (command === 'tools') {
      setExpandedAccordions(prev => ({ ...prev, tools: !prev.tools }));
    } else if (command === 'mcp') {
      setExpandedAccordions(prev => ({ ...prev, mcps: !prev.mcps }));
    }
  }, [sendMessage]);

  // Handle conversation selection
  const handleSelectConversation = useCallback((convId: string) => {
    setCurrentConversationId(convId);
    setFocusArea('input');
  }, []);

  // Handle running a task manually
  const handleRunTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/tasks/${encodeURIComponent(taskId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversationId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Failed to run task: ${errorData.error || res.statusText}`,
          isError: true,
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Failed to run task: ${err instanceof Error ? err.message : 'Network error'}`,
        isError: true,
      }]);
    }
  }, [currentConversationId]);

  // Handle new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      if (res.ok) {
        const newConv = await res.json() as Conversation;
        // Clear messages first before changing conversation
        setMessages([]);
        setConversations(prev => {
          const wellKnownCount = prev.filter(c => c.isWellKnown).length;
          return [...prev.slice(0, wellKnownCount), newConv, ...prev.slice(wellKnownCount)];
        });
        setCurrentConversationId(newConv.id);
        setFocusArea('input');
      }
    } catch {
      // Handle error
    }
  }, []);

  // Calculate layout dimensions
  const sidebarActualWidth = sidebarOpen ? sidebarWidth : 0;
  const chatWidth = terminalWidth - sidebarActualWidth - 2;
  const contentHeight = terminalHeight - 4; // Account for header and input

  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight}>
      {/* Header */}
      <Header
        isConnected={isConnected}
        currentConversation={conversations.find(c => c.id === currentConversationId)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        focusArea={focusArea}
      />

      {/* Main content area */}
      <Box flexDirection="row" height={contentHeight}>
        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar
            width={sidebarWidth}
            height={contentHeight - 3}
            conversations={conversations}
            currentConversationId={currentConversationId}
            tasks={tasks}
            tools={tools}
            mcpServers={mcpServers}
            skills={skills}
            expandedAccordions={expandedAccordions}
            onToggleAccordion={(key) => setExpandedAccordions(prev => ({ ...prev, [key]: !prev[key] }))}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onRunTask={handleRunTask}
            isFocused={focusArea === 'sidebar'}
          />
        )}

        {/* Chat area */}
        <Box flexDirection="column" width={chatWidth} height={contentHeight}>
          <ChatArea
            messages={messages}
            width={chatWidth}
            height={contentHeight - 3}
            isFocused={focusArea === 'chat'}
          />

          {/* Input area */}
          <InputArea
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSendMessage}
            onSlash={() => setShowSlashMenu(true)}
            isDisabled={isResponsePending}
            isFocused={focusArea === 'input'}
            placeholder={
              !isConnected ? 'Disconnected - waiting for server...' :
              isResponsePending ? 'Waiting for response...' :
              'Type a message... (/ for commands)'
            }
          />
        </Box>
      </Box>

      {/* Slash command menu overlay */}
      {showSlashMenu && (
        <SlashMenu
          onSelect={handleSlashCommand}
          onClose={() => setShowSlashMenu(false)}
        />
      )}
    </Box>
  );
}
