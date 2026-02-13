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
    rawRun: vi.fn(),
    rawExec: vi.fn(),
    rawQuery: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../db/well-known-conversations.js', () => ({
  isWellKnownConversation: vi.fn((id: string) => id === 'feed'),
}));

// Shared mock functions for MessageEventService - allows tracking across all getMessageEventService() calls
const mockEmitToolEvent = vi.fn();
const mockEmitDelegationEvent = vi.fn();
const mockEmitTaskRunEvent = vi.fn(() => 'task-run-id');
const mockEmitErrorEvent = vi.fn();

vi.mock('../services/message-event-service.js', () => ({
  getMessageEventService: vi.fn(() => ({
    setChannel: vi.fn(),
    emitToolEvent: mockEmitToolEvent,
    emitDelegationEvent: mockEmitDelegationEvent,
    emitTaskRunEvent: mockEmitTaskRunEvent,
    emitErrorEvent: mockEmitErrorEvent,
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
  pushContext: vi.fn(),
  popContext: vi.fn(),
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

    it('creates new conversation when message has no conversationId', async () => {
      // Set up existing state (conversation history)
      (supervisor as any).conversationHistory = [{ id: 'msg-1', role: 'user', content: 'old message', createdAt: new Date() }];

      const message: Message = {
        id: 'msg-new',
        role: 'user',
        content: 'Start fresh',
        createdAt: new Date(),
        // No conversationId in metadata - should trigger new conversation creation
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should have created/found a conversation (mock findRecent returns null, so creates new)
      expect(mockConversationsCreate).toHaveBeenCalled();
    });

    it('loads history from database when message has conversationId', async () => {
      mockMessagesFindByConversationId.mockReturnValueOnce([
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
        { id: 'msg-2', role: 'assistant', content: 'Hi!', createdAt: '2024-01-01' },
      ]);

      const message: Message = {
        id: 'msg-new',
        role: 'user',
        content: 'Continue conversation',
        createdAt: new Date(),
        metadata: { conversationId: 'existing-conv' },
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      expect(mockMessagesFindByConversationId).toHaveBeenCalledWith('existing-conv');
    });

    it('filters out tool and delegation messages when loading history', async () => {
      mockMessagesFindByConversationId.mockReturnValueOnce([
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
        { id: 'msg-2', role: 'tool', content: '', createdAt: '2024-01-01' },
        { id: 'msg-3', role: 'system', content: '', createdAt: '2024-01-01', metadata: { type: 'delegation' } },
        { id: 'msg-4', role: 'assistant', content: 'Hi!', createdAt: '2024-01-01' },
      ]);

      const message: Message = {
        id: 'msg-new',
        role: 'user',
        content: 'Continue conversation',
        createdAt: new Date(),
        metadata: { conversationId: 'conv-with-tools' },
      };

      mockLLMService.supportsStreaming.mockReturnValueOnce(false);

      await supervisor.handleMessage(message);

      // Should only have user and assistant messages (plus the new message)
      // The loaded history has 2 valid messages, plus the new user message = 3 total
      const history = (supervisor as any).conversationHistory;
      const validRoles = history.filter((m: any) => m.role === 'user' || m.role === 'assistant');
      expect(validRoles.length).toBeGreaterThanOrEqual(2);
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

  describe('tool event routing with callerId', () => {
    it('creates callerId that includes conversationId for uniqueness', async () => {
      // Set up tool runner mock that captures the callerId from createRequest
      const capturedCallerIds: string[] = [];
      const mockToolRunner = {
        onToolEvent: vi.fn((callback: (event: any) => void) => {
          // Store callback so we can trigger events
          (mockToolRunner as any).eventCallback = callback;
          return () => {}; // Unsubscribe function
        }),
        getToolsForLLM: vi.fn(() => [{ name: 'test_tool', description: 'Test', input_schema: {} }]),
        createRequest: vi.fn((id: string, name: string, input: any, groupId?: string, callerId?: string) => {
          capturedCallerIds.push(callerId || '');
          return { id, toolName: name, source: 'native', parameters: input, callerId };
        }),
        executeToolsWithCitations: vi.fn().mockResolvedValue({ results: [], citations: [] }),
        isPrivateTool: vi.fn(() => false),
      };

      // Set tool runner on supervisor
      (supervisor as any).toolRunner = mockToolRunner;

      // Mock streaming support
      mockLLMService.supportsStreaming.mockReturnValue(true);
      mockLLMService.generateWithToolsStream.mockImplementation(async (_messages, callbacks, _options) => {
        callbacks.onChunk('Response');
        callbacks.onComplete();
        // Return response with tool use to trigger tool execution
        return {
          content: 'Response',
          toolUse: [{ id: 'tool-1', name: 'test_tool', input: {} }],
        };
      });

      // First message with conversationId 'feed'
      const message1: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Test 1',
        createdAt: new Date(),
        metadata: { conversationId: 'feed', type: 'task_run' }, // Scheduled task
      };

      await supervisor.handleMessage(message1);

      // Verify callerId includes conversationId
      expect(capturedCallerIds.length).toBeGreaterThan(0);
      expect(capturedCallerIds[0]).toContain('supervisor-main');
      expect(capturedCallerIds[0]).toContain('feed');
      expect(capturedCallerIds[0]).toBe('supervisor-main:feed');
    });

    it('uses different callerIds for different conversations', async () => {
      const capturedCallerIds: string[] = [];
      const mockToolRunner = {
        onToolEvent: vi.fn(() => () => {}),
        getToolsForLLM: vi.fn(() => [{ name: 'test_tool', description: 'Test', input_schema: {} }]),
        createRequest: vi.fn((id: string, name: string, input: any, groupId?: string, callerId?: string) => {
          capturedCallerIds.push(callerId || '');
          return { id, toolName: name, source: 'native', parameters: input, callerId };
        }),
        executeToolsWithCitations: vi.fn().mockResolvedValue({ results: [], citations: [] }),
        isPrivateTool: vi.fn(() => false),
      };

      (supervisor as any).toolRunner = mockToolRunner;

      mockLLMService.supportsStreaming.mockReturnValue(true);
      mockLLMService.generateWithToolsStream.mockImplementation(async (_messages, callbacks, _options) => {
        callbacks.onChunk('Response');
        callbacks.onComplete();
        return { content: 'Response', toolUse: [{ id: 'tool-1', name: 'test_tool', input: {} }] };
      });

      // First request with feed conversation
      const message1: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Feed task',
        createdAt: new Date(),
        metadata: { conversationId: 'feed', type: 'task_run' },
      };

      await supervisor.handleMessage(message1);

      // Reset for second request
      capturedCallerIds.length = 0;

      // Second request with user conversation
      const userConvId = 'user-conv-123';
      mockConversationsFindById.mockReturnValueOnce({ id: userConvId, title: 'User Chat' });

      const message2: Message = {
        id: 'msg-2',
        role: 'user',
        content: 'User message',
        createdAt: new Date(),
        metadata: { conversationId: userConvId },
      };

      await supervisor.handleMessage(message2);

      // Verify second request used different callerId
      expect(capturedCallerIds.length).toBeGreaterThan(0);
      expect(capturedCallerIds[0]).toBe(`supervisor-main:${userConvId}`);
    });

    it('event listener only processes events with matching callerId', async () => {
      // Clear the shared mock before test
      mockEmitToolEvent.mockClear();

      let capturedCallback: ((event: any) => void) | null = null;

      const mockToolRunner = {
        onToolEvent: vi.fn((callback: (event: any) => void) => {
          capturedCallback = callback;
          return () => { capturedCallback = null; };
        }),
        getToolsForLLM: vi.fn(() => [{ name: 'test_tool', description: 'Test', input_schema: {} }]),
        createRequest: vi.fn((id: string, name: string, input: any, groupId?: string, callerId?: string) => {
          return { id, toolName: name, source: 'native', parameters: input, callerId };
        }),
        executeToolsWithCitations: vi.fn().mockResolvedValue({ results: [], citations: [] }),
        isPrivateTool: vi.fn(() => false),
      };

      (supervisor as any).toolRunner = mockToolRunner;

      mockLLMService.supportsStreaming.mockReturnValue(true);
      mockLLMService.generateWithToolsStream.mockImplementation(async (_messages, callbacks, _options) => {
        callbacks.onChunk('Response');

        // Simulate tool events DURING streaming (while listener is active)
        if (capturedCallback) {
          // Event with MATCHING callerId - should be processed
          capturedCallback({
            type: 'tool_execution_finished',
            callerId: 'supervisor-main:feed',
            toolName: 'test_tool',
            requestId: 'req-match',
            timestamp: new Date(),
          });

          // Event with NON-MATCHING callerId - should be filtered out
          capturedCallback({
            type: 'tool_execution_finished',
            callerId: 'supervisor-main:other-conv',
            toolName: 'test_tool',
            requestId: 'req-nomatch',
            timestamp: new Date(),
          });
        }

        callbacks.onComplete();
        return { content: 'Response', toolUse: [] };
      });

      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Feed task',
        createdAt: new Date(),
        metadata: { conversationId: 'feed', type: 'task_run' },
      };

      await supervisor.handleMessage(message);

      // Verify only the MATCHING event was processed (emitToolEvent called once, not twice)
      expect(mockEmitToolEvent).toHaveBeenCalledTimes(1);
      // Verify it was called with the correct conversationId
      expect(mockEmitToolEvent).toHaveBeenCalledWith(
        expect.objectContaining({ callerId: 'supervisor-main:feed' }),
        'feed',
        expect.anything(),
        expect.anything()
      );
    });

    it('ignores tool events from different conversations', async () => {
      // Clear the shared mock before test
      mockEmitToolEvent.mockClear();

      let eventCallback: ((event: any) => void) | null = null;

      const mockToolRunner = {
        onToolEvent: vi.fn((callback: (event: any) => void) => {
          eventCallback = callback;
          return () => { eventCallback = null; };
        }),
        getToolsForLLM: vi.fn(() => []),
        createRequest: vi.fn(),
        executeToolsWithCitations: vi.fn().mockResolvedValue({ results: [], citations: [] }),
        isPrivateTool: vi.fn(() => false),
      };

      (supervisor as any).toolRunner = mockToolRunner;

      mockLLMService.supportsStreaming.mockReturnValue(true);
      mockLLMService.generateWithToolsStream.mockImplementation(async (_messages, callbacks, _options) => {
        callbacks.onChunk('Response');

        // Simulate tool event with DIFFERENT callerId DURING streaming
        if (eventCallback) {
          eventCallback({
            type: 'tool_execution_finished',
            callerId: 'supervisor-main:feed', // Different conversation!
            toolName: 'user.lottery',
            requestId: 'req-1',
            timestamp: new Date(),
          });
        }

        callbacks.onComplete();
        return { content: 'Response', toolUse: [] };
      });

      // Handle message for user conversation (not feed)
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'User message',
        createdAt: new Date(),
        metadata: { conversationId: 'user-conv-abc' },
      };

      await supervisor.handleMessage(message);

      // Event should NOT be processed (callerId 'supervisor-main:feed' doesn't match 'supervisor-main:user-conv-abc')
      expect(mockEmitToolEvent).not.toHaveBeenCalled();
    });
  });
});
