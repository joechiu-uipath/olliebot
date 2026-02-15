/**
 * Test Fixtures for ToolRunner Tests
 *
 * Shared mock objects and factory functions to reduce duplication
 * and improve test maintainability.
 */

import { vi } from 'vitest';
import type { NativeTool } from '../native/types.js';
import type { ToolExecutionContext } from '../types.js';

/**
 * Create a mock NativeTool with sensible defaults.
 * Override any property using the overrides parameter.
 */
export function createMockTool(
  name: string,
  executeResult: any = { success: true, output: 'ok' },
  options?: Partial<NativeTool>
): NativeTool {
  return {
    name,
    description: options?.description || `Mock tool: ${name}`,
    inputSchema: options?.inputSchema || { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(executeResult),
    private: options?.private,
    ...options,
  };
}

/**
 * Create a mock tool that simulates async execution with delay.
 */
export function createSlowMockTool(
  name: string,
  delayMs: number,
  result: any = { success: true, output: name }
): NativeTool {
  return {
    name,
    description: `Slow mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return result;
    }),
  };
}

/**
 * Create a mock tool that throws an error.
 */
export function createFailingMockTool(
  name: string,
  error: string | Error = 'Mock error'
): NativeTool {
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  return {
    name,
    description: `Failing mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockRejectedValue(errorObj),
  };
}

/**
 * Create a mock tool that returns an error result (not thrown).
 */
export function createErrorResultMockTool(
  name: string,
  errorMessage: string
): NativeTool {
  return {
    name,
    description: `Error result mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: errorMessage,
    }),
  };
}

/**
 * Create a mock tool that returns files in the result.
 */
export function createFileReturningMockTool(
  name: string,
  files: Array<{ name: string; dataUrl: string; size: number; mediaType: string }>
): NativeTool {
  return {
    name,
    description: `File-returning mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: { message: 'Files generated' },
      files,
    }),
  };
}

/**
 * Create a mock tool with displayOnly and displayOnlySummary.
 */
export function createDisplayOnlyMockTool(
  name: string,
  output: any,
  displayOnlySummary: string
): NativeTool {
  return {
    name,
    description: `Display-only mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue({
      success: true,
      output,
      displayOnly: true,
      displayOnlySummary,
    }),
  };
}

/**
 * Create a mock MCP client for testing.
 */
export function createMockMcpClient(
  tools: Array<{ name: string; description: string; input_schema: any }> = []
) {
  return {
    getToolsForLLM: vi.fn().mockReturnValue(tools),
    invokeTool: vi.fn().mockResolvedValue({ success: true, output: 'mcp result' }),
  };
}

/**
 * Create a mock tool execution context.
 */
export function createMockContext(): ToolExecutionContext {
  return {
    conversationId: 'test-conv-123',
    agentId: 'test-agent-1',
    agentName: 'Test Agent',
    agentEmoji: '🧪',
    workingDirectory: '/test/workspace',
  };
}
