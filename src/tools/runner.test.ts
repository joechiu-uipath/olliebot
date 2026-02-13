/**
 * ToolRunner unit tests
 *
 * Tests the tool execution pipeline, ensuring data flows correctly
 * from tool execution through to results and events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRunner } from './runner.js';
import type { NativeTool } from './native/types.js';
import type { ToolEvent } from './types.js';

describe('ToolRunner', () => {
  let runner: ToolRunner;

  beforeEach(() => {
    runner = new ToolRunner();
  });

  describe('executeTool', () => {
    it('executes a native tool and returns result', async () => {
      const mockTool: NativeTool = {
        name: 'mock_tool',
        description: 'A mock tool',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: { message: 'done' },
        }),
      };
      runner.registerNativeTool(mockTool);

      const result = await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_tool',
        source: 'native',
        parameters: { foo: 'bar' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ message: 'done' });
      expect(result.toolName).toBe('mock_tool');
      expect(mockTool.execute).toHaveBeenCalledWith(
        { foo: 'bar' },
        expect.any(Object)
      );
    });

    it('propagates files from native tool result to ToolResult and event', async () => {
      const mockFiles = [
        {
          name: 'screenshot.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          size: 1024,
          mediaType: 'image/png',
        },
      ];

      const mockTool: NativeTool = {
        name: 'mock_screenshot',
        description: 'Mock tool that returns files',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: { format: 'png', capturedAt: '2024-01-01T00:00:00Z' },
          files: mockFiles,
        }),
      };
      runner.registerNativeTool(mockTool);

      // Capture emitted events
      const events: ToolEvent[] = [];
      runner.onToolEvent((e) => events.push(e));

      const result = await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_screenshot',
        source: 'native',
        parameters: {},
      });

      // Assert files propagated to result
      expect(result.files).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(result.files![0].name).toBe('screenshot.png');
      expect(result.files![0].dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(result.files![0].size).toBe(1024);
      expect(result.files![0].mediaType).toBe('image/png');

      // Assert files propagated to event
      const finishedEvent = events.find(
        (e) => e.type === 'tool_execution_finished'
      );
      expect(finishedEvent).toBeDefined();
      expect(finishedEvent?.type).toBe('tool_execution_finished');
      if (finishedEvent?.type === 'tool_execution_finished') {
        expect(finishedEvent.files).toBeDefined();
        expect(finishedEvent.files).toHaveLength(1);
        expect(finishedEvent.files![0].name).toBe('screenshot.png');
      }
    });

    it('propagates displayOnly and displayOnlySummary from tool result', async () => {
      const mockTool: NativeTool = {
        name: 'mock_display_only',
        description: 'Mock tool with display-only output',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: { urls: ['http://a.com', 'http://b.com', 'http://c.com'] },
          displayOnly: true,
          displayOnlySummary: 'Found 3 URLs',
        }),
      };
      runner.registerNativeTool(mockTool);

      const result = await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_display_only',
        source: 'native',
        parameters: {},
      });

      expect(result.displayOnly).toBe(true);
      expect(result.displayOnlySummary).toBe('Found 3 URLs');
    });

    it('handles tool execution failure', async () => {
      const mockTool: NativeTool = {
        name: 'mock_failing',
        description: 'Mock tool that fails',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({
          success: false,
          error: 'Something went wrong',
        }),
      };
      runner.registerNativeTool(mockTool);

      const result = await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_failing',
        source: 'native',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Something went wrong');
    });

    it('handles tool execution exception', async () => {
      const mockTool: NativeTool = {
        name: 'mock_throwing',
        description: 'Mock tool that throws',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockRejectedValue(new Error('Unexpected error')),
      };
      runner.registerNativeTool(mockTool);

      const result = await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_throwing',
        source: 'native',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected error');
    });

    it('emits tool_requested and tool_execution_finished events', async () => {
      const mockTool: NativeTool = {
        name: 'mock_events',
        description: 'Mock tool for event testing',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: 'done',
        }),
      };
      runner.registerNativeTool(mockTool);

      const events: ToolEvent[] = [];
      runner.onToolEvent((e) => events.push(e));

      await runner.executeTool({
        id: 'test-id',
        toolName: 'mock_events',
        source: 'native',
        parameters: { input: 'value' },
      });

      expect(events).toHaveLength(2);

      const requestedEvent = events.find((e) => e.type === 'tool_requested');
      expect(requestedEvent).toBeDefined();
      expect(requestedEvent?.toolName).toBe('mock_events');
      expect(requestedEvent?.requestId).toBe('test-id');

      const finishedEvent = events.find(
        (e) => e.type === 'tool_execution_finished'
      );
      expect(finishedEvent).toBeDefined();
      expect(finishedEvent?.toolName).toBe('mock_events');
      expect(finishedEvent?.requestId).toBe('test-id');
      if (finishedEvent?.type === 'tool_execution_finished') {
        expect(finishedEvent.success).toBe(true);
        expect(finishedEvent.result).toBe('done');
      }
    });
  });

  describe('registerNativeTool', () => {
    it('registers a native tool', () => {
      const mockTool: NativeTool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn(),
      };

      runner.registerNativeTool(mockTool);

      const tools = runner.getToolsForLLM();
      expect(tools.some((t) => t.name === 'test_tool')).toBe(true);
    });
  });

  describe('registerUserTool', () => {
    it('registers a user tool with user. prefix', () => {
      const mockTool: NativeTool = {
        name: 'my_tool',
        description: 'User tool',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn(),
      };

      runner.registerUserTool(mockTool);

      const tools = runner.getToolsForLLM();
      expect(tools.some((t) => t.name === 'user.my_tool')).toBe(true);
    });

    it('rejects user tool that conflicts with native tool', () => {
      const nativeTool: NativeTool = {
        name: 'shared_name',
        description: 'Native tool',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn(),
      };
      const userTool: NativeTool = {
        name: 'shared_name',
        description: 'User tool with same name',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn(),
      };

      runner.registerNativeTool(nativeTool);
      runner.registerUserTool(userTool);

      // Native tool should still be there, user tool should be rejected
      const tools = runner.getToolsForLLM();
      const matchingTools = tools.filter(
        (t) => t.name === 'shared_name' || t.name === 'user.shared_name'
      );
      expect(matchingTools).toHaveLength(1);
      expect(matchingTools[0].name).toBe('shared_name');
    });
  });

  describe('parseToolName', () => {
    it('parses native tool names (no prefix)', () => {
      const result = runner.parseToolName('web_search');
      expect(result.source).toBe('native');
      expect(result.name).toBe('web_search');
    });

    it('parses user tool names (user. prefix)', () => {
      const result = runner.parseToolName('user.my_custom_tool');
      expect(result.source).toBe('user');
      expect(result.name).toBe('my_custom_tool');
    });

    it('parses MCP tool names (mcp. prefix)', () => {
      const result = runner.parseToolName('mcp.github__create_issue');
      expect(result.source).toBe('mcp');
      expect(result.name).toBe('mcp.github__create_issue');
    });
  });

  describe('onToolEvent', () => {
    it('returns unsubscribe function', async () => {
      const mockTool: NativeTool = {
        name: 'test_unsub',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };
      runner.registerNativeTool(mockTool);

      const events: ToolEvent[] = [];
      const unsubscribe = runner.onToolEvent((e) => events.push(e));

      // First call - should capture events
      await runner.executeTool({
        id: 'id-1',
        toolName: 'test_unsub',
        source: 'native',
        parameters: {},
      });
      expect(events.length).toBeGreaterThan(0);

      const countBefore = events.length;
      unsubscribe();

      // Second call - should NOT capture events (unsubscribed)
      await runner.executeTool({
        id: 'id-2',
        toolName: 'test_unsub',
        source: 'native',
        parameters: {},
      });
      expect(events.length).toBe(countBefore);
    });
  });
});
