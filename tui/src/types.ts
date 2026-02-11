// Message types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'delegation' | 'task_run';
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  isError?: boolean;
  agentName?: string;
  agentEmoji?: string;
  // Tool event fields
  toolName?: string;
  source?: 'native' | 'mcp' | 'skill';
  status?: 'running' | 'completed' | 'failed';
  durationMs?: number;
  parameters?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  progress?: { current: number; total?: number; message?: string };
  // Delegation fields
  agentType?: string;
  mission?: string;
  // Task run fields
  taskId?: string;
  taskName?: string;
  taskDescription?: string;
}

// Conversation types
export interface Conversation {
  id: string;
  title: string;
  updatedAt?: string;
  isWellKnown?: boolean;
  icon?: string;
}

// Task types
export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  schedule: string | null;
  status: string;
  lastRun: string | null;
  nextRun: string | null;
}

// Tool types
export interface ToolInfo {
  name: string;
  description: string;
  inputs?: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
}

export interface ToolsData {
  builtin: ToolInfo[];
  user: ToolInfo[];
  mcp: Record<string, ToolInfo[]>;
}

// MCP types
export interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport: string;
  toolCount: number;
}

// Skill types
export interface Skill {
  id: string;
  name: string;
  description: string;
}

// WebSocket message types
export type WsMessageType =
  | 'message'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'stream_resume'
  | 'error'
  | 'connected'
  | 'tool_requested'
  | 'tool_execution_finished'
  | 'tool_progress'
  | 'tool_resume'
  | 'delegation'
  | 'task_run'
  | 'conversation_created'
  | 'conversation_updated';

export interface WsMessage {
  type: WsMessageType;
  [key: string]: unknown;
}

// App state
export interface AppState {
  messages: Message[];
  conversations: Conversation[];
  currentConversationId: string | null;
  tasks: ScheduledTask[];
  tools: ToolsData;
  mcpServers: McpServer[];
  skills: Skill[];
  isConnected: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
}
