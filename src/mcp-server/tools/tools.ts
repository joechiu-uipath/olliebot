/**
 * MCP Tool Handlers: Tool System
 *
 * Tools: list_tools, get_tool_schema, run_tool
 */

import type { MCPServerDependencies, RegisteredTool, MCPToolCallResult } from '../types.js';

function textResult(text: string): MCPToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): MCPToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createToolSystemTools(deps: MCPServerDependencies): RegisteredTool[] {
  return [
    // ── list_tools ──────────────────────────────────────────────────────
    {
      definition: {
        name: 'list_tools',
        description:
          'List all available OllieBot tools organized by source (native, user, MCP) with name, description, and input schema.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        try {
          const definitions = deps.toolRunner.getToolDefinitions();

          const native: Array<{ name: string; description: string }> = [];
          const user: Array<{ name: string; description: string }> = [];
          const mcp: Record<string, Array<{ name: string; description: string }>> = {};

          for (const tool of definitions) {
            switch (tool.source) {
              case 'native':
                native.push({ name: tool.name, description: tool.description });
                break;
              case 'user':
                user.push({ name: tool.name, description: tool.description });
                break;
              case 'mcp': {
                const serverId = tool.serverId || 'unknown';
                if (!mcp[serverId]) mcp[serverId] = [];
                mcp[serverId].push({ name: tool.name, description: tool.description });
                break;
              }
            }
          }

          return textResult(JSON.stringify({
            total: definitions.length,
            native,
            user,
            mcp,
          }, null, 2));
        } catch (err) {
          return errorResult(`Failed to list tools: ${err}`);
        }
      },
    },

    // ── get_tool_schema ─────────────────────────────────────────────────
    {
      definition: {
        name: 'get_tool_schema',
        description:
          'Get the detailed JSON Schema for a specific tool\'s input parameters.',
        inputSchema: {
          type: 'object',
          properties: {
            tool_name: {
              type: 'string',
              description:
                'Full tool name (e.g., \'web_search\', \'user.my_tool\', \'mcp.github__list_repos\').',
            },
          },
          required: ['tool_name'],
        },
      },
      handler: async (args) => {
        try {
          const toolName = args.tool_name as string;
          const definitions = deps.toolRunner.getToolDefinitions();
          const tool = definitions.find((t) => t.name === toolName);

          if (!tool) {
            return errorResult(
              `Tool not found: ${toolName}. Use list_tools to see available tools.`
            );
          }

          return textResult(JSON.stringify({
            name: tool.name,
            description: tool.description,
            source: tool.source,
            serverId: tool.serverId,
            inputSchema: tool.inputSchema,
          }, null, 2));
        } catch (err) {
          return errorResult(`Failed to get tool schema: ${err}`);
        }
      },
    },

    // ── run_tool ────────────────────────────────────────────────────────
    {
      definition: {
        name: 'run_tool',
        description:
          'Execute an OllieBot tool directly with specific parameters. Bypasses the agent loop. Use list_tools to discover available tools and get_tool_schema for parameter details.',
        inputSchema: {
          type: 'object',
          properties: {
            tool_name: {
              type: 'string',
              description:
                'Full tool name (e.g., \'web_search\', \'user.my_tool\', \'mcp.github__list_repos\').',
            },
            parameters: {
              type: 'object',
              description: 'Tool input parameters as a JSON object.',
            },
          },
          required: ['tool_name', 'parameters'],
        },
      },
      handler: async (args) => {
        try {
          const toolName = args.tool_name as string;
          const parameters = (args.parameters as Record<string, unknown>) || {};

          // Validate the tool exists
          const definitions = deps.toolRunner.getToolDefinitions();
          const tool = definitions.find((t) => t.name === toolName);
          if (!tool) {
            return errorResult(
              `Tool not found: ${toolName}. Use list_tools to see available tools.`
            );
          }

          // Create and execute the request
          const request = deps.toolRunner.createRequest(
            crypto.randomUUID(),
            toolName,
            parameters,
            undefined,
            'mcp-server'
          );

          const result = await deps.toolRunner.executeTool(request);

          const output: Record<string, unknown> = {
            tool: result.toolName,
            success: result.success,
            durationMs: result.durationMs,
          };

          if (result.success) {
            output.output = result.output;
          } else {
            output.error = result.error;
          }

          return textResult(JSON.stringify(output, null, 2));
        } catch (err) {
          return errorResult(`Failed to run tool: ${err}`);
        }
      },
    },
  ];
}
