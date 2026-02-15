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

    it('swallows errors thrown by event listeners', async () => {
      const mockTool: NativeTool = {
        name: 'test_listener_error',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      };
      runner.registerNativeTool(mockTool);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      runner.onToolEvent(() => { throw new Error('listener boom'); });

      // Should not throw despite listener error
      const result = await runner.executeTool({
        id: 'id-err',
        toolName: 'test_listener_error',
        source: 'native',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        '[ToolRunner] Event listener error:',
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });

  describe('getToolsForLLM', () => {
    it('returns empty array when no tools registered', () => {
      expect(runner.getToolsForLLM()).toEqual([]);
    });

    it('includes native and user tools with correct names', () => {
      runner.registerNativeTool({
        name: 'web_search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        execute: vi.fn(),
      });
      runner.registerUserTool({
        name: 'custom_fetch',
        description: 'Custom fetch',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn(),
      });

      const tools = runner.getToolsForLLM();
      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        name: 'web_search',
        description: 'Search the web',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      });
      expect(tools[1]).toEqual({
        name: 'user.custom_fetch',
        description: 'Custom fetch',
        input_schema: { type: 'object', properties: {} },
      });
    });

    it('includes MCP tools when mcpClient is configured', () => {
      const mockMcpClient = {
        getToolsForLLM: vi.fn().mockReturnValue([
          { name: 'mcp.github__create_issue', description: 'Create issue', input_schema: { type: 'object' } },
        ]),
      };

      const runnerWithMcp = new ToolRunner({ mcpClient: mockMcpClient as any });
      const tools = runnerWithMcp.getToolsForLLM();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('mcp.github__create_issue');
    });
  });

  describe('getToolDefinitions', () => {
    it('returns definitions with source metadata', () => {
      runner.registerNativeTool({
        name: 'search',
        description: 'Search',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
      });
      runner.registerUserTool({
        name: 'my_tool',
        description: 'My tool',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
      });

      const defs = runner.getToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]).toEqual(expect.objectContaining({
        name: 'search',
        source: 'native',
      }));
      expect(defs[1]).toEqual(expect.objectContaining({
        name: 'user.my_tool',
        source: 'user',
      }));
    });

    it('parses MCP tool serverId from name', () => {
      const mockMcpClient = {
        getToolsForLLM: vi.fn().mockReturnValue([
          { name: 'mcp.github__create_issue', description: 'Create issue', input_schema: { type: 'object' } },
        ]),
      };

      const runnerWithMcp = new ToolRunner({ mcpClient: mockMcpClient as any });
      const defs = runnerWithMcp.getToolDefinitions();

      expect(defs[0]).toEqual(expect.objectContaining({
        name: 'mcp.github__create_issue',
        source: 'mcp',
        serverId: 'github',
      }));
    });
  });

  describe('executeTools', () => {
    it('returns empty array for empty requests', async () => {
      const results = await runner.executeTools([]);
      expect(results).toEqual([]);
    });

    it('executes sequential requests in order', async () => {
      const executionOrder: string[] = [];
      const makeTool = (name: string): NativeTool => ({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockImplementation(async () => {
          executionOrder.push(name);
          return { success: true, output: name };
        }),
      });

      runner.registerNativeTool(makeTool('tool_a'));
      runner.registerNativeTool(makeTool('tool_b'));

      const results = await runner.executeTools([
        { id: 'req-1', toolName: 'tool_a', source: 'native', parameters: {} },
        { id: 'req-2', toolName: 'tool_b', source: 'native', parameters: {} },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].output).toBe('tool_a');
      expect(results[1].output).toBe('tool_b');
      expect(executionOrder).toEqual(['tool_a', 'tool_b']);
    });

    it('executes requests with same groupId in parallel', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const makeSlowTool = (name: string): NativeTool => ({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockImplementation(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrentCount--;
          return { success: true, output: name };
        }),
      });

      runner.registerNativeTool(makeSlowTool('parallel_a'));
      runner.registerNativeTool(makeSlowTool('parallel_b'));

      const results = await runner.executeTools([
        { id: 'p-1', toolName: 'parallel_a', source: 'native', parameters: {}, groupId: 'group1' },
        { id: 'p-2', toolName: 'parallel_b', source: 'native', parameters: {}, groupId: 'group1' },
      ]);

      expect(results).toHaveLength(2);
      expect(maxConcurrent).toBe(2); // Both ran concurrently
    });
  });

  describe('isPrivateTool', () => {
    it('returns true for private tools', () => {
      runner.registerNativeTool({
        name: 'delegate',
        description: 'Delegate to agent',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
        private: true,
      });

      expect(runner.isPrivateTool('delegate')).toBe(true);
    });

    it('returns false for non-private tools', () => {
      runner.registerNativeTool({
        name: 'web_search',
        description: 'Search',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
      });

      expect(runner.isPrivateTool('web_search')).toBe(false);
    });

    it('returns false for unknown tools', () => {
      expect(runner.isPrivateTool('nonexistent')).toBe(false);
    });
  });

  describe('getPrivateToolNames', () => {
    it('returns only private tool names', () => {
      runner.registerNativeTool({
        name: 'delegate',
        description: 'Delegate',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
        private: true,
      });
      runner.registerNativeTool({
        name: 'remember',
        description: 'Remember',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
        private: true,
      });
      runner.registerNativeTool({
        name: 'web_search',
        description: 'Search',
        inputSchema: { type: 'object' },
        execute: vi.fn(),
      });

      const privateNames = runner.getPrivateToolNames();
      expect(privateNames).toContain('delegate');
      expect(privateNames).toContain('remember');
      expect(privateNames).not.toContain('web_search');
      expect(privateNames).toHaveLength(2);
    });
  });

  describe('createRequest', () => {
    it('creates request for native tool', () => {
      const request = runner.createRequest('tu-1', 'web_search', { query: 'test' });
      expect(request).toEqual({
        id: 'tu-1',
        toolName: 'web_search',
        source: 'native',
        parameters: { query: 'test' },
        groupId: undefined,
        callerId: undefined,
        traceId: undefined,
        spanId: undefined,
      });
    });

    it('creates request for user tool with correct source', () => {
      const request = runner.createRequest('tu-2', 'user.my_tool', { input: 'data' });
      expect(request.source).toBe('user');
      expect(request.toolName).toBe('user.my_tool');
    });

    it('creates request for MCP tool with correct source', () => {
      const request = runner.createRequest('tu-3', 'mcp.github__create_issue', { title: 'Bug' });
      expect(request.source).toBe('mcp');
    });

    it('includes optional groupId, callerId, and traceContext', () => {
      const request = runner.createRequest(
        'tu-4', 'web_search', {},
        'group-1', 'agent-1',
        { traceId: 'trace-123', spanId: 'span-456' }
      );
      expect(request.groupId).toBe('group-1');
      expect(request.callerId).toBe('agent-1');
      expect(request.traceId).toBe('trace-123');
      expect(request.spanId).toBe('span-456');
    });
  });

  describe('executeTool - user tool routing', () => {
    it('executes a user tool via user source', async () => {
      runner.registerUserTool({
        name: 'my_user_tool',
        description: 'User tool',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({ success: true, output: 'user result' }),
      });

      const result = await runner.executeTool({
        id: 'u-1',
        toolName: 'user.my_user_tool',
        source: 'user',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('user result');
    });

    it('fails when user tool not found', async () => {
      const result = await runner.executeTool({
        id: 'u-miss',
        toolName: 'user.nonexistent',
        source: 'user',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('User tool not found');
    });
  });

  describe('executeTool - MCP tool routing', () => {
    it('fails when MCP client not configured', async () => {
      const result = await runner.executeTool({
        id: 'mcp-1',
        toolName: 'mcp.server__tool',
        source: 'mcp',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('MCP client not configured');
    });

    it('routes to MCP client with parsed serverId and toolName', async () => {
      const mockInvokeTool = vi.fn().mockResolvedValue({ success: true, output: 'mcp result' });
      const mockMcpClient = {
        getToolsForLLM: vi.fn().mockReturnValue([]),
        invokeTool: mockInvokeTool,
      };

      const runnerWithMcp = new ToolRunner({ mcpClient: mockMcpClient as any });
      const result = await runnerWithMcp.executeTool({
        id: 'mcp-2',
        toolName: 'mcp.github__create_issue',
        source: 'mcp',
        parameters: { title: 'Bug report' },
      });

      expect(result.success).toBe(true);
      expect(mockInvokeTool).toHaveBeenCalledWith({
        serverId: 'github',
        toolName: 'create_issue',
        input: { title: 'Bug report' },
      });
    });
  });

  describe('executeTool - unknown source', () => {
    it('fails for unknown tool source', async () => {
      const result = await runner.executeTool({
        id: 'unk-1',
        toolName: 'unknown_tool',
        source: 'unknown' as any,
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool source');
    });
  });

  describe('executeTool - native tool not found', () => {
    it('fails when native tool is not registered', async () => {
      const result = await runner.executeTool({
        id: 'miss-1',
        toolName: 'nonexistent',
        source: 'native',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Native tool not found');
    });
  });
});
