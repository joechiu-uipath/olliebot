/**
 * Unit Tests for SupervisorAgent
 *
 * Tests the core behaviors: message routing, conversation management, and state.
 * Complex tool execution and delegation flows are better tested via integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock DB that persists across calls
const mockMessagesCreate = vi.fn();
const mockMessagesFindById = vi.fn().mockReturnValue(null);
const mockMessagesFindByConversationId = vi.fn().mockReturnValue([]);
const mockConversationsCreate = vi.fn();
const mockConversationsUpdate = vi.fn();
const mockConversationsFindById = vi.fn().mockReturnValue(null);
const mockConversationsFindRecent = vi.fn().mockReturnValue(null);

// Mock dependencies BEFORE importing the module under test
vi.mock('../db/index.js', () => ({
  getDb: () => ({
    messages: {
      create: mockMessagesCreate,
      findById: mockMessagesFindById,
      findByConversationId: mockMessagesFindByConversationId,
    },
    conversations: {
      create: mockConversationsCreate,
      update: mockConversationsUpdate,
      findById: mockConversationsFindById,
      findRecent: mockConversationsFindRecent,
    },
  }),
}));

vi.mock('../db/well-known-conversations.js', () => ({
  isWellKnownConversation: vi.fn((id: string) => id === 'feed'),
}));

vi.mock('../services/message-event-service.js', () => ({
  getMessageEventService: vi.fn(() => ({
    setChannel: vi.fn(),
    emitToolEvent: vi.fn(),
    emitDelegationEvent: vi.fn(),
    emitTaskRunEvent: vi.fn(() => 'task-run-id'),
    emitErrorEvent: vi.fn(),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => `uuid-${++uuidCounter}`),
}));

vi.mock('./worker.js', () => ({
  WorkerAgent: class MockWorkerAgent {
    identity = mockWorkerAgent.identity;
    conversationId = mockWorkerAgent.conversationId;
    turnId = mockWorkerAgent.turnId;
    init = mockWorkerAgent.init;
    registerChannel = mockWorkerAgent.registerChannel;
    handleDelegatedTask = mockWorkerAgent.handleDelegatedTask;
    setRegistry = mockWorkerAgent.setRegistry;
    setToolRunner = mockWorkerAgent.setToolRunner;
    setSkillManager = mockWorkerAgent.setSkillManager;
    setRagDataManager = mockWorkerAgent.setRagDataManager;
    setAllowedSkills = mockWorkerAgent.setAllowedSkills;
    setWorkflowId = mockWorkerAgent.setWorkflowId;
    shutdown = mockWorkerAgent.shutdown;
  },
}));

vi.mock('../utils/prompt-logger.js', () => ({
  logSystemPrompt: vi.fn(),
}));

// Create mock objects
let uuidCounter = 0;

const mockWorkerAgent = {
  identity: { id: 'worker-1', name: 'Worker', emoji: '⚙️' },
  conversationId: null,
  turnId: null,
  init: vi.fn().mockResolvedValue(undefined),
  registerChannel: vi.fn(),
  handleDelegatedTask: vi.fn().mockResolvedValue(undefined),
  setRegistry: vi.fn(),
  setToolRunner: vi.fn(),
  setSkillManager: vi.fn(),
  setRagDataManager: vi.fn(),
  setAllowedSkills: vi.fn(),
  setWorkflowId: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

// Mock LLM service
const mockLLMService = {
  supportsStreaming: vi.fn(() => false), // Use non-streaming for simpler tests
  generate: vi.fn().mockResolvedValue({ content: 'LLM response' }),
  generateStream: vi.fn(),
  generateWithToolsStream: vi.fn(),
  quickGenerate: vi.fn().mockResolvedValue({ content: 'Generated Title' }),
};

// Mock registry
const mockRegistry = {
  loadAgentPrompt: vi.fn(() => 'System prompt'),
  getSpecialistTypes: vi.fn(() => ['researcher', 'coder']),
  getSpecialistTemplate: vi.fn((type: string) => ({
    identity: { id: type, name: type, emoji: '🤖', role: 'specialist', description: 'Test' },
  })),
  getCommandTriggers: vi.fn(() => new Map([['research', 'researcher']])),
  getToolAccessForSpecialist: vi.fn(() => ['*']),
  getAllowedSkillsForSpecialist: vi.fn(() => null),
  findSpecialistTypeByName: vi.fn(() => null),
  registerAgent: vi.fn(),
  unregisterAgent: vi.fn(),
};

// Mock channel
const mockChannel = {
  id: 'web',
  onMessage: vi.fn(),
  onAction: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  startStream: vi.fn(),
  sendStreamChunk: vi.fn(),
  endStream: vi.fn(),
  broadcast: vi.fn(),
  sendError: vi.fn().mockResolvedValue(undefined),
};

// Import after mocks are set up
import { SupervisorAgentImpl } from './supervisor.js';
import type { Message } from '../channels/types.js';

describe('SupervisorAgentImpl', () => {
  let supervisor: SupervisorAgentImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;

    supervisor = new SupervisorAgentImpl(mockLLMService as any, mockRegistry as any);
    supervisor.registerChannel(mockChannel as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('registerChannel', () => {
    it('sets up message handler on channel', () => {
      const newChannel = {
        id: 'test',
        onMessage: vi.fn(),
        onAction: vi.fn(),
      };

      supervisor.registerChannel(newChannel as any);

      expect(newChannel.onMessage).toHaveBeenCalled();
      expect(newChannel.onAction).toHaveBeenCalled();
    });
  });

  describe('handleMessage - duplicate prevention', () => {
    it('skips already-processing messages', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Hello',
        createdAt: new Date(),
      };

      // Add message to processing set manually
      (supervisor as any).processingMessages.add('msg-1');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await supervisor.handleMessage(message);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('already being processed, skipping')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('handleMessage - command triggers', () => {
    it('routes command trigger to worker without LLM call', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Tell me about AI',
        createdAt: new Date(),
        metadata: {
          agentCommand: { command: 'research', icon: '🔬' },
        },
      };

      await supervisor.handleMessage(message);

      // Should delegate directly without streaming LLM call
      expect(mockLLMService.generateWithToolsStream).not.toHaveBeenCalled();
      expect(mockWorkerAgent.handleDelegatedTask).toHaveBeenCalledWith(
        message,
        'Tell me about AI', // mission = message content
        expect.anything()
      );
    });

    it('ignores unknown command triggers', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Hello',
        createdAt: new Date(),
        metadata: {
          agentCommand: { command: 'unknown-command', icon: '❓' },
        },
      };

      // Mock LLM for fallback path
      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should have fallen through to LLM processing
      expect(mockLLMService.generate).toHaveBeenCalled();
    });
  });

  describe('conversation management', () => {
    it('creates new conversation when none exists', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Hello world',
        createdAt: new Date(),
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      expect(mockConversationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
                    title: expect.any(String),
        })
      );
    });

    it('reuses recent conversation within timeout window', async () => {
      mockConversationsFindRecent.mockReturnValueOnce({
        id: 'existing-conv',
        title: 'Previous Chat',
              });

      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Continue our chat',
        createdAt: new Date(),
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should NOT create new conversation
      expect(mockConversationsCreate).not.toHaveBeenCalled();
      // Should update the existing conversation timestamp
      expect(mockConversationsUpdate).toHaveBeenCalledWith(
        'existing-conv',
        expect.objectContaining({ updatedAt: expect.any(String) })
      );
    });

    it('startNewConversation clears conversation state', () => {
      (supervisor as any).currentConversationId = 'old-conv';
      (supervisor as any).conversationHistory = [{ id: 'msg-1' }];

      supervisor.startNewConversation();

      expect((supervisor as any).currentConversationId).toBeNull();
      expect((supervisor as any).conversationHistory).toEqual([]);
    });

    it('getCurrentConversationId returns current ID', () => {
      (supervisor as any).currentConversationId = 'conv-123';

      expect(supervisor.getCurrentConversationId()).toBe('conv-123');
    });

    it('setConversationId loads history from database', () => {
      mockMessagesFindByConversationId.mockReturnValueOnce([
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
        { id: 'msg-2', role: 'assistant', content: 'Hi!', createdAt: '2024-01-01' },
      ]);

      supervisor.setConversationId('new-conv');

      expect(mockMessagesFindByConversationId).toHaveBeenCalledWith('new-conv');
      expect((supervisor as any).conversationHistory).toHaveLength(2);
    });

    it('setConversationId filters out tool and delegation messages', () => {
      mockMessagesFindByConversationId.mockReturnValueOnce([
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
        { id: 'msg-2', role: 'tool', content: '', createdAt: '2024-01-01' },
        { id: 'msg-3', role: 'system', content: '', createdAt: '2024-01-01', metadata: { type: 'delegation' } },
        { id: 'msg-4', role: 'assistant', content: 'Hi!', createdAt: '2024-01-01' },
      ]);

      supervisor.setConversationId('new-conv');

      // Should only have user and assistant messages
      expect((supervisor as any).conversationHistory).toHaveLength(2);
      expect((supervisor as any).conversationHistory[0].role).toBe('user');
      expect((supervisor as any).conversationHistory[1].role).toBe('assistant');
    });
  });

  describe('well-known conversations', () => {
    it('creates new conversation for user messages from feed', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Hello from feed',
        createdAt: new Date(),
        metadata: { conversationId: 'feed' },
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should create new conversation (not use feed)
      expect(mockConversationsCreate).toHaveBeenCalled();
    });

    it('uses feed conversation for scheduled tasks', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Scheduled task',
        createdAt: new Date(),
        metadata: {
          conversationId: 'feed',
          type: 'task_run',
        },
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should NOT create new conversation
      expect(mockConversationsCreate).not.toHaveBeenCalled();
    });
  });

  describe('message persistence', () => {
    it('saves user message to database', async () => {
      const message: Message = {
        id: 'msg-1',
                role: 'user',
        content: 'Test message',
        createdAt: new Date(),
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-1',
          role: 'user',
          content: 'Test message',
        })
      );
    });
  });

  describe('getSubAgents', () => {
    it('returns empty array initially', () => {
      expect(supervisor.getSubAgents()).toEqual([]);
    });
  });

  describe('getTaskStatus', () => {
    it('returns undefined for unknown task', () => {
      expect(supervisor.getTaskStatus('unknown-task')).toBeUndefined();
    });
  });
});
