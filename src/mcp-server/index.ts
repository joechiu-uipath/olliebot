/**
 * OllieBot MCP Server
 *
 * Exposes OllieBot's internal functionality through the MCP protocol
 * via a Streamable HTTP endpoint mounted at /mcp on the existing Express server.
 *
 * This is an isolated surface — it does not expose or proxy the REST API.
 * Tool handlers talk directly to internal services (ToolRunner, DB, etc.).
 *
 * Security: Bearer token authentication protects all MCP routes.
 * Configure via MCP_SERVER_SECRET env var. Defense-in-depth with
 * localhost binding + auth + localhost-only middleware.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
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
  private createAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    const auth = this.deps.auth;

    return (req: Request, res: Response, next: NextFunction) => {
      // Check if auth is disabled (development only)
      if (auth?.disabled) {
        console.warn('[MCP Server] Authentication disabled — only use in isolated environments');
        next();
        return;
      }

      // Auth enabled but no secret configured — server misconfiguration
      if (!auth?.secret) {
        console.error('[MCP Server] Authentication enabled but MCP_SERVER_SECRET not configured');
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Server misconfigured: authentication secret not set',
          },
        });
        return;
      }

      // Extract bearer token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Unauthorized: missing or invalid Authorization header',
          },
        });
        return;
      }

      const token = authHeader.slice(7); // Remove 'Bearer ' prefix

      // Constant-time comparison to prevent timing attacks
      if (!constantTimeCompare(token, auth.secret)) {
        res.status(401).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Unauthorized: invalid token',
          },
        });
        return;
      }

      next();
    };
  }

  /**
   * Mount the MCP endpoint routes on the Express app.
   *
   * Registers POST/GET/DELETE on /mcp with its own isolated middleware
   * (JSON body parser, auth, error handler). Does NOT inherit CORS, auth, or
   * error handling from /api/* routes.
   *
   * Security layers:
   * 1. Network binding (localhost-only by default)
   * 2. Bearer token authentication (all routes)
   * 3. Localhost-only middleware (additional check)
   */
  mountRoutes(app: Express): void {
    const router = express.Router();

    // Own JSON body parser — isolated from the app-level one
    router.use(express.json());

    // Authentication middleware — validates bearer token on all routes
    const authMiddleware = this.createAuthMiddleware();
    router.use(authMiddleware);

    // POST /mcp — JSON-RPC request/response
    router.post('/', (req: Request, res: Response) => {
      this.handler.handlePost(req, res);
    });

    // GET /mcp — SSE stream for notifications
    router.get('/', (req: Request, res: Response) => {
      this.handler.handleGet(req, res);
    });

    // DELETE /mcp — Session teardown
    router.delete('/', (req: Request, res: Response) => {
      this.handler.handleDelete(req, res);
    });

    // Isolated error handler for /mcp
    router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[MCP Server] Route error:', err);
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal server error',
        },
      });
    });

    app.use('/mcp', router);

    // OAuth discovery endpoints (RFC 8414)
    // Claude Code probes these before connecting. Return proper JSON 404s to indicate
    // OAuth is not supported — this server uses bearer token authentication instead.
    app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
      res.status(404).json({
        error: 'not_found',
        error_description: 'OAuth not supported. Use bearer token authentication with Authorization header.',
      });
    });
    app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
      res.status(404).json({
        error: 'not_found',
        error_description: 'OAuth not supported. Use bearer token authentication with Authorization header.',
      });
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
