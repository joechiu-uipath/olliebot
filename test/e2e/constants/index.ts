/**
 * E2E Test Constants
 *
 * Centralized enums for all test constants.
 * Tests should use these enums instead of string literals.
 */

// ============================================================
// App Modes
// ============================================================

export enum Mode {
  CHAT = 'Chat',
  TRACES = 'Trace',
  MISSION = 'Mission',
  EVAL = 'Eval',
}

// ============================================================
// Agent Types
// ============================================================

export enum AgentType {
  SUPERVISOR = 'supervisor',
  RESEARCHER = 'researcher',
  CODER = 'coder',
  WRITER = 'writer',
  PLANNER = 'planner',
  DEEP_RESEARCH_LEAD = 'deep-research-lead',
  CODING_LEAD = 'coding-lead',
  CODING_FIXER = 'coding-fixer',
}

// ============================================================
// Tool Names - Native Tools
// ============================================================

export enum ToolName {
  // Web & Search
  WEB_SEARCH = 'web_search',
  WEB_SCRAPE = 'web_scrape',
  WEBSITE_CRAWLER = 'website_crawler',
  HTTP_CLIENT = 'http_client',
  WIKIPEDIA_SEARCH = 'wikipedia_search',

  // Code Execution
  RUN_PYTHON = 'run_python',
  GENERATE_PYTHON = 'generate_python',

  // Media
  CREATE_IMAGE = 'create_image',
  SPEAK = 'speak',
  TAKE_SCREENSHOT = 'take_screenshot',

  // Memory
  REMEMBER = 'remember',

  // System & Delegation
  DELEGATE = 'delegate',

  // RAG
  QUERY_RAG_PROJECT = 'query_rag_project',

  // Browser & Desktop
  BROWSER_SESSION = 'browser_session',
  DESKTOP_SESSION = 'desktop_session',

  // Self-Coding
  READ_FRONTEND_CODE = 'read_frontend_code',
  MODIFY_FRONTEND_CODE = 'modify_frontend_code',
  CHECK_FRONTEND_CODE = 'check_frontend_code',

  // Skills
  READ_AGENT_SKILL = 'read_agent_skill',
  RUN_AGENT_SKILL_SCRIPT = 'run_agent_skill_script',

  // Missions
  MISSION_TODO_CREATE = 'mission_todo_create',
  MISSION_UPDATE_DASHBOARD = 'mission_update_dashboard',
}

// ============================================================
// Session Status
// ============================================================

export enum SessionStatus {
  ACTIVE = 'active',
  BUSY = 'busy',
  IDLE = 'idle',
  ERROR = 'error',
  CLOSED = 'closed',
}

// ============================================================
// Trace Status
// ============================================================

export enum TraceStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
}

// ============================================================
// Tool Source
// ============================================================

export enum ToolSource {
  NATIVE = 'native',
  USER = 'user',
  MCP = 'mcp',
}

// ============================================================
// Message Types
// ============================================================

export enum MessageType {
  TEXT = 'text',
  TOOL_EXECUTION = 'tool_execution',
  DELEGATION = 'delegation',
  ERROR = 'error',
  TASK_RUN = 'task_run',
}

// ============================================================
// WebSocket Event Types
// ============================================================

export enum WsEventType {
  CONNECTED = 'connected',
  STREAM_START = 'stream_start',
  STREAM_CHUNK = 'stream_chunk',
  STREAM_END = 'stream_end',
  TOOL_REQUESTED = 'tool_requested',
  TOOL_EXECUTION_FINISHED = 'tool_execution_finished',
  DELEGATION = 'delegation',
  DELEGATION_END = 'delegation_end',
  RAG_INDEXING_PROGRESS = 'rag_indexing_progress',
  TASK_UPDATED = 'task_updated',
  DEEP_RESEARCH_PROGRESS = 'deep_research_progress',
  LOG_TRACE = 'log_trace',
  STREAM_RESUME = 'stream_resume',
  TOOL_RESUME = 'tool_resume',
}

// ============================================================
// Built-in Agent Names & Emojis
// ============================================================

export const AgentInfo = {
  [AgentType.SUPERVISOR]: { name: 'OllieBot', emoji: '🐙' },
  [AgentType.RESEARCHER]: { name: 'Researcher', emoji: '🔬' },
  [AgentType.CODER]: { name: 'Coder', emoji: '💻' },
  [AgentType.WRITER]: { name: 'Writer', emoji: '✍️' },
  [AgentType.PLANNER]: { name: 'Planner', emoji: '📋' },
  [AgentType.DEEP_RESEARCH_LEAD]: { name: 'Deep Research Lead', emoji: '🔬' },
  [AgentType.CODING_LEAD]: { name: 'Coding Lead', emoji: '💻' },
  [AgentType.CODING_FIXER]: { name: 'Coding Fixer', emoji: '🔧' },
} as const;

// ============================================================
// Well-known Conversation IDs
// ============================================================

export enum WellKnownConversation {
  FEED = 'feed',
}
