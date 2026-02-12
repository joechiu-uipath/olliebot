/**
 * MCP Tool Handlers: Logs & Observability
 *
 * Tools: server_log, health
 */

import type { MCPServerDependencies, RegisteredTool, MCPToolCallResult } from '../types.js';

function textResult(text: string): MCPToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): MCPToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createLogTools(deps: MCPServerDependencies): RegisteredTool[] {
  return [
    // ── server_log ──────────────────────────────────────────────────────
    {
      definition: {
        name: 'server_log',
        description:
          'Read recent Node.js server console output. Returns timestamped log lines from a circular buffer.',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['log', 'warn', 'error'],
              description: 'Filter by log level. Omit for all levels.',
            },
            grep: {
              type: 'string',
              description: 'Substring filter — only return lines containing this string.',
            },
            limit: {
              type: 'number',
              description: 'Max lines to return. Default 50, max 500.',
            },
            since: {
              type: 'string',
              description: 'ISO 8601 timestamp — only return lines after this time.',
            },
          },
        },
      },
      handler: async (args) => {
        try {
          const entries = deps.logBuffer.query({
            level: args.level as 'log' | 'warn' | 'error' | undefined,
            grep: args.grep as string | undefined,
            limit: args.limit as number | undefined,
            since: args.since as string | undefined,
            source: 'server',
          });

          if (entries.length === 0) {
            return textResult('No log entries found matching the query.');
          }

          const lines = entries.map(
            (e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`
          );
          return textResult(
            `${entries.length} log entries (buffer size: ${deps.logBuffer.size()}):\n\n${lines.join('\n')}`
          );
        } catch (err) {
          return errorResult(`Failed to query server logs: ${err}`);
        }
      },
    },

    // ── health ──────────────────────────────────────────────────────────
    {
      definition: {
        name: 'health',
        description:
          'Server health check. Returns uptime, memory usage, connected WebSocket clients, and LLM provider info.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const mem = process.memoryUsage();
        const uptimeMs = Date.now() - deps.startTime.getTime();
        const uptimeSeconds = Math.floor(uptimeMs / 1000);
        const uptimeMinutes = Math.floor(uptimeSeconds / 60);
        const uptimeHours = Math.floor(uptimeMinutes / 60);

        const formatBytes = (bytes: number) =>
          `${(bytes / 1024 / 1024).toFixed(1)} MB`;

        let uptime: string;
        if (uptimeHours > 0) {
          uptime = `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`;
        } else if (uptimeMinutes > 0) {
          uptime = `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
        } else {
          uptime = `${uptimeSeconds}s`;
        }

        const health = {
          status: 'ok',
          uptime,
          uptimeMs,
          memory: {
            rss: formatBytes(mem.rss),
            heapUsed: formatBytes(mem.heapUsed),
            heapTotal: formatBytes(mem.heapTotal),
            external: formatBytes(mem.external),
          },
          connectedClients: deps.getClientCount(),
          llm: {
            mainProvider: deps.runtimeConfig.mainProvider,
            mainModel: deps.runtimeConfig.mainModel,
            fastProvider: deps.runtimeConfig.fastProvider,
            fastModel: deps.runtimeConfig.fastModel,
          },
          server: {
            port: deps.runtimeConfig.port,
            nodeVersion: process.version,
            platform: process.platform,
          },
          logBufferSize: deps.logBuffer.size(),
        };

        return textResult(JSON.stringify(health, null, 2));
      },
    },
  ];
}
