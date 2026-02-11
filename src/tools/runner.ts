/**
 * Tool Runner - Executes tools and emits events
 *
 * Central runtime for tool execution that:
 * - Registers native tools
 * - Integrates with MCP client and skill manager
 * - Handles sequential and parallel execution
 * - Emits events for UI updates
 * - Extracts citations from tool outputs
 */

import { v4 as uuid } from 'uuid';
import type {
  ToolDefinition,
  ToolRequest,
  ToolResult,
  ToolEvent,
  ToolEventCallback,
  ToolSource,
  LLMTool,
} from './types.js';
import type { NativeTool, ToolExecutionContext } from './native/types.js';
import type { MCPClient } from '../mcp/client.js';
import { initializeCitationServiceSync } from '../citations/service.js';
import { getDefaultExtractors } from '../citations/extractors.js';
import type { CitationSource } from '../citations/types.js';

/**
 * Result of tool execution with citations
 */
export interface ToolExecutionResult {
  results: ToolResult[];
  citations: CitationSource[];
}

/**
 * Internal result from invokeToolBySource carrying display metadata alongside output.
 */
interface InvokeToolResult {
  output: unknown;
  files?: Array<{
    name: string;
    dataUrl: string;
    size: number;
    mediaType?: string;
  }>;
  displayOnly?: boolean;
  displayOnlySummary?: string;
}

export interface ToolRunnerConfig {
  mcpClient?: MCPClient;
  nativeTools?: Map<string, NativeTool>;
}

export class ToolRunner {
  private mcpClient: MCPClient | null;
  private nativeTools: Map<string, NativeTool>;
  private userTools: Map<string, NativeTool>;
  private eventListeners: Set<ToolEventCallback> = new Set();

  constructor(config: ToolRunnerConfig = {}) {
    this.mcpClient = config.mcpClient || null;
    this.nativeTools = config.nativeTools || new Map();
    this.userTools = new Map();
  }

  /**
   * Register a native tool
   */
  registerNativeTool(tool: NativeTool): void {
    this.nativeTools.set(tool.name, tool);
    console.log(`[ToolRunner] Registered native tool: ${tool.name}`);
  }

  /**
   * Register a user-defined tool
   * If name conflicts with a native tool, native tool takes precedence and user tool is rejected
   */
  registerUserTool(tool: NativeTool): void {
    if (this.nativeTools.has(tool.name)) {
      console.error(
        `[ToolRunner] User tool '${tool.name}' conflicts with native tool. Native tool takes precedence. User tool ignored.`
      );
      return;
    }
    this.userTools.set(tool.name, tool);
    console.log(`[ToolRunner] Registered user tool: ${tool.name}`);
  }

