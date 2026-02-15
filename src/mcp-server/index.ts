/**
 * OllieBot MCP Server
 *
 * Exposes OllieBot's internal functionality through the MCP protocol
 * via a Streamable HTTP endpoint mounted at /mcp on the existing Hono server.
 *
 * This is an isolated surface — it does not expose or proxy the REST API.
 * Tool handlers talk directly to internal services (ToolRunner, DB, etc.).
 *
 * Security: Bearer token authentication protects all MCP routes.
 * Configure via MCP_SERVER_SECRET env var. Defense-in-depth with
 * localhost binding + auth + localhost-only middleware.
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { StreamableHTTPHandler } from './handler.js';
import { createLogTools } from './tools/logs.js';
import { createDataTools } from './tools/data.js';
import { createToolSystemTools } from './tools/tools.js';
import { createTraceTools } from './tools/traces.js';
import type { MCPServerDependencies } from './types.js';

export { LogBuffer } from './log-buffer.js';
export type { LogEntry, LogQueryOptions } from './log-buffer.js';
export type { MCPServerDependencies } from './types.js';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares character-by-character via XOR, ensuring comparison
 * takes the same time regardless of where strings differ.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to prevent length-based timing attacks
    let result = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export class OllieBotMCPServer {
  private handler: StreamableHTTPHandler;
  private deps: MCPServerDependencies;

  constructor(deps: MCPServerDependencies) {
    this.deps = deps;
    this.handler = new StreamableHTTPHandler();
    this.registerAllTools();
  }

  /**
   * Create authentication middleware for MCP routes.
   * Validates bearer token against configured secret.
   */
  private createAuthMiddleware() {
    const auth = this.deps.auth;

    return async (c: Context, next: Next) => {
      // Check if auth is disabled (development only)
      if (auth?.disabled) {
        console.warn('[MCP Server] Authentication disabled — only use in isolated environments');
        await next();
        return;
      }

      // Auth enabled but no secret configured — server misconfiguration
      if (!auth?.secret) {
        console.error('[MCP Server] Authentication enabled but MCP_SERVER_SECRET not configured');
        return c.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Server misconfigured: authentication secret not set',
          },
        }, 500);
      }

      // Extract bearer token from Authorization header
      const authHeader = c.req.header('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Unauthorized: missing or invalid Authorization header',
          },
        }, 401);
      }

      const token = authHeader.slice(7); // Remove 'Bearer ' prefix

      // Constant-time comparison to prevent timing attacks
      if (!constantTimeCompare(token, auth.secret)) {
        return c.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Unauthorized: invalid token',
          },
        }, 401);
      }

      await next();
    };
  }

  /**
   * Mount the MCP endpoint routes on the Hono app.
   *
   * Registers POST/GET/DELETE on /mcp with its own isolated middleware
   * (auth, error handler). Does NOT inherit CORS, auth, or
   * error handling from /api/* routes.
   *
   * Security layers:
   * 1. Network binding (localhost-only by default)
   * 2. Bearer token authentication (all routes)
   * 3. Localhost-only middleware (additional check)
   */
  mountRoutes(app: Hono): void {
    const mcpRouter = new Hono();

    // Authentication middleware — validates bearer token on all routes
    mcpRouter.use('*', this.createAuthMiddleware());

    // POST /mcp — JSON-RPC request/response
    mcpRouter.post('/', async (c) => {
      return this.handler.handlePost(c);
    });

    // GET /mcp — SSE stream for notifications
    mcpRouter.get('/', async (c) => {
      return this.handler.handleGet(c);
    });

    // DELETE /mcp — Session teardown
    mcpRouter.delete('/', async (c) => {
      return this.handler.handleDelete(c);
    });

    // Error handler for /mcp
    mcpRouter.onError((err, c) => {
      console.error('[MCP Server] Route error:', err);
      return c.json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal server error',
        },
      }, 500);
    });

    app.route('/mcp', mcpRouter);

    // OAuth discovery endpoints (RFC 8414)
    // Claude Code probes these before connecting. Return proper JSON 404s to indicate
    // OAuth is not supported — this server uses bearer token authentication instead.
    app.get('/.well-known/oauth-authorization-server', (c) => {
      return c.json({
        error: 'not_found',
        error_description: 'OAuth not supported. Use bearer token authentication with Authorization header.',
      }, 404);
    });
    app.get('/.well-known/oauth-protected-resource', (c) => {
      return c.json({
        error: 'not_found',
        error_description: 'OAuth not supported. Use bearer token authentication with Authorization header.',
      }, 404);
    });

    const toolCount = this.handler['tools'].size;
    const authStatus = this.deps.auth?.disabled ? 'DISABLED (dev mode)' : 'enabled';
    console.log(`[MCP Server] Mounted at /mcp with ${toolCount} tools (auth: ${authStatus})`);
  }

  /**
   * Register all Phase 1 tools.
   */
  private registerAllTools(): void {
    // Logs & Observability
    for (const tool of createLogTools(this.deps)) {
      this.handler.registerTool(tool);
    }

    // Data Inspection
    for (const tool of createDataTools()) {
      this.handler.registerTool(tool);
    }

    // Tool System
    for (const tool of createToolSystemTools(this.deps)) {
      this.handler.registerTool(tool);
    }

    // Trace & Observability
    for (const tool of createTraceTools(this.deps)) {
      this.handler.registerTool(tool);
    }
  }
}
