/**
 * OllieBot MCP Server Types
 *
 * Types for the MCP Streamable HTTP transport and tool definitions.
 */

import type { ToolRunner } from '../tools/runner.js';
import type { MCPClient } from '../mcp/client.js';
import type { LogBuffer } from './log-buffer.js';
import type { TraceStore } from '../tracing/index.js';

// ============================================================================
// JSON-RPC 2.0
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// MCP Protocol
// ============================================================================

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPCapabilities {
  tools?: Record<string, never>;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: MCPServerInfo;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolResultContent {
  type: 'text';
  text: string;
}

export interface MCPToolCallResult {
  content: MCPToolResultContent[];
  isError?: boolean;
}

// ============================================================================
// Tool Handler
// ============================================================================

export type MCPToolHandler = (
  args: Record<string, unknown>
) => Promise<MCPToolCallResult>;

export interface RegisteredTool {
  definition: MCPToolDefinition;
  handler: MCPToolHandler;
}

// ============================================================================
// MCP Server Dependencies
// ============================================================================

export interface MCPServerDependencies {
  toolRunner: ToolRunner;
  mcpClient?: MCPClient;
  logBuffer: LogBuffer;
  /** Trace store for execution trace queries */
  traceStore?: TraceStore;
  /** Server start time for uptime calculation */
  startTime: Date;
  /** Function to get connected WebSocket client count */
  getClientCount: () => number;
  /** Runtime config (provider, model info — API keys redacted) */
  runtimeConfig: {
    mainProvider: string;
    mainModel: string;
    fastProvider: string;
    fastModel: string;
    port: number;
  };
  /** Authentication configuration (optional) */
  auth?: {
    /** Shared secret for bearer token auth (64-char hex recommended) */
    secret?: string;
    /** Disable auth entirely (only for isolated dev environments) */
    disabled?: boolean;
  };
}
