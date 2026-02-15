/**
 * Unit Tests for MessageEventService
 *
 * Tests that the service properly broadcasts events to clients
 * AND persists them to the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageEventService } from './message-event-service.js';
import type { ToolEvent } from '../tools/types.js';

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
    const baseEvent: ToolEvent = {
      type: 'tool_execution_finished',
      toolName: 'web_search',
      source: 'native',
      requestId: 'req-123',
      timestamp: new Date('2024-01-15T10:00:00Z'),
      startTime: new Date('2024-01-15T09:59:58Z'),
      endTime: new Date('2024-01-15T10:00:00Z'),
      success: true,
      durationMs: 2000,
      parameters: { query: 'test query' },
      result: { results: ['result1', 'result2'] },
    };

    const agentInfo = {
      id: 'agent-1',
      name: 'Researcher',
      emoji: '🔬',
      type: 'researcher',
    };

    it('broadcasts tool event to clients', () => {
      service.emitToolEvent(baseEvent, 'conv-123', agentInfo);

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_execution_finished',
          toolName: 'web_search',
          agentId: 'agent-1',
          agentName: 'Researcher',
          conversationId: 'conv-123',
        })
      );
    });

    it('persists tool_execution_finished events to database', () => {
      service.emitToolEvent(baseEvent, 'conv-123', agentInfo);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tool-req-123',
          conversationId: 'conv-123',
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
      const startEvent: ToolEvent = {
        ...baseEvent,
        type: 'tool_requested',
      };

      service.emitToolEvent(startEvent, 'conv-123', agentInfo);

      expect(mockBroadcast).toHaveBeenCalledTimes(1); // Still broadcasts
      expect(mockMessagesCreate).not.toHaveBeenCalled(); // But doesn't persist
    });

    it('logs error when conversationId is null for finished events', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.emitToolEvent(baseEvent, null, agentInfo);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save tool event: conversationId is null')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('skips duplicate events (already exists in DB)', () => {
      mockMessagesFindById.mockReturnValueOnce({ id: 'tool-req-123' });

      service.emitToolEvent(baseEvent, 'conv-123', agentInfo);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('broadcasts play_audio event when result contains audio', () => {
      const audioEvent: ToolEvent = {
        ...baseEvent,
        result: {
          audio: 'base64audiodata',
          mimeType: 'audio/wav',
          voice: 'alloy',
        },
      };

      service.emitToolEvent(audioEvent, 'conv-123', agentInfo);

      // Should broadcast play_audio first, then the tool event
      expect(mockBroadcast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast).toHaveBeenNthCalledWith(1, expect.objectContaining({
        type: 'play_audio',
        audio: 'base64audiodata',
        mimeType: 'audio/wav',
      }));
    });

    it('truncates large non-media results for broadcast', () => {
      const largeResult = { data: 'x'.repeat(20000) };
      const largeEvent: ToolEvent = {
        ...baseEvent,
        result: largeResult,
      };

      service.emitToolEvent(largeEvent, 'conv-123', agentInfo);

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      expect(broadcastCall.result).toContain('...(truncated)');
      expect(broadcastCall.result.length).toBeLessThan(15000);
    });

    it('preserves media content without truncation', () => {
      const mediaResult = {
        imageUrl: 'data:image/png;base64,' + 'x'.repeat(20000)
      };
      const mediaEvent: ToolEvent = {
        ...baseEvent,
        result: mediaResult,
      };

      service.emitToolEvent(mediaEvent, 'conv-123', agentInfo);

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      // Media content should be passed as object, not truncated string
      expect(broadcastCall.result).toEqual(mediaResult);
    });
  });

  describe('emitDelegationEvent', () => {
    const delegationData = {
      agentId: 'researcher-abc',
      agentName: 'Researcher',
      agentEmoji: '🔬',
      agentType: 'researcher',
      parentAgentId: 'supervisor-main',
      parentAgentName: 'Ollie',
      mission: 'Research quantum computing',
      rationale: 'User asked about quantum topics',
    };

    it('broadcasts delegation event to clients', () => {
      service.emitDelegationEvent(delegationData, 'conv-123');

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delegation',
          agentId: 'researcher-abc',
          agentName: 'Researcher',
          mission: 'Research quantum computing',
          conversationId: 'conv-123',
        })
      );
    });

    it('persists delegation event to database', () => {
      service.emitDelegationEvent(delegationData, 'conv-123');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'delegation-researcher-abc',
          conversationId: 'conv-123',
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

      service.emitDelegationEvent(delegationData, null);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save delegation event: conversationId is null')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('emitTaskRunEvent', () => {
    const taskData = {
      taskId: 'task-456',
      taskName: 'Daily Briefing',
      taskDescription: 'Generate morning briefing',
      content: '[Scheduled Task] Execute the "Daily Briefing" task now.',
    };

    it('broadcasts task_run event and returns Message object for handleMessage', () => {
      const message = service.emitTaskRunEvent(taskData, 'conv-123');

      expect(message.id).toBe('task-run-task-456');
      expect(message.role).toBe('system');
      expect(message.content).toBe(taskData.content);
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
      service.emitTaskRunEvent(taskData, 'conv-123');

      // Unlike delegation/tool/error events which are notifications,
      // task_run messages go through handleMessage() which persists via saveMessageInternal()
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('returns Message even when conversationId is null', () => {
      const message = service.emitTaskRunEvent(taskData, null);

      expect(message.id).toBe('task-run-task-456');
      expect(message.role).toBe('system');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('emitErrorEvent', () => {
    const errorData = {
      error: 'API rate limit exceeded',
      details: 'Too many requests in the last minute',
    };

    it('broadcasts error event to clients', () => {
      service.emitErrorEvent(errorData, 'conv-123');

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'API rate limit exceeded',
          details: 'Too many requests in the last minute',
          conversationId: 'conv-123',
        })
      );
    });

    it('persists error event to database', () => {
      service.emitErrorEvent(errorData, 'conv-123');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-123',
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
      type: 'coder',
    };

    it('broadcasts progress events and does NOT persist them', () => {
      const progressEvent: ToolEvent = {
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

      service.emitToolEvent(progressEvent, 'conv-123', agentInfo, 'turn-1');

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_progress',
          requestId: 'req-progress',
          toolName: 'long_running_task',
          progress: { current: 3, total: 10, message: 'Processing step 3 of 10' },
          agentId: 'agent-1',
          turnId: 'turn-1',
        })
      );
      // Progress events should NOT be persisted
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('emitToolEvent - no channel', () => {
    it('still persists events when no channel is configured', () => {
      const serviceNoChannel = new MessageEventService();

      const event: ToolEvent = {
        type: 'tool_execution_finished',
        toolName: 'web_search',
        source: 'native',
        requestId: 'req-no-chan',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        startTime: new Date('2024-01-15T09:59:58Z'),
        endTime: new Date('2024-01-15T10:00:00Z'),
        success: true,
        durationMs: 2000,
        parameters: {},
        result: { data: 'result' },
      };

      serviceNoChannel.emitToolEvent(event, 'conv-123', {
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
      const nestedAudioEvent: ToolEvent = {
        type: 'tool_execution_finished',
        toolName: 'text_to_speech',
        source: 'native',
        requestId: 'req-nested-audio',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        startTime: new Date('2024-01-15T09:59:58Z'),
        endTime: new Date('2024-01-15T10:00:00Z'),
        success: true,
        durationMs: 500,
        parameters: {},
        result: {
          output: {
            audio: 'base64nestedaudiodata',
            mimeType: 'audio/mp3',
            voice: 'shimmer',
            model: 'tts-1',
          },
        },
      };

      service.emitToolEvent(nestedAudioEvent, 'conv-123', agentInfo);

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
      service.emitDelegationEvent(data, 'conv-123');
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

      // Second call: already exists
      mockMessagesFindById.mockReturnValueOnce({ id: 'delegation-dup-agent' });
      service.emitDelegationEvent(data, 'conv-123');
      // Should NOT have been called again
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitErrorEvent - null conversationId', () => {
    it('logs error and skips persistence when conversationId is null', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.emitErrorEvent(
        { error: 'Something broke', details: 'stack trace' },
        null
      );

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
