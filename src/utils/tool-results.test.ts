/**
 * Unit tests for tool-results formatting utility
 *
 * Tests the formatToolResultBlocks function that converts ToolResult objects
 * into LLM-compatible content blocks.
 */

import { describe, it, expect } from 'vitest';
import { formatToolResultBlocks } from './tool-results.js';
import { buildToolResult } from '../test-helpers/index.js';
import type { ToolResult } from '../tools/types.js';

describe('formatToolResultBlocks', () => {
  it('formats a successful tool result', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-1',
        toolName: 'web_search',
        success: true,
        output: { query: 'test', results: [] },
      }),
    ];

    const blocks = formatToolResultBlocks(results);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'req-1',
      is_error: false,
    });
    expect(blocks[0].content).toContain('"query"');
  });

  it('formats a failed tool result with error message', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-2',
        toolName: 'bad_tool',
        success: false,
        error: 'Tool not found',
      }),
    ];

    const blocks = formatToolResultBlocks(results);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'req-2',
      content: 'Error: Tool not found',
      is_error: true,
    });
  });

  it('formats a failed tool result with default error message', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-3',
        toolName: 'broken_tool',
        success: false,
      }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks[0].content).toBe('Error: Unknown error');
  });

  it('formats display-only results with minimal content', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-4',
        toolName: 'create_image',
        success: true,
        output: { dataUrl: 'data:image/png;base64,...huge...' },
        displayOnly: true,
      }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks[0].content).toBe('[Tool output displayed to user]');
  });

  it('formats display-only results with custom summary', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-5',
        toolName: 'create_image',
        success: true,
        output: { dataUrl: 'data:image/png;base64,...' },
        displayOnly: true,
        displayOnlySummary: 'Generated a 512x512 image of a cat',
      }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks[0].content).toBe('Generated a 512x512 image of a cat');
  });

  it('strips binary data from non-display-only results', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-6',
        toolName: 'screenshot',
        success: true,
        output: { screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...' },
      }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks[0].content).toContain('[Image data:');
    expect(blocks[0].content).not.toContain('iVBORw0KGgo');
  });

  it('handles string output directly', () => {
    const results: ToolResult[] = [
      buildToolResult({
        requestId: 'req-7',
        toolName: 'simple_tool',
        success: true,
        output: 'Simple string result',
      }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks[0].content).toBe('Simple string result');
  });

  it('handles multiple results', () => {
    const results: ToolResult[] = [
      buildToolResult({ requestId: 'req-a', toolName: 'tool_a', success: true, output: 'Result A' }),
      buildToolResult({ requestId: 'req-b', toolName: 'tool_b', success: true, output: 'Result B' }),
      buildToolResult({ requestId: 'req-c', toolName: 'tool_c', success: false, error: 'Failed' }),
    ];

    const blocks = formatToolResultBlocks(results);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].tool_use_id).toBe('req-a');
    expect(blocks[1].tool_use_id).toBe('req-b');
    expect(blocks[2].is_error).toBe(true);
  });
});