  /**
   * Subscribe to tool events
   * Returns unsubscribe function
   */
  onToolEvent(callback: ToolEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ToolEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ToolRunner] Event listener error:', error);
      }
    }
  }

  /**
   * Get all available tools formatted for LLM API
   */
  getToolsForLLM(): LLMTool[] {
    const tools: LLMTool[] = [];

    // Add native tools (no prefix)
    for (const [name, tool] of this.nativeTools) {
      tools.push({
        name: name,
        description: tool.description,
        input_schema: tool.inputSchema,
      });
    }

    // Add user-defined tools (user. prefix)
    for (const [name, tool] of this.userTools) {
      tools.push({
        name: `user.${name}`,
        description: tool.description,
        input_schema: tool.inputSchema,
      });
    }

    // Add MCP tools (already prefixed with mcp. by MCPClient)
    if (this.mcpClient) {
      const mcpTools = this.mcpClient.getToolsForLLM();
      for (const tool of mcpTools) {
        tools.push({
          name: tool.name, // Already prefixed with mcp.serverId__toolName
          description: tool.description,
          input_schema: tool.input_schema,
        });
      }
    }

    // Note: Skills are not exposed as tools
    // Per Agent Skills spec, skills are injected into the system prompt
    // and agents read/execute them via filesystem access (bash tools)

    return tools;
  }

  /**
   * Get all tool definitions (full info)
   */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    // Add native tools (no prefix)
    for (const [name, tool] of this.nativeTools) {
      tools.push({
        name: name,
        description: tool.description,
        source: 'native',
        inputSchema: tool.inputSchema,
      });
    }

    // Add user-defined tools (user. prefix)
    for (const [name, tool] of this.userTools) {
      tools.push({
        name: `user.${name}`,
        description: tool.description,
        source: 'user',
        inputSchema: tool.inputSchema,
      });
    }

    // Add MCP tools (mcp. prefix already added by MCPClient)
    if (this.mcpClient) {
      const mcpTools = this.mcpClient.getToolsForLLM();
      for (const tool of mcpTools) {
        // Parse mcp.serverId__toolName format
        const nameWithoutPrefix = tool.name.replace(/^mcp\./, '');
        const [serverId] = nameWithoutPrefix.split('__');
        tools.push({
          name: tool.name,
          description: tool.description,
          source: 'mcp',
          inputSchema: tool.input_schema,
          serverId,
        });
      }
    }

    // Note: Skills are not exposed as tools
    // Per Agent Skills spec, skills are injected into the system prompt

    return tools;
  }

  /**
   * Execute a single tool
   */
  async executeTool(request: ToolRequest): Promise<ToolResult> {
    const startTime = new Date();

    // Emit tool_requested event
    this.emitEvent({
      type: 'tool_requested',
      requestId: request.id,
      toolName: request.toolName,
      source: request.source,
      parameters: request.parameters,
      timestamp: new Date(),
      callerId: request.callerId,
    });

    // Build execution context with a progress callback that emits tool_progress events
    const context: ToolExecutionContext = {
      onProgress: (progress) => {
        this.emitEvent({
          type: 'tool_progress',
          requestId: request.id,
          toolName: request.toolName,
          source: request.source,
          progress,
          timestamp: new Date(),
          callerId: request.callerId,
        });
      },
    };

    let result: ToolResult;

    try {
      const invokeResult = await this.invokeToolBySource(request, context);
      const endTime = new Date();

      result = {
        requestId: request.id,
        toolName: request.toolName,
        success: true,
        output: invokeResult.output,
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
        displayOnly: invokeResult.displayOnly,
        displayOnlySummary: invokeResult.displayOnlySummary,
      };

    } catch (error) {
      const endTime = new Date();

      result = {
        requestId: request.id,
        toolName: request.toolName,
        success: false,
        error: String(error),
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      };

    }

    // Emit tool_execution_finished event
    this.emitEvent({
      type: 'tool_execution_finished',
      requestId: result.requestId,
      toolName: result.toolName,
      source: request.source,
      success: result.success,
      parameters: request.parameters,
      result: result.output,
      error: result.error,
      startTime: result.startTime,
      endTime: result.endTime,
      durationMs: result.durationMs,
      timestamp: new Date(),
      callerId: request.callerId,
    });

    return result;
  }

  /**
   * Execute multiple tools
   * Tools with the same groupId run in parallel
   */
  async executeTools(requests: ToolRequest[]): Promise<ToolResult[]> {
    if (requests.length === 0) {
      return [];
    }

    // Group by groupId - same groupId runs in parallel
    const groups = new Map<string, ToolRequest[]>();

    for (const request of requests) {
      // No groupId = sequential (unique group per request)
      const groupId = request.groupId || `seq_${request.id}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push(request);
    }

    const results: ToolResult[] = [];

    // Execute groups sequentially, requests within group in parallel
    for (const [_groupId, groupRequests] of groups) {
      if (groupRequests.length === 1) {
        // Single request - execute directly
        const result = await this.executeTool(groupRequests[0]);
        results.push(result);
      } else {
        // Multiple requests in group - execute in parallel
        const groupResults = await Promise.all(
          groupRequests.map((req) => this.executeTool(req))
        );
        results.push(...groupResults);
      }
    }

    return results;
  }

  /**
   * Execute multiple tools and extract citations from results
   * This is the preferred method for agents that need citation support
   */
  async executeToolsWithCitations(requests: ToolRequest[]): Promise<ToolExecutionResult> {
    const results = await this.executeTools(requests);

    // Extract citations from successful tool results
    const citationService = initializeCitationServiceSync(getDefaultExtractors());
    const citations = citationService.extractSources(results);

    if (citations.length > 0) {
      console.log(`[ToolRunner] Extracted ${citations.length} citation source(s)`);
    }

    return { results, citations };
  }

  /**
   * Route tool execution to appropriate handler based on source
   */
  private async invokeToolBySource(request: ToolRequest, context?: ToolExecutionContext): Promise<InvokeToolResult> {
    const { toolName, source, parameters } = request;

    switch (source) {
      case 'native': {
        // No prefix for native tools
        const tool = this.nativeTools.get(toolName);
        if (!tool) {
          throw new Error(`Native tool not found: ${toolName}`);
        }
        const result = await tool.execute(parameters, context);
        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
        }
        return {
          output: result.output,
          files: result.files,
          displayOnly: result.displayOnly,
          displayOnlySummary: result.displayOnlySummary,
        };
      }

      case 'user': {
        const userName = toolName.replace('user.', '');
        const tool = this.userTools.get(userName);
        if (!tool) {
          throw new Error(`User tool not found: ${userName}`);
        }
        const result = await tool.execute(parameters, context);
        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
        }
        return {
          output: result.output,
          files: result.files,
          displayOnly: result.displayOnly,
          displayOnlySummary: result.displayOnlySummary,
        };
      }

      case 'mcp': {
        if (!this.mcpClient) {
          throw new Error('MCP client not configured');
        }
        // Parse mcp.serverId__toolName format
        const nameWithoutPrefix = toolName.replace(/^mcp\./, '');
        const [serverId, ...nameParts] = nameWithoutPrefix.split('__');
        const mcpToolName = nameParts.join('__');
        const result = await this.mcpClient.invokeTool({
          serverId,
          toolName: mcpToolName,
          input: parameters,
        });
        if (!result.success) {
          throw new Error(result.error || 'MCP tool execution failed');
        }
        return { output: result.output };
      }

      default:
        throw new Error(`Unknown tool source: ${source}`);
    }
  }

  /**
   * Parse tool name to determine source
   */
  parseToolName(fullName: string): { source: ToolSource; name: string } {
    if (fullName.startsWith('user.')) {
      return { source: 'user', name: fullName.replace('user.', '') };
    }
    if (fullName.startsWith('mcp.')) {
      return { source: 'mcp', name: fullName };
    }
    // No prefix = native tool
    return { source: 'native', name: fullName };
  }

  /**
   * Check if a native tool is marked as private
   * Private tools are only available to supervisor agents unless explicitly granted
   */
  isPrivateTool(toolName: string): boolean {
    const tool = this.nativeTools.get(toolName);
    return tool?.private === true;
  }

  /**
   * Get list of private tool names
   */
  getPrivateToolNames(): string[] {
    return Array.from(this.nativeTools.entries())
      .filter(([_, tool]) => tool.private === true)
      .map(([name]) => name);
  }

  /**
   * Create a tool request from LLM tool_use block
   * @param callerId - ID of the agent making this request (for event filtering)
   */
  createRequest(
    toolUseId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    groupId?: string,
    callerId?: string
  ): ToolRequest {
    const { source } = this.parseToolName(toolName);
    return {
      id: toolUseId,
      toolName,
      source,
      parameters,
      groupId,
      callerId,
    };
  }
}
