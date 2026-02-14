/**
 * Unit Tests for WorkerAgent
 *
 * Tests the core behaviors: configuration, state management, and message persistence.
 * Complex tool execution flows are better tested via integration tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock DB
const mockMessagesCreate = vi.fn();

// Mock dependencies BEFORE importing the module under test
vi.mock('../db/index.js', () => ({
  getDb: () => ({
    messages: {
      create: mockMessagesCreate,
      findById: vi.fn(() => null),
      findByConversationId: vi.fn(() => []),
    },
  }),
}));

vi.mock('../services/message-event-service.js', () => ({
  getMessageEventService: vi.fn(() => ({
    setChannel: vi.fn(),
    emitToolEvent: vi.fn(),
    emitDelegationEvent: vi.fn(),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => `uuid-${++uuidCounter}`),
}));

vi.mock('../utils/prompt-logger.js', () => ({
  logSystemPrompt: vi.fn(),
}));

let uuidCounter = 0;

// Mock LLM service
const mockLLMService = {
  supportsStreaming: vi.fn(() => true),
  generateStream: vi.fn(),
  generateWithToolsStream: vi.fn(),
  generate: vi.fn(),
  // runWithContext executes the callback immediately (for tests)
  runWithContext: vi.fn((ctx, fn) => fn()),
};

// Mock channel
const mockChannel = {
  id: 'web',
  send: vi.fn().mockResolvedValue(undefined),
  startStream: vi.fn(),
  sendStreamChunk: vi.fn(),
  endStream: vi.fn(),
  broadcast: vi.fn(),
  sendError: vi.fn().mockResolvedValue(undefined),
};

// Mock agent config
const createWorkerConfig = (overrides = {}) => ({
  identity: {
    id: 'worker-test',
    name: 'Test Worker',
    emoji: '🔧',
    role: 'worker' as const,
    description: 'Test worker agent',
  },
  capabilities: {
    canSpawnAgents: false,
    canAccessTools: ['*'],
    canUseChannels: ['*'],
    maxConcurrentTasks: 1,
  },
  systemPrompt: 'You are a test worker.',
  parentId: 'supervisor-main',
  mission: 'Test mission',
  ...overrides,
});

// Import after mocks are set up
import { WorkerAgent } from './worker.js';
import type { Message } from '../channels/types.js';

describe('WorkerAgent', () => {
  let worker: WorkerAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;

    worker = new WorkerAgent(createWorkerConfig(), mockLLMService as any, 'researcher');
  });

  describe('constructor', () => {
    it('sets agent type correctly', () => {
      expect(worker.getAgentType()).toBe('researcher');
    });

    it('defaults to custom type when not provided', () => {
      const customWorker = new WorkerAgent(createWorkerConfig(), mockLLMService as any);
      expect(customWorker.getAgentType()).toBe('custom');
    });

    it('stores parent ID from config', () => {
      expect((worker as any).parentId).toBe('supervisor-main');
    });
  });

  describe('setWorkflowId', () => {
    it('sets the workflow context', () => {
      worker.setWorkflowId('deep-research-workflow');
      expect((worker as any).currentWorkflowId).toBe('deep-research-workflow');
    });

    it('can clear workflow context with null', () => {
      worker.setWorkflowId('some-workflow');
      worker.setWorkflowId(null);
      expect((worker as any).currentWorkflowId).toBeNull();
    });
  });

  describe('conversationId and turnId', () => {
    it('allows setting conversationId directly', () => {
      worker.conversationId = 'conv-123';
      expect(worker.conversationId).toBe('conv-123');
    });

    it('allows setting turnId directly', () => {
      worker.turnId = 'turn-456';
      expect(worker.turnId).toBe('turn-456');
    });
  });

  describe('saveAssistantMessage (private)', () => {
    it('saves message with agent metadata when conversationId is set', () => {
      worker.conversationId = 'conv-123';
      worker.turnId = 'turn-1';

      (worker as any).saveAssistantMessage('Test content');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-123',
                    role: 'assistant',
          content: 'Test content',
          turnId: 'turn-1',
          metadata: expect.objectContaining({
            agentId: 'worker-test',
            agentName: 'Test Worker',
            agentEmoji: '🔧',
            agentType: 'researcher',
          }),
        })
      );
    });

    it('logs error when conversationId is null', () => {
      worker.conversationId = null;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      (worker as any).saveAssistantMessage('Test content');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('conversationId is null, cannot save assistant message')
      );
      expect(mockMessagesCreate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('includes citations in metadata when present', () => {
      worker.conversationId = 'conv-123';

      const citations = {
        sources: [
          { id: 'c1', type: 'web' as const, toolName: 'search', uri: 'https://example.com', title: 'Example' },
        ],
      };

      (worker as any).saveAssistantMessage('Content with citations', { citations });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            citations,
          }),
        })
      );
    });
  });

  describe('handleAgentCommunication (protected)', () => {
    it('handles terminate message by shutting down', async () => {
      const shutdownSpy = vi.spyOn(worker, 'shutdown').mockResolvedValue(undefined);

      await (worker as any).handleAgentCommunication({
        type: 'terminate',
        fromAgent: 'supervisor-main',
        payload: {},
      });

      expect(shutdownSpy).toHaveBeenCalled();
    });

    it('handles task_result from sub-agents by resolving pending promise', async () => {
      const resolvePromise = vi.fn();
      (worker as any).pendingSubAgentResults.set('sub-agent-1', {
        resolve: resolvePromise,
        reject: vi.fn(),
      });

      await (worker as any).handleAgentCommunication({
        type: 'task_result',
        fromAgent: 'sub-agent-1',
        payload: {
          taskId: 'task-1',
          result: 'Sub-agent completed work',
          status: 'completed',
          citations: {
            sources: [{ id: 'c1', type: 'web', toolName: 'search' }],
          },
        },
      });

      expect(resolvePromise).toHaveBeenCalledWith('Sub-agent completed work');
      expect((worker as any).pendingSubAgentResults.has('sub-agent-1')).toBe(false);
    });

    it('collects citations from sub-agent results', async () => {
      const resolvePromise = vi.fn();
      (worker as any).pendingSubAgentResults.set('sub-agent-1', {
        resolve: resolvePromise,
        reject: vi.fn(),
      });

      await (worker as any).handleAgentCommunication({
        type: 'task_result',
        fromAgent: 'sub-agent-1',
        payload: {
          taskId: 'task-1',
          result: 'Done',
          status: 'completed',
          citations: {
            sources: [
              { id: 'c1', type: 'web', toolName: 'search', uri: 'https://example.com' },
            ],
          },
        },
      });

      expect((worker as any).subAgentCitations).toHaveLength(1);
      expect((worker as any).subAgentCitations[0]).toMatchObject({
        subAgentId: 'sub-agent-1',
        type: 'web',
        uri: 'https://example.com',
      });
    });

    it('handles failed sub-agent results by rejecting promise', async () => {
      const rejectPromise = vi.fn();
      (worker as any).pendingSubAgentResults.set('sub-agent-1', {
        resolve: vi.fn(),
        reject: rejectPromise,
      });

      await (worker as any).handleAgentCommunication({
        type: 'task_result',
        fromAgent: 'sub-agent-1',
        payload: {
          taskId: 'task-1',
          error: 'Sub-agent crashed',
          status: 'failed',
        },
      });

      expect(rejectPromise).toHaveBeenCalledWith(expect.any(Error));
    });

    it('ignores unexpected task_result from unknown agents', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (worker as any).handleAgentCommunication({
        type: 'task_result',
        fromAgent: 'unknown-agent',
        payload: {
          taskId: 'task-1',
          result: 'Surprise!',
          status: 'completed',
        },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received unexpected task_result from unknown-agent')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('handleMessage', () => {
    beforeEach(() => {
      worker.registerChannel(mockChannel as any);
    });

    it('updates agent state during message processing', async () => {
      // Mock generateResponse to return immediately
      (worker as any).generateResponse = vi.fn().mockResolvedValue('Response');

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Test',
        createdAt: new Date(),
      };

      await worker.handleMessage(message);

      // After processing, state should be idle
      expect((worker as any)._state.status).toBe('idle');
    });
  });

  describe('handleDelegatedTask', () => {
    beforeEach(() => {
      worker.registerChannel(mockChannel as any);
      worker.conversationId = 'conv-123';
      worker.turnId = 'turn-1';
    });

    it('sends status update to parent when starting', async () => {
      const sendToAgentSpy = vi.spyOn(worker as any, 'sendToAgent').mockResolvedValue(undefined);
      (worker as any).generateResponse = vi.fn().mockResolvedValue('Done');

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Do task',
        createdAt: new Date(),
      };

      await worker.handleDelegatedTask(message, 'Complete the task', mockChannel as any);

      // Should have sent status_update (started) first
      expect(sendToAgentSpy).toHaveBeenCalledWith(
        'supervisor-main',
        expect.objectContaining({
          type: 'status_update',
          payload: expect.objectContaining({
            status: 'started',
          }),
        })
      );
    });

    it('sends task_result to parent when completed (no tools)', async () => {
      const sendToAgentSpy = vi.spyOn(worker as any, 'sendToAgent').mockResolvedValue(undefined);
      (worker as any).generateResponse = vi.fn().mockResolvedValue('Done');

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Do task',
        createdAt: new Date(),
      };

      await worker.handleDelegatedTask(message, 'Complete the task', mockChannel as any);

      // Should have sent task_result with completed status
      expect(sendToAgentSpy).toHaveBeenCalledWith(
        'supervisor-main',
        expect.objectContaining({
          type: 'task_result',
          payload: expect.objectContaining({
            status: 'completed',
            result: 'Done',
          }),
        })
      );
    });

    it('reports failure to parent on error', async () => {
      const sendToAgentSpy = vi.spyOn(worker as any, 'sendToAgent').mockResolvedValue(undefined);
      (worker as any).generateResponse = vi.fn().mockRejectedValue(new Error('Generation failed'));

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Do task',
        createdAt: new Date(),
      };

      await worker.handleDelegatedTask(message, 'Complete the task', mockChannel as any);

      expect(sendToAgentSpy).toHaveBeenCalledWith(
        'supervisor-main',
        expect.objectContaining({
          type: 'task_result',
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.stringContaining('Generation failed'),
          }),
        })
      );
    });

    it('sends response to channel (no tools)', async () => {
      (worker as any).generateResponse = vi.fn().mockResolvedValue('Here is my response');
      vi.spyOn(worker as any, 'sendToAgent').mockResolvedValue(undefined);

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Do task',
        createdAt: new Date(),
      };

      await worker.handleDelegatedTask(message, 'Complete the task', mockChannel as any);

      expect(mockChannel.send).toHaveBeenCalledWith(
        'Here is my response',
        expect.objectContaining({ markdown: true })
      );
    });
  });
});
