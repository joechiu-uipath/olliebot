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

import type { Request, Response } from 'express';
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
  async handlePost(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;

      // Handle batch requests (JSON-RPC allows arrays)
      if (Array.isArray(body)) {
        const responses: JsonRpcResponse[] = [];
        for (const item of body) {
          const response = await this.dispatch(item);
          if (response) responses.push(response);
        }
        res.json(responses);
        return;
      }

      // Single request
      const request = body as JsonRpcRequest;

      if (!request || !request.jsonrpc || request.jsonrpc !== '2.0') {
        res.status(400).json(this.makeError(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Invalid JSON-RPC 2.0 request'
        ));
        return;
      }

      const response = await this.dispatch(request);

      // Notifications (no id) don't get a response
      if (!response) {
        res.status(204).end();
        return;
      }

      res.json(response);
    } catch (err) {
      res.status(500).json(this.makeError(
        null,
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        `Internal error: ${err}`
      ));
    }
  }

  /**
   * Handle GET /mcp — SSE stream for server-to-client notifications.
   * Stubbed for Phase 1; will support progress events in Phase 3.
   */
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial comment to establish the connection
    res.write(': MCP SSE stream established\n\n');

    // Keep alive — client will disconnect when done
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    _req.on('close', () => {
      clearInterval(keepAlive);
    });
  }

  /**
   * Handle DELETE /mcp — Session teardown.
   * No-op for this stateless server.
   */
  async handleDelete(_req: Request, res: Response): Promise<void> {
    res.json({ jsonrpc: '2.0', result: {} });
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
