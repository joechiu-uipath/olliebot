/**
 * Test Fixtures for MessageEventService Tests
 *
 * Common event data patterns to reduce duplication.
 */

import type { ToolEvent } from '../../tools/types.js';

/**
 * Standard agent info for testing.
 */
export const STANDARD_AGENT_INFO = {
  id: 'agent-1',
  name: 'Researcher',
  emoji: '🔬',
  type: 'researcher' as const,
};

/**
 * Create a base tool event with common fields.
 */
export function createBaseToolEvent(
  overrides?: Partial<ToolEvent>
): ToolEvent {
  return {
    type: 'tool_execution_finished',
    toolName: 'web_search',
    source: 'native' as const,
    requestId: 'req-123',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    startTime: new Date('2024-01-15T09:59:58Z'),
    endTime: new Date('2024-01-15T10:00:00Z'),
    success: true,
    durationMs: 2000,
    parameters: { query: 'test query' },
    result: { results: ['result1', 'result2'] },
    ...overrides,
  };
}

/**
 * Create a tool event with audio result.
 */
export function createAudioToolEvent(): ToolEvent {
  return createBaseToolEvent({
    result: {
      audio: 'base64audiodata',
      mimeType: 'audio/wav',
      voice: 'alloy',
    },
  });
}

/**
 * Create a tool event with nested audio in output.
 */
export function createNestedAudioToolEvent(): ToolEvent {
  return createBaseToolEvent({
    toolName: 'text_to_speech',
    requestId: 'req-nested-audio',
    durationMs: 500,
    result: {
      output: {
        audio: 'base64nestedaudiodata',
        mimeType: 'audio/mp3',
        voice: 'shimmer',
        model: 'tts-1',
      },
    },
  });
}

/**
 * Create a tool event with large result (for truncation testing).
 */
export function createLargeResultToolEvent(): ToolEvent {
  return createBaseToolEvent({
    result: { data: 'x'.repeat(20000) },
  });
}

/**
 * Create a tool event with media content.
 */
export function createMediaToolEvent(): ToolEvent {
  return createBaseToolEvent({
    result: {
      imageUrl: 'data:image/png;base64,' + 'x'.repeat(20000),
    },
  });
}

/**
 * Create a progress event.
 */
export function createProgressToolEvent(): ToolEvent {
  return {
    type: 'tool_progress',
    toolName: 'long_running_task',
    source: 'native',
    requestId: 'req-progress',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    progress: {
      current: 3,
      total: 10,
      message: 'Processing step 3 of 10',
    },
  };
}

/**
 * Standard delegation data.
 */
export const STANDARD_DELEGATION_DATA = {
  agentId: 'researcher-abc',
  agentName: 'Researcher',
  agentEmoji: '🔬',
  agentType: 'researcher',
  parentAgentId: 'supervisor-main',
  parentAgentName: 'Ollie',
  mission: 'Research quantum computing',
  rationale: 'User asked about quantum topics',
};

/**
 * Standard task data.
 */
export const STANDARD_TASK_DATA = {
  taskId: 'task-456',
  taskName: 'Daily Briefing',
  taskDescription: 'Generate morning briefing',
  content: '[Scheduled Task] Execute the "Daily Briefing" task now.',
};

/**
 * Standard error data.
 */
export const STANDARD_ERROR_DATA = {
  error: 'API rate limit exceeded',
  details: 'Too many requests in the last minute',
};

/**
 * Test constants.
 */
export const TEST_CONSTANTS = {
  CONVERSATION_ID: 'conv-123',
  TURN_ID: 'turn-1',
  LARGE_RESULT_CHARS: 20000,
  TRUNCATION_LIMIT_CHARS: 15000,
};
