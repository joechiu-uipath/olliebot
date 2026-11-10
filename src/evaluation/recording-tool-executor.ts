/**
 * RecordingToolExecutor - Decorator that wraps any ToolExecutor with call recording
 *
 * Works with both MockedToolRunner and real ToolRunner, enabling tool call
 * tracking regardless of whether tools are mocked or live.
 */

import type {
  ToolExecutor,
  ToolRequest,
  ToolResult,
  LLMTool,
} from '../tools/types.js';

export interface RecordedToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  timestamp: Date;
  order: number;
  /** The actual result from the tool execution (useful for capture mode) */
  result?: ToolResult;
}

export class RecordingToolExecutor implements ToolExecutor {
  private delegate: ToolExecutor;
  private recordedCalls: RecordedToolCall[] = [];
  private callOrder = 0;

  constructor(delegate: ToolExecutor) {
    this.delegate = delegate;
  }

  getToolsForLLM(): LLMTool[] {
    return this.delegate.getToolsForLLM();
  }

  createRequest(
    toolUseId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    groupId?: string
  ): ToolRequest {
    return this.delegate.createRequest(toolUseId, toolName, parameters, groupId);
  }

  async executeTool(request: ToolRequest): Promise<ToolResult> {
    const timestamp = new Date();
    const result = await this.delegate.executeTool(request);

    this.recordedCalls.push({
      toolName: request.toolName,
      parameters: request.parameters,
      timestamp,
      order: this.callOrder++,
      result,
    });

    return result;
  }

  async executeTools(requests: ToolRequest[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const request of requests) {
      results.push(await this.executeTool(request));
    }
    return results;
  }

  /** Get all recorded tool calls */
  getRecordedCalls(): RecordedToolCall[] {
    return [...this.recordedCalls];
  }

  /** Clear recorded calls */
  clearRecordedCalls(): void {
    this.recordedCalls = [];
    this.callOrder = 0;
  }

  /** Check if a specific tool was called */
  wasToolCalled(toolName: string): boolean {
    return this.recordedCalls.some(c => c.toolName === toolName);
  }

  /** Get calls for a specific tool */
  getCallsForTool(toolName: string): RecordedToolCall[] {
    return this.recordedCalls.filter(c => c.toolName === toolName);
  }

  /** Get the number of times a tool was called */
  getToolCallCount(toolName: string): number {
    return this.getCallsForTool(toolName).length;
  }
}
