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
}

// Union of all tool events
export type ToolEvent = ToolRequestedEvent | ToolExecutionFinishedEvent;

// Event callback type
export type ToolEventCallback = (event: ToolEvent) => void;

// Tool formatted for LLM API
export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
