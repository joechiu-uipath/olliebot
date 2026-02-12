/**
 * OllieBot MCP Server
 *
 * Exposes OllieBot's internal functionality through the MCP protocol
 * via a Streamable HTTP endpoint mounted at /mcp on the existing Express server.
 *
 * This is an isolated surface — it does not expose or proxy the REST API.
 * Tool handlers talk directly to internal services (ToolRunner, DB, etc.).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import { StreamableHTTPHandler } from './handler.js';
import { createLogTools } from './tools/logs.js';
import { createDataTools } from './tools/data.js';
import { createToolSystemTools } from './tools/tools.js';
import type { MCPServerDependencies } from './types.js';

export { LogBuffer } from './log-buffer.js';
export type { LogEntry, LogQueryOptions } from './log-buffer.js';
export type { MCPServerDependencies } from './types.js';

export class OllieBotMCPServer {
  private handler: StreamableHTTPHandler;
  private deps: MCPServerDependencies;

  constructor(deps: MCPServerDependencies) {
    this.deps = deps;
    this.handler = new StreamableHTTPHandler();
    this.registerAllTools();
  }

  /**
   * Mount the MCP endpoint routes on the Express app.
   *
   * Registers POST/GET/DELETE on /mcp with its own isolated middleware
   * (JSON body parser, error handler). Does NOT inherit CORS, auth, or
   * error handling from /api/* routes.
   */
  mountRoutes(app: Express): void {
    const router = express.Router();

    // Own JSON body parser — isolated from the app-level one
    router.use(express.json());

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

    const toolCount = this.handler['tools'].size;
    console.log(`[MCP Server] Mounted at /mcp with ${toolCount} tools`);
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
  }
}
