/**
 * Tool System Types
 *
 * Core type definitions for the tool execution system including
 * tool definitions, requests, results, and events.
 */

// Tool sources (skills are not tools - they're loaded via system prompt)
export type ToolSource = 'native' | 'mcp' | 'user';

// Tool definition for LLM
export interface ToolDefinition {
  name: string;
  description: string;
  source: ToolSource;
  inputSchema: Record<string, unknown>;
  // For MCP tools
  serverId?: string;
}

// Tool invocation request from LLM
export interface ToolRequest {
  id: string;
  toolName: string;
  source: ToolSource;
  parameters: Record<string, unknown>;
  // Tools with same groupId run concurrently
  groupId?: string;
  // ID of the agent that initiated this request (for event filtering)
  callerId?: string;
  // Tracing context for recording tool calls
  traceId?: string;
  spanId?: string;
}

// File attachment from tool execution (e.g., screenshots, generated images)
export interface ToolResultFile {
  name: string;
  dataUrl: string;
  size: number;
  mediaType?: string;
}

// Tool execution result
export interface ToolResult {
  requestId: string;
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  /**
   * When true, the full output is displayed to the user via UI events but
   * is NOT sent to the LLM. A minimal acknowledgment is sent instead.
   */
  displayOnly?: boolean;
  /**
   * Short summary sent to the LLM when displayOnly is true.
   */
  displayOnlySummary?: string;
  /**
   * File attachments (images, documents) from tool execution.
   */
  files?: ToolResultFile[];
}

// Event: Tool requested (emitted when tool execution starts)
export interface ToolRequestedEvent {
  type: 'tool_requested';
  requestId: string;
  toolName: string;
  source: ToolSource;
  parameters: Record<string, unknown>;
  timestamp: Date;
  // ID of the agent that initiated this request (for event filtering)
  callerId?: string;
}

// Event: Tool execution finished (emitted when tool completes)
export interface ToolExecutionFinishedEvent {
  type: 'tool_execution_finished';
  requestId: string;
  toolName: string;
  source: ToolSource;
  success: boolean;
  parameters: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  timestamp: Date;
  // ID of the agent that initiated this request (for event filtering)
  callerId?: string;
  // File attachments (images, documents) from tool execution
  files?: ToolResultFile[];
}

// Event: Tool progress update (emitted during long-running tool execution)
export interface ToolProgressEvent {
  type: 'tool_progress';
  requestId: string;
  toolName: string;
  source: ToolSource;
  progress: {
    /** Current count / step number */
    current: number;
    /** Total expected (if known) */
    total?: number;
    /** Human-readable progress message */
    message?: string;
  };
  timestamp: Date;
  // ID of the agent that initiated this request (for event filtering)
  callerId?: string;
}

// Union of all tool events
export type ToolEvent = ToolRequestedEvent | ToolExecutionFinishedEvent | ToolProgressEvent;

// Event callback type
export type ToolEventCallback = (event: ToolEvent) => void;

// Tool formatted for LLM API
export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Minimal interface for tool execution.
 * Satisfied by both ToolRunner (real tools) and MockedToolRunner (test mocks).
 */
export interface ToolExecutor {
  /** Get tool definitions formatted for LLM API */
  getToolsForLLM(): LLMTool[];

  /** Create a tool request from an LLM tool_use block */
  createRequest(
    toolUseId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    groupId?: string
  ): ToolRequest;

  /** Execute a single tool request */
  executeTool(request: ToolRequest): Promise<ToolResult>;

  /** Execute multiple tool requests */
  executeTools(requests: ToolRequest[]): Promise<ToolResult[]>;
}
