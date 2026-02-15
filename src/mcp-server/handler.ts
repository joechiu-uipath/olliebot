/**
 * MCP Streamable HTTP Handler
 *
 * Implements the MCP Streamable HTTP transport:
 * - POST /mcp — JSON-RPC request/response
 * - GET /mcp  — SSE stream (stubbed for future notifications)
 * - DELETE /mcp — Session teardown (no-op for stateless server)
 *
 * This handler is self-contained and does not inherit any middleware
 * from the REST API routes.
 */

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  MCP_PROTOCOL_VERSION,
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPInitializeResult,
  type MCPToolCallParams,
  type MCPToolCallResult,
  type RegisteredTool,
} from './types.js';

export class StreamableHTTPHandler {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool with its definition and handler.
   */
  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * Handle POST /mcp — JSON-RPC request dispatch.
   */
  async handlePost(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();

      // Handle batch requests (JSON-RPC allows arrays)
      if (Array.isArray(body)) {
        const responses: JsonRpcResponse[] = [];
        for (const item of body) {
          const response = await this.dispatch(item);
          if (response) responses.push(response);
        }
        return c.json(responses);
      }

      // Single request
      const request = body as JsonRpcRequest;

      if (!request || !request.jsonrpc || request.jsonrpc !== '2.0') {
        return c.json(this.makeError(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Invalid JSON-RPC 2.0 request'
        ), 400);
      }

      const response = await this.dispatch(request);

      // Notifications (no id) don't get a response
      if (!response) {
        return c.body(null, 204);
      }

      return c.json(response);
    } catch (err) {
      return c.json(this.makeError(
        null,
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        `Internal error: ${err}`
      ), 500);
    }
  }

  /**
   * Handle GET /mcp — SSE stream for server-to-client notifications.
   * Stubbed for Phase 1; will support progress events in Phase 3.
   */
  async handleGet(c: Context): Promise<Response> {
    return streamSSE(c, async (stream) => {
      // Send initial comment to establish the connection
      await stream.writeSSE({ data: 'MCP SSE stream established', event: 'init' });

      // Keep alive — client will disconnect when done
      const keepAlive = setInterval(async () => {
        try {
          await stream.writeSSE({ data: '', event: 'keepalive' });
        } catch {
          // Stream closed, ignore
        }
      }, 30000);

      // Wait for abort signal (client disconnect)
      stream.onAbort(() => {
        clearInterval(keepAlive);
      });

      // Keep stream open until client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  }

  /**
   * Handle DELETE /mcp — Session teardown.
   * No-op for this stateless server.
   */
  async handleDelete(c: Context): Promise<Response> {
    return c.json({ jsonrpc: '2.0', result: {} });
  }

  /**
   * Dispatch a single JSON-RPC request to the appropriate handler.
   */
  private async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { method, params, id } = request;

    // Notifications (no id) are fire-and-forget
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'notifications/initialized':
          // Client acknowledges initialization — no response needed
          return null;

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          return await this.handleToolsCall(id, params as unknown as MCPToolCallParams);

        case 'ping':
          return this.makeResult(id, {});

        default:
          if (isNotification) return null;
          return this.makeError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
      }
    } catch (err) {
      if (isNotification) return null;
      return this.makeError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, `Handler error: ${err}`);
    }
  }

  /**
   * Handle `initialize` — return server info and capabilities.
   */
  private handleInitialize(id: number | string | undefined): JsonRpcResponse {
    const result: MCPInitializeResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'olliebot',
        version: '0.1.0',
      },
    };
    return this.makeResult(id, result);
  }

  /**
   * Handle `tools/list` — return all registered tool definitions.
   */
  private handleToolsList(id: number | string | undefined): JsonRpcResponse {
    const tools = Array.from(this.tools.values()).map((t) => t.definition);
    return this.makeResult(id, { tools });
  }

  /**
   * Handle `tools/call` — execute a tool and return its result.
   */
  private async handleToolsCall(
    id: number | string | undefined,
    params: MCPToolCallParams
  ): Promise<JsonRpcResponse> {
    if (!params?.name) {
      return this.makeError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name');
    }

    const tool = this.tools.get(params.name);
    if (!tool) {
      return this.makeError(
        id,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        `Unknown tool: ${params.name}`
      );
    }

    try {
      const result: MCPToolCallResult = await tool.handler(params.arguments || {});
      return this.makeResult(id, result);
    } catch (err) {
      return this.makeResult(id, {
        content: [{ type: 'text', text: `Tool execution error: ${err}` }],
        isError: true,
      } satisfies MCPToolCallResult);
    }
  }

  // ── JSON-RPC helpers ──────────────────────────────────────────────────

  private makeResult(id: number | string | undefined, result: unknown): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result,
    };
  }

  private makeError(
    id: number | string | null | undefined,
    code: number,
    message: string
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message },
    };
  }
}
