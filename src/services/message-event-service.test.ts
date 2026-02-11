/**
 * Unit Tests for MessageEventService
 *
 * Tests that the service properly broadcasts events to WebChannel
 * AND persists them to the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageEventService } from './message-event-service.js';
import type { ToolEvent } from '../tools/types.js';

// Create mock DB that persists across calls
const mockMessagesCreate = vi.fn();
const mockMessagesFindById = vi.fn(() => null);

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
  let mockWebChannel: { broadcast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBroadcast = vi.fn();
    mockWebChannel = { broadcast: mockBroadcast };

    service = new MessageEventService(mockWebChannel as any);
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

    it('broadcasts tool event to WebChannel', () => {
      service.emitToolEvent(baseEvent, 'conv-123', 'web', agentInfo);

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
      service.emitToolEvent(baseEvent, 'conv-123', 'web', agentInfo);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tool-req-123',
          conversationId: 'conv-123',
          channel: 'web',
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

    it('does NOT persist non-finished events (e.g., tool_execution_started)', () => {
      const startEvent: ToolEvent = {
        ...baseEvent,
        type: 'tool_execution_started',
      };

      service.emitToolEvent(startEvent, 'conv-123', 'web', agentInfo);

      expect(mockBroadcast).toHaveBeenCalledTimes(1); // Still broadcasts
      expect(mockMessagesCreate).not.toHaveBeenCalled(); // But doesn't persist
    });

    it('logs error when conversationId is null for finished events', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.emitToolEvent(baseEvent, null, 'web', agentInfo);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot save tool event: conversationId is null')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('skips duplicate events (already exists in DB)', () => {
      mockMessagesFindById.mockReturnValueOnce({ id: 'tool-req-123' });

      service.emitToolEvent(baseEvent, 'conv-123', 'web', agentInfo);

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

      service.emitToolEvent(audioEvent, 'conv-123', 'web', agentInfo);

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

      service.emitToolEvent(largeEvent, 'conv-123', 'web', agentInfo);

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

      service.emitToolEvent(mediaEvent, 'conv-123', 'web', agentInfo);

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

    it('broadcasts delegation event to WebChannel', () => {
      service.emitDelegationEvent(delegationData, 'conv-123', 'web');

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
      service.emitDelegationEvent(delegationData, 'conv-123', 'web');

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

      service.emitDelegationEvent(delegationData, null, 'web');

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
    };

    it('broadcasts task_run event and returns turnId', () => {
      const turnId = service.emitTaskRunEvent(taskData, 'conv-123', 'web');

      expect(turnId).toBe('task-run-task-456');
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_run',
          taskId: 'task-456',
          taskName: 'Daily Briefing',
          turnId: 'task-run-task-456',
        })
      );
    });

    it('persists task_run event to database', () => {
      service.emitTaskRunEvent(taskData, 'conv-123', 'web');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-run-task-456',
          conversationId: 'conv-123',
          role: 'system',
          metadata: expect.objectContaining({
            type: 'task_run',
            taskId: 'task-456',
          }),
        })
      );
    });

    it('returns turnId even when conversationId is null (for UI)', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const turnId = service.emitTaskRunEvent(taskData, null, 'web');

      expect(turnId).toBe('task-run-task-456');
      consoleSpy.mockRestore();
    });
  });

  describe('emitErrorEvent', () => {
    const errorData = {
      error: 'API rate limit exceeded',
      details: 'Too many requests in the last minute',
    };

    it('broadcasts error event to WebChannel', () => {
      service.emitErrorEvent(errorData, 'conv-123', 'web');

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
      service.emitErrorEvent(errorData, 'conv-123', 'web');

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

  describe('setWebChannel', () => {
    it('allows setting WebChannel after construction', () => {
      const serviceWithoutChannel = new MessageEventService();
      const newChannel = { broadcast: vi.fn() };

      serviceWithoutChannel.setWebChannel(newChannel as any);

      const event: ToolEvent = {
        type: 'tool_execution_started',
        toolName: 'test',
        source: 'native',
        requestId: 'req-1',
        timestamp: new Date(),
      };

      serviceWithoutChannel.emitToolEvent(event, 'conv-1', 'web', {
        id: 'a1',
        name: 'Agent',
        emoji: '🤖',
      });

      expect(newChannel.broadcast).toHaveBeenCalled();
    });
  });
});
