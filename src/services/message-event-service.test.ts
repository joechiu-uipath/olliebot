/**
 * Unit Tests for MessageEventService
 *
 * Tests that the service properly broadcasts events to clients
 * AND persists them to the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageEventService } from './message-event-service.js';
import type { ToolEvent } from '../tools/types.js';
import {
  STANDARD_AGENT_INFO,
  createBaseToolEvent,
  createAudioToolEvent,
  createNestedAudioToolEvent,
  createLargeResultToolEvent,
  createMediaToolEvent,
  createProgressToolEvent,
  STANDARD_DELEGATION_DATA,
  STANDARD_TASK_DATA,
  STANDARD_ERROR_DATA,
  TEST_CONSTANTS,
} from './__tests__/fixtures.js';

// Create mock DB that persists across calls
const mockMessagesCreate = vi.fn();
const mockMessagesFindById = vi.fn().mockReturnValue(null);

// Mock the database module
vi.mock('../db/index.js', () => ({
  getDb: () => ({
    messages: {
      findById: mockMessagesFindById,
      create: mockMessagesCreate,
    },
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

describe('MessageEventService', () => {
  let service: MessageEventService;
  let mockBroadcast: ReturnType<typeof vi.fn>;
  let mockChannel: { broadcast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBroadcast = vi.fn();
    mockChannel = { broadcast: mockBroadcast };

    service = new MessageEventService(mockChannel as any);
  });

  describe('emitToolEvent', () => {
    it('broadcasts tool event to clients', () => {
      const baseEvent = createBaseToolEvent();
      service.emitToolEvent(baseEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_execution_finished',
          toolName: 'web_search',
          agentId: 'agent-1',
          agentName: 'Researcher',
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
        })
      );
    });

    it('persists tool_execution_finished events to database', () => {
      const baseEvent = createBaseToolEvent();
      service.emitToolEvent(baseEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tool-req-123',
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
          role: 'tool',
          metadata: expect.objectContaining({
            type: 'tool_event',
            toolName: 'web_search',
            success: true,
            agentId: 'agent-1',
          }),
        })
      );
    });

    it('does NOT persist non-finished events (e.g., tool_requested)', () => {
      const startEvent = createBaseToolEvent({ type: 'tool_requested' });

      service.emitToolEvent(startEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      expect(mockBroadcast).toHaveBeenCalledTimes(1); // Still broadcasts
      expect(mockMessagesCreate).not.toHaveBeenCalled(); // But doesn't persist
    });

    it('logs error when conversationId is null for finished events', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const baseEvent = createBaseToolEvent();

      service.emitToolEvent(baseEvent, null, STANDARD_AGENT_INFO);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save tool event: conversationId is null')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('skips duplicate events (already exists in DB)', () => {
      mockMessagesFindById.mockReturnValueOnce({ id: 'tool-req-123' });
      const baseEvent = createBaseToolEvent();

      service.emitToolEvent(baseEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('broadcasts play_audio event when result contains audio', () => {
      const audioEvent = createAudioToolEvent();

      service.emitToolEvent(audioEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      // Should broadcast play_audio first, then the tool event
      expect(mockBroadcast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast).toHaveBeenNthCalledWith(1, expect.objectContaining({
        type: 'play_audio',
        audio: 'base64audiodata',
        mimeType: 'audio/wav',
      }));
    });

    it('truncates large non-media results for broadcast', () => {
      const largeEvent = createLargeResultToolEvent();

      service.emitToolEvent(largeEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      expect(broadcastCall.result).toContain('...(truncated)');
      expect(broadcastCall.result.length).toBeLessThan(TEST_CONSTANTS.TRUNCATION_LIMIT_CHARS);
    });

    it('preserves media content without truncation', () => {
      const mediaEvent = createMediaToolEvent();

      service.emitToolEvent(mediaEvent, TEST_CONSTANTS.CONVERSATION_ID, STANDARD_AGENT_INFO);

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      // Media content should be passed as object, not truncated string
      expect(broadcastCall.result).toEqual(mediaEvent.result);
    });
  });

  describe('emitDelegationEvent', () => {
    it('broadcasts delegation event to clients', () => {
      service.emitDelegationEvent(STANDARD_DELEGATION_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delegation',
          agentId: 'researcher-abc',
          agentName: 'Researcher',
          mission: 'Research quantum computing',
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
        })
      );
    });

    it('persists delegation event to database', () => {
      service.emitDelegationEvent(STANDARD_DELEGATION_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'delegation-researcher-abc',
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
          role: 'system',
          metadata: expect.objectContaining({
            type: 'delegation',
            agentId: 'researcher-abc',
            mission: 'Research quantum computing',
          }),
        })
      );
    });

    it('logs error when conversationId is null', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.emitDelegationEvent(STANDARD_DELEGATION_DATA, null);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save delegation event: conversationId is null')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('emitTaskRunEvent', () => {
    it('broadcasts task_run event and returns Message object for handleMessage', () => {
      const message = service.emitTaskRunEvent(STANDARD_TASK_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      expect(message.id).toBe('task-run-task-456');
      expect(message.role).toBe('system');
      expect(message.content).toBe(STANDARD_TASK_DATA.content);
      expect(message.metadata?.taskId).toBe('task-456');
      expect(message.metadata?.turnId).toBe('task-run-task-456');
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_run',
          taskId: 'task-456',
          taskName: 'Daily Briefing',
          turnId: 'task-run-task-456',
        })
      );
    });

    it('does NOT persist (persistence handled by saveMessageInternal via handleMessage)', () => {
      service.emitTaskRunEvent(STANDARD_TASK_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      // Unlike delegation/tool/error events which are notifications,
      // task_run messages go through handleMessage() which persists via saveMessageInternal()
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('returns Message even when conversationId is null', () => {
      const message = service.emitTaskRunEvent(STANDARD_TASK_DATA, null);

      expect(message.id).toBe('task-run-task-456');
      expect(message.role).toBe('system');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('emitErrorEvent', () => {
    it('broadcasts error event to clients', () => {
      service.emitErrorEvent(STANDARD_ERROR_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'API rate limit exceeded',
          details: 'Too many requests in the last minute',
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
        })
      );
    });

    it('persists error event to database', () => {
      service.emitErrorEvent(STANDARD_ERROR_DATA, TEST_CONSTANTS.CONVERSATION_ID);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: TEST_CONSTANTS.CONVERSATION_ID,
          role: 'system',
          metadata: expect.objectContaining({
            type: 'error',
            error: 'API rate limit exceeded',
          }),
        })
      );
    });
  });

  describe('setChannel', () => {
    it('allows setting channel after construction', () => {
      const serviceWithoutChannel = new MessageEventService();
      const newChannel = { broadcast: vi.fn() };

      serviceWithoutChannel.setChannel(newChannel as any);

      const event: ToolEvent = {
        type: 'tool_requested',
        toolName: 'test',
        source: 'native',
        requestId: 'req-1',
        timestamp: new Date(),
        parameters: {},
      };

      serviceWithoutChannel.emitToolEvent(event, 'conv-1', {
        id: 'a1',
        name: 'Agent',
        emoji: '🤖',
      });

      expect(newChannel.broadcast).toHaveBeenCalled();
    });
  });

  describe('emitToolEvent - progress events', () => {
    const agentInfo = {
      id: 'agent-1',
      name: 'Worker',
      emoji: '🔧',
      type: 'coder' as const,
    };

    it('broadcasts progress events and does NOT persist them', () => {
      const progressEvent = createProgressToolEvent();

      service.emitToolEvent(progressEvent, TEST_CONSTANTS.CONVERSATION_ID, agentInfo, TEST_CONSTANTS.TURN_ID);

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_progress',
          requestId: 'req-progress',
          toolName: 'long_running_task',
          progress: { current: 3, total: 10, message: 'Processing step 3 of 10' },
          agentId: 'agent-1',
          turnId: TEST_CONSTANTS.TURN_ID,
        })
      );
      // Progress events should NOT be persisted
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('emitToolEvent - no channel', () => {
    it('still persists events when no channel is configured', () => {
      const serviceNoChannel = new MessageEventService();

      const event = createBaseToolEvent({
        requestId: 'req-no-chan',
        parameters: {},
        result: { data: 'result' },
      });

      serviceNoChannel.emitToolEvent(event, TEST_CONSTANTS.CONVERSATION_ID, {
        id: 'a-1',
        name: 'Agent',
        emoji: '🤖',
      });

      // Should still persist to DB even without a channel
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitToolEvent - nested audio detection', () => {
    const agentInfo = {
      id: 'agent-1',
      name: 'Speaker',
      emoji: '🔊',
    };

    it('detects audio in nested output object', () => {
      const nestedAudioEvent = createNestedAudioToolEvent();

      service.emitToolEvent(nestedAudioEvent, TEST_CONSTANTS.CONVERSATION_ID, agentInfo);

      // Should emit play_audio from nested result
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'play_audio',
          audio: 'base64nestedaudiodata',
          mimeType: 'audio/mp3',
          voice: 'shimmer',
        })
      );
    });
  });

  describe('emitDelegationEvent - duplicate suppression', () => {
    it('skips persistence for duplicate delegation events', () => {
      const data = {
        agentId: 'dup-agent',
        agentName: 'Duplicate',
        agentEmoji: '🔁',
        agentType: 'researcher',
        mission: 'Test duplicates',
      };

      // First call: created
      mockMessagesFindById.mockReturnValueOnce(null);
      service.emitDelegationEvent(data, TEST_CONSTANTS.CONVERSATION_ID);
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

      // Second call: already exists
      mockMessagesFindById.mockReturnValueOnce({ id: 'delegation-dup-agent' });
      service.emitDelegationEvent(data, TEST_CONSTANTS.CONVERSATION_ID);
      // Should NOT have been called again
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitErrorEvent - null conversationId', () => {
    it('logs error and skips persistence when conversationId is null', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.emitErrorEvent(STANDARD_ERROR_DATA, null);

      expect(mockBroadcast).toHaveBeenCalledTimes(1); // Still broadcasts
      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save error event: conversationId is null')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('emitTaskRunEvent - with allowedTools', () => {
    it('includes allowedTools in message metadata', () => {
      const taskData = {
        taskId: 'task-tools',
        taskName: 'Restricted Task',
        taskDescription: 'Task with limited tools',
        content: 'Execute the task',
        allowedTools: ['web_search', 'read_file'],
      };

      const message = service.emitTaskRunEvent(taskData, 'conv-123');

      expect(message.metadata?.allowedTools).toEqual(['web_search', 'read_file']);
    });
  });
});
