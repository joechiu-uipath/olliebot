// Supervisor Agent - orchestrates sub-agents

import { v4 as uuid } from 'uuid';
import { AbstractAgent, type AgentRegistry } from './base-agent.js';
import type {
  SupervisorAgent as ISupervisorAgent,
  AgentConfig,
  AgentCommunication,
  TaskAssignment,
  TaskResultPayload,
  AgentIdentity,
  AgentTurnUsage,
} from './types.js';
import { WorkerAgent } from './worker.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage } from '../llm/types.js';
import { getDb } from '../db/index.js';
import { isWellKnownConversation } from '../db/well-known-conversations.js';
import { formatToolResultBlocks } from '../utils/index.js';
import { logSystemPrompt } from '../utils/prompt-logger.js';
import type { CitationSource, StoredCitationData } from '../citations/types.js';
import { DEEP_RESEARCH_WORKFLOW_ID, AGENT_IDS } from '../deep-research/constants.js';
import { SELF_CODING_WORKFLOW_ID, AGENT_IDS as CODING_AGENT_IDS } from '../self-coding/constants.js';
import { getMessageEventService } from '../services/message-event-service.js';
import { getTraceStore } from '../tracing/index.js';
import {
  SUPERVISOR_ICON,
  SUPERVISOR_NAME,
  CONVERSATION_HISTORY_LIMIT,
  AGENT_MAX_TOOL_ITERATIONS,
  SUPERVISOR_MAX_CONCURRENT_TASKS,
  MESSAGE_DEDUP_WINDOW_MS,
  RECENT_CONVERSATION_WINDOW_MS,
  AUTO_NAME_MESSAGE_THRESHOLD,
  AUTO_NAME_MESSAGES_TO_LOAD,
  AUTO_NAME_CONTENT_PREVIEW_LENGTH,
  AUTO_NAME_LLM_MAX_TOKENS,
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_TITLE_PREVIEW_LENGTH,
} from '../constants.js';

export class SupervisorAgentImpl extends AbstractAgent implements ISupervisorAgent {
  private subAgents: Map<string, WorkerAgent> = new Map();
  private tasks: Map<string, TaskAssignment> = new Map();
  private conversationMessageCount: Map<string, number> = new Map(); // Track message counts for auto-naming
  // Track messages currently being processed to prevent re-processing due to timeouts/retries
  private processingMessages: Set<string> = new Set();
  // Track which messages have had delegation performed to prevent re-delegation
  private delegatedMessages: Set<string> = new Set();

  // Override to make registry non-nullable in supervisor
  protected declare agentRegistry: AgentRegistry;

  constructor(llmService: LLMService, registry: AgentRegistry) {
    const config: AgentConfig = {
      identity: {
        id: 'supervisor-main',
        name: SUPERVISOR_NAME,
        emoji: SUPERVISOR_ICON,
        role: 'supervisor',
        description: 'Main supervisor agent that orchestrates tasks and delegates to specialists',
      },
      capabilities: {
        canSpawnAgents: true,
        canAccessTools: ['*'], // Private tools (self-coding) are auto-excluded for supervisors unless delegating
        canUseChannels: ['*'],
        maxConcurrentTasks: SUPERVISOR_MAX_CONCURRENT_TASKS,
      },
      systemPrompt: registry.loadAgentPrompt('supervisor'),
    };

    super(config, llmService);
    this.agentRegistry = registry;
  }

  async init(): Promise<void> {
    await super.init();
    const specialistCount = this.agentRegistry.getSpecialistTypes().length;
    console.log(`[${this.identity.name}] Supervisor initialized with ${specialistCount} specialist types`);
  }

  // Note: getConversationId() is not overridden - supervisor uses request-scoped conversationId
  // passed through method parameters, not instance state.

  registerChannel(channel: Channel): void {
    super.registerChannel(channel);

    // Set up message handler for this channel
    channel.onMessage(async (message) => {
      await this.handleMessage(message);
    });

    channel.onAction(async (action, data) => {
      console.log(`[${this.identity.name}] Action: ${action}`, data);
    });

    // Note: onNewConversation is not needed - conversation context is now request-scoped.
    // Each message carries its own conversationId in metadata. To start a new conversation,
    // the frontend simply doesn't send a conversationId, and ensureConversation() will
    // create one or find a recent conversation to continue.
  }

  async handleMessage(message: Message): Promise<void> {
    // Prevent re-processing of the same message (can happen due to timeouts/retries)
    if (this.processingMessages.has(message.id)) {
      console.log(`[${this.identity.name}] Message ${message.id} already being processed, skipping`);
      return;
    }

    this._state.lastActivity = new Date();
    this._state.status = 'working';

    // Mark message as being processed
    this.processingMessages.add(message.id);

    // Determine conversationId from message metadata (request-scoped, not instance state).
    // IMPORTANT: Well-known conversations (like 'feed') should ONLY be used for scheduled tasks,
    // not for user-initiated messages. If a user sends a message while viewing Feed, we should
    // create a new conversation for their request, not pollute the Feed with user interactions.
    const msgConversationId = message.metadata?.conversationId as string | undefined;
    const isScheduledTask = message.metadata?.type === 'task_run';
    let initialConversationId: string | null = null;

    if (msgConversationId) {
      // Only use well-known conversation IDs for scheduled tasks
      if (isWellKnownConversation(msgConversationId) && !isScheduledTask) {
        // User message from Feed view - don't use Feed conversation, will create new one later
        console.log(`[${this.identity.name}] User message from well-known conversation '${msgConversationId}', will create new conversation`);
        initialConversationId = null;
      } else {
        initialConversationId = msgConversationId;
      }
    }

    // Load conversation history from database (request-scoped, doesn't set instance state)
    this.conversationHistory = this.loadConversationHistory(initialConversationId);

    // Set the turnId for this message processing (request-scoped)
    // For task_run messages, use the turnId from metadata (set by the task_run event)
    // For user messages, the message ID is the turnId
    const requestTurnId = (message.metadata?.turnId as string) || message.id;

    // Save message to history and get/create conversationId
    this.conversationHistory.push(message);
    const requestConversationId = this.saveMessageInternal(message, initialConversationId, requestTurnId);

    // All state below is request-scoped - passed through parameters, not instance variables

    if (!this.channel) {
      console.error(`[${this.identity.name}] No channel registered`);
      return;
    }
    const channel = this.channel;

    // Start execution trace
    const traceStore = getTraceStore();
    const traceId = traceStore.startTrace({
      conversationId: requestConversationId,
      turnId: requestTurnId,
      triggerType: isScheduledTask ? 'task_run' : 'user_message',
      triggerContent: typeof message.content === 'string' ? message.content : undefined,
    });
    const spanId = traceStore.startSpan({
      traceId,
      agentId: this.identity.id,
      agentName: this.identity.name,
      agentEmoji: this.identity.emoji,
      agentType: 'supervisor-main',
      agentRole: 'supervisor',
    });

    // Push LLM context so all calls in this turn are associated with this trace
    this.llmService.pushContext({
      traceId,
      spanId,
      agentId: this.identity.id,
      agentName: this.identity.name,
      conversationId: requestConversationId,
      purpose: 'chat',
    });

    try {
      // Check for agent command in metadata first (from UI badge selection)
      const agentCommand = message.metadata?.agentCommand as { command: string; icon: string } | undefined;
      let commandResult: { command: string; agentType: string; mission: string } | null = null;

      if (agentCommand) {
        // Command was selected via UI badge - find the agent type
        const triggers = this.agentRegistry.getCommandTriggers();
        const commandLower = agentCommand.command.toLowerCase();
        const agentType = triggers.get(commandLower);

        if (agentType) {
          commandResult = {
            command: agentCommand.command,
            agentType,
            mission: message.content,
          };
        }
      }

      if (commandResult) {
        const { agentType, mission } = commandResult;
        console.log(`[${this.identity.name}] Command trigger detected: #${commandResult.command} -> ${agentType}`);

        // Mark as delegated to prevent re-delegation
        this.delegatedMessages.add(message.id);

        // Directly delegate without LLM decision
        await this.handleDelegationFromTool(
          {
            type: agentType,
            mission,
            rationale: `User explicitly requested via #${commandResult.command} command`,
          },
          message,
          channel,
          requestConversationId,
          requestTurnId,
          traceId
        );
      } else {
        // No command trigger - proceed with normal LLM processing
        // Check if channel supports streaming
        const supportsStreaming = typeof channel.startStream === 'function' && this.llmService.supportsStreaming();

        if (supportsStreaming) {
          await this.generateStreamingResponse(message, channel, requestConversationId, requestTurnId, traceId);
        } else {
          // Fallback to non-streaming
          const response = await this.generateResponse(this.conversationHistory.slice(-CONVERSATION_HISTORY_LIMIT));
          const delegationMatch = response.match(/```delegate\s*([\s\S]*?)```/);

          if (delegationMatch) {
            await this.handleDelegation(delegationMatch[1], message, channel, requestConversationId, requestTurnId, traceId);
          } else {
            await this.sendMessage(response, {
              reasoningMode: message.metadata?.reasoningMode as string | undefined,
              conversationId: requestConversationId,
            });
          }
        }
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Error:`, error);
      traceStore.endSpan(spanId, 'error', String(error));
      traceStore.endTrace(traceId, 'error');
      await this.sendError('Failed to process message', String(error), requestConversationId);
    } finally {
      // Pop LLM context
      this.llmService.popContext();

      // End trace/span if not already ended by error handler
      const currentSpan = traceStore.getSpanById(spanId);
      if (currentSpan && currentSpan.status === 'running') {
        traceStore.endSpan(spanId);
      }
      const currentTrace = traceStore.getTraceById(traceId);
      if (currentTrace && currentTrace.status === 'running') {
        traceStore.endTrace(traceId);
      }

      // Clean up processing state after a delay (allow for retries to be detected)
      setTimeout(() => {
        this.processingMessages.delete(message.id);
        this.delegatedMessages.delete(message.id);
      }, MESSAGE_DEDUP_WINDOW_MS); // Keep in set to prevent retries during long tasks
    }

    this._state.status = 'idle';
  }

  private async generateStreamingResponse(
    message: Message,
    channel: Channel,
    conversationId: string | undefined,
    turnId: string | undefined,
    traceId?: string
  ): Promise<void> {
    const streamId = uuid();
    let fullResponse = '';

    // Citation tracking - sources collected from tool executions
    const collectedSources: CitationSource[] = [];

    // Usage tracking - accumulated across tool iterations
    const turnUsage: AgentTurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      llmDurationMs: 0,
      modelId: undefined,
      traceId,
    };

    // Refresh RAG data cache before generating response
    await this.refreshRagDataCache();

    // Setup tool event broadcasting and persistence via MessageEventService
    // IMPORTANT: callerId must be unique per conversation to prevent race conditions
    // when handling concurrent requests. If two requests register listeners with the same
    // callerId, both would process tool events and race to save to DB.
    const callerId = `${this.identity.id}:${conversationId || 'no-conv'}`;
    let unsubscribeTool: (() => void) | undefined;
    if (this.toolRunner) {
      unsubscribeTool = this.toolRunner.onToolEvent((event) => {
        // Only emit events for tools THIS conversation's request called (filter by callerId)
        if (event.callerId && event.callerId !== callerId) {
          return; // This event is for a different agent/conversation
        }

        const messageEventService = getMessageEventService();
        messageEventService.setChannel(channel);

        // Use centralized service that broadcasts AND persists
        messageEventService.emitToolEvent(event, conversationId ?? null, {
          id: this.identity.id,
          name: this.identity.name,
          emoji: this.identity.emoji,
        }, turnId);
      });
    }

    try {
      // Start stream with agent info and conversation context
      channel.startStream(streamId, {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
        conversationId,
      });

      const systemPrompt = this.buildSystemPrompt();
      const tools = this.getToolsForLLM();

      // Log system prompt to file for debugging
      logSystemPrompt(this.identity.name, systemPrompt);

      // Build initial messages, including image attachments and messageType
      let llmMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory.slice(-CONVERSATION_HISTORY_LIMIT).map((m) => {
          // Check if message has image attachments
          const imageAttachments = m.attachments?.filter(a => a.type.startsWith('image/')) || [];

          // Build the text content, prepending messageType if present
          let textContent = m.content;
          if (m.role === 'user' && m.metadata?.messageType) {
            // Prepend messageType to help supervisor route correctly
            const messageType = m.metadata.messageType as string;
            textContent = `[messageType: ${messageType}]\n\n${m.content}`;
          }

          if (imageAttachments.length > 0 && m.role === 'user') {
            // Build multimodal content with text and images
            const content: Array<{ type: 'text' | 'image'; text?: string; source?: { type: 'base64'; media_type: string; data: string } }> = [];

            // Add text content first (content should always be string from Message type)
            if (textContent && typeof textContent === 'string') {
              content.push({ type: 'text', text: textContent });
            }

            // Add image attachments
            for (const att of imageAttachments) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.type,
                  data: att.data,
                },
              });
            }

            return { role: m.role, content };
          }

          // Regular text-only message
          return { role: m.role, content: textContent };
        }),
      ];

      // Tool execution loop - continues until LLM stops requesting tools
      let continueLoop = true;
      let iterationCount = 0;
      while (continueLoop && iterationCount < AGENT_MAX_TOOL_ITERATIONS) {
        iterationCount++;

        if (tools.length > 0 && this.toolRunner) {
          // Use tool-enabled streaming generation
          const llmStartTime = Date.now();
          const response = await this.llmService.generateWithToolsStream(
            llmMessages,
            {
              onChunk: (chunk: string) => {
                fullResponse += chunk;
                channel.sendStreamChunk(streamId, chunk, conversationId);
              },
              onComplete: () => {
                // Stream complete
              },
              onError: (error: Error) => {
                console.error('[Supervisor] Stream error:', error);
              },
            },
            { tools }
          );
          const llmDuration = Date.now() - llmStartTime;

          // Accumulate usage
          turnUsage.llmDurationMs += llmDuration;
          turnUsage.inputTokens += response.usage?.inputTokens ?? 0;
          turnUsage.outputTokens += response.usage?.outputTokens ?? 0;
          if (response.model && !turnUsage.modelId) {
            turnUsage.modelId = response.model;
          }

          // Check if LLM requested tool use
          if (response.toolUse && response.toolUse.length > 0) {
            // Execute requested tools with citation extraction
            // callerId includes conversationId to ensure correct event routing
            const toolRequests = response.toolUse.map((tu) =>
              this.toolRunner!.createRequest(tu.id, tu.name, tu.input, undefined, callerId, { traceId })
            );

            const { results, citations } = await this.toolRunner.executeToolsWithCitations(toolRequests);

            // Collect citations from this execution
            if (citations.length > 0) {
              collectedSources.push(...citations);
            }

            // Check if delegate tool was called
            const delegateResult = results.find(r => r.toolName === 'delegate' && r.success);
            if (delegateResult) {
              // Check if we've already delegated for this message (prevent re-delegation on retries)
              if (this.delegatedMessages.has(message.id)) {
                console.log(`[${this.identity.name}] Already delegated for message ${message.id}, skipping`);
                // End stream and return without re-delegating
                this.endStreamWithCitations(channel, streamId, conversationId, undefined, turnUsage);
                if (unsubscribeTool) {
                  unsubscribeTool();
                }
                return;
              }

              // Mark this message as having delegation performed
              this.delegatedMessages.add(message.id);

              // Extract delegation params from tool output
              const delegationParams = delegateResult.output as {
                type: string;
                mission: string;
                rationale?: string;
                customName?: string;
                customEmoji?: string;
              };

              // End the stream before delegation (no citations for delegated tasks, but include usage)
              this.endStreamWithCitations(channel, streamId, conversationId, undefined, turnUsage);

              // Save any response content before delegation
              const reasoningMode = message.metadata?.reasoningMode as string | undefined;
              if (fullResponse.trim() && conversationId && turnId) {
                this.saveAssistantMessageWithContext(fullResponse.trim(), conversationId, turnId, { reasoningMode, usage: turnUsage });
              }

              // Delegation logging handled by handleDelegationFromTool

              // Unsubscribe from tool events BEFORE delegating
              // This prevents duplicate tool events when the sub-agent uses the same toolRunner
              if (unsubscribeTool) {
                unsubscribeTool();
                unsubscribeTool = undefined; // Prevent double unsubscribe in finally block
              }

              // Perform the delegation
              await this.handleDelegationFromTool(delegationParams, message, channel, conversationId, turnId, traceId);

              return;
            }

            // Add assistant message with tool use to conversation
            llmMessages.push({
              role: 'assistant',
              content: response.content || '',
              toolUse: response.toolUse,
            });

            // Add tool results as user message with content blocks (required by Anthropic)
            // Note: tool_result.content MUST be a string, not an object
            const toolResultBlocks = formatToolResultBlocks(results);
            llmMessages.push({
              role: 'user',
              content: toolResultBlocks,
            });

            // Continue loop to let LLM process tool results
          } else {
            // No more tool use - we're done
            continueLoop = false;
          }
        } else {
          // No tools available, use regular streaming
          const llmStartTime = Date.now();
          await this.llmService.generateStream(
            llmMessages,
            {
              onChunk: (chunk) => {
                fullResponse += chunk;
                channel.sendStreamChunk(streamId, chunk, conversationId);
              },
              onComplete: (response) => {
                // Stream complete - capture usage if available
                const llmDuration = Date.now() - llmStartTime;
                turnUsage.llmDurationMs += llmDuration;
                turnUsage.inputTokens += response.usage?.inputTokens ?? 0;
                turnUsage.outputTokens += response.usage?.outputTokens ?? 0;
                if (response.model && !turnUsage.modelId) {
                  turnUsage.modelId = response.model;
                }
              },
              onError: (error) => {
                throw error;
              },
            }
          );
          continueLoop = false;
        }
      }

      // Generate citations using post-hoc analysis
      const citationData = await this.buildCitationData(fullResponse, collectedSources);

      // End stream with citations and usage
      this.endStreamWithCitations(channel, streamId, conversationId, citationData, turnUsage);

      // Save the response (delegation is now handled via tool use, not markdown blocks)
      const reasoningMode = message.metadata?.reasoningMode as string | undefined;
      if (fullResponse.trim() && conversationId && turnId) {
        this.saveAssistantMessageWithContext(fullResponse, conversationId, turnId, { reasoningMode, citations: citationData, usage: turnUsage });
      }
    } catch (error) {
      this.endStreamWithCitations(channel, streamId, conversationId, undefined);
      // Log full error details server-side, send sanitized error to client
      let safeDetails = 'An internal error occurred. Please try again.';
      if (error instanceof Error) {
        const apiError = error as Error & { status?: number };
        if (apiError.status) {
          safeDetails = `Upstream API error (status ${apiError.status}).`;
        }
        console.error('[Supervisor] Full streaming error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      } else {
        console.error('[Supervisor] Full streaming error:', error);
      }
      await this.sendError('Streaming error', safeDetails, conversationId);
    } finally {
      // Cleanup tool event subscription
      if (unsubscribeTool) {
        unsubscribeTool();
      }
    }
  }

  private async handleDelegation(
    delegationJson: string,
    originalMessage: Message,
    channel: Channel,
    conversationId: string | undefined,
    turnId: string | undefined,
    traceId?: string
  ): Promise<void> {
    try {
      const delegation = JSON.parse(delegationJson.trim());
      const { type, mission, customName, customEmoji, rationale } = delegation;

      console.log(`[${this.identity.name}] Delegating to ${type}`);

      // Spawn appropriate agent (pass type explicitly for prompt loading)
      const agentId = await this.spawnAgent(
        {
          identity: this.createAgentIdentity(type, customName, customEmoji),
          mission,
        },
        type
      );

      const agent = this.subAgents.get(agentId);
      if (!agent) {
        throw new Error('Failed to spawn agent');
      }

      // Pass the conversationId, turnId, and traceId to the worker agent
      // Ensure we have a conversation (use existing or create new)
      const effectiveConversationId = conversationId || this.ensureConversation(null, originalMessage.content);
      agent.conversationId = effectiveConversationId;
      agent.turnId = turnId ?? null;
      if (traceId) agent.traceId = traceId;

      // Emit delegation event via MessageEventService (broadcasts AND persists)
      const messageEventService = getMessageEventService();
      messageEventService.setChannel(channel);
      messageEventService.emitDelegationEvent(
        {
          agentId: agent.identity.id,
          agentName: agent.identity.name,
          agentEmoji: agent.identity.emoji,
          agentType: type,
          mission,
          rationale,
        },
        effectiveConversationId,
        turnId
      );

      // Create task assignment
      await this.delegateTask(mission);

      // Have the sub-agent handle the message
      agent.registerChannel(channel);
      await agent.handleDelegatedTask(originalMessage, mission, channel);

    } catch (error) {
      console.error(`[${this.identity.name}] Delegation failed:`, error);
      // Fall back to handling directly
      const fallbackResponse = await this.generateResponse([
        ...this.conversationHistory.slice(-CONVERSATION_HISTORY_LIMIT),
        {
          id: uuid(),
          role: 'system',
          content: 'Delegation failed. Please respond directly to the user.',
          createdAt: new Date(),
        },
      ]);
      await this.sendMessage(fallbackResponse, { conversationId });
    }
  }

  /**
   * Handle delegation from the delegate tool (params already parsed)
   */
  private async handleDelegationFromTool(
    params: {
      type: string;
      mission: string;
      rationale?: string;
      customName?: string;
      customEmoji?: string;
    },
    originalMessage: Message,
    channel: Channel,
    conversationId: string | undefined,
    turnId: string | undefined,
    traceId?: string
  ): Promise<void> {
    const { type, mission, customName, customEmoji, rationale } = params;

    try {
      console.log(`[${this.identity.name}] Delegating to ${type}`);

      // Spawn appropriate agent (pass type explicitly for prompt loading)
      const agentId = await this.spawnAgent(
        {
          identity: this.createAgentIdentity(type, customName, customEmoji),
          mission,
        },
        type
      );

      const agent = this.subAgents.get(agentId);
      if (!agent) {
        throw new Error('Failed to spawn agent');
      }

      // Pass the conversationId, turnId, and traceId to the worker agent
      // Ensure we have a conversation (use existing or create new)
      const effectiveConversationId = conversationId || this.ensureConversation(null, originalMessage.content);
      agent.conversationId = effectiveConversationId;
      agent.turnId = turnId ?? null;
      if (traceId) agent.traceId = traceId;

      // Emit delegation event via MessageEventService (broadcasts AND persists)
      const messageEventService = getMessageEventService();
      messageEventService.setChannel(channel);
      messageEventService.emitDelegationEvent(
        {
          agentId: agent.identity.id,
          agentName: agent.identity.name,
          agentEmoji: agent.identity.emoji,
          agentType: type,
          mission,
          rationale,
        },
        effectiveConversationId,
        turnId
      );

      // Create task assignment
      await this.delegateTask(mission);

      // Have the sub-agent handle the message
      agent.registerChannel(channel);
      await agent.handleDelegatedTask(originalMessage, mission, channel);

    } catch (error) {
      console.error(`[${this.identity.name}] Delegation failed:`, error);
      // Fall back to handling directly
      const fallbackResponse = await this.generateResponse([
        ...this.conversationHistory.slice(-CONVERSATION_HISTORY_LIMIT),
        {
          id: uuid(),
          role: 'system',
          content: 'Delegation failed. Please respond directly to the user.',
          createdAt: new Date(),
        },
      ]);
      await this.sendMessage(fallbackResponse, { conversationId });
    }
  }

  private createAgentIdentity(
    type: string,
    customName?: string,
    customEmoji?: string
  ): AgentIdentity {
    const template = this.agentRegistry.getSpecialistTemplate(type);

    if (template) {
      return {
        ...template.identity,
        id: `${type}-${uuid().slice(0, 8)}`,
        name: customName || template.identity.name,
        emoji: customEmoji || template.identity.emoji,
      };
    }

    // Custom agent
    return {
      id: `custom-${uuid().slice(0, 8)}`,
      name: customName || 'Assistant',
      emoji: customEmoji || '🔧',
      role: 'worker',
      description: 'Custom worker agent',
    };
  }

  async spawnAgent(partialConfig: Partial<AgentConfig>, agentType?: string): Promise<string> {
    // Use explicit type if provided, otherwise try to infer from identity name
    const type = agentType
      || (partialConfig.identity?.role === 'specialist'
        ? this.agentRegistry.findSpecialistTypeByName(partialConfig.identity?.name || '') || 'custom'
        : 'custom');

    // Load prompt from .md file via registry
    const systemPrompt = this.agentRegistry.loadAgentPrompt(type) || '';

    // Get tool access for this specialist type from registry
    const toolAccess = this.agentRegistry.getToolAccessForSpecialist(type);

    const config: AgentConfig = {
      identity: partialConfig.identity || {
        id: `worker-${uuid().slice(0, 8)}`,
        name: 'Worker',
        emoji: '⚙️',
        role: 'worker',
        description: 'General worker agent',
      },
      capabilities: {
        canSpawnAgents: false,
        canAccessTools: toolAccess,
        canUseChannels: ['*'],
        maxConcurrentTasks: 1,
      },
      systemPrompt,
      parentId: this.identity.id,
      mission: partialConfig.mission,
      ...partialConfig,
    };

    const agent = new WorkerAgent(config, this.llmService, type);
    agent.setRegistry(this.agentRegistry);

    // Set workflow context for deep research agents
    if (type === AGENT_IDS.LEAD) {
      agent.setWorkflowId(DEEP_RESEARCH_WORKFLOW_ID);
    }

    // Set workflow context for self-coding agents
    if (type === CODING_AGENT_IDS.LEAD) {
      agent.setWorkflowId(SELF_CODING_WORKFLOW_ID);
    }

    // Pass the tool runner to worker agents so they can use MCP, skills, and native tools
    if (this.toolRunner) {
      agent.setToolRunner(this.toolRunner);
    }

    // Pass the skill manager to worker agents so they can see and use skills
    // Note: Workers do NOT inherit excludedSkillSources - they have full access to skills
    if (this.skillManager) {
      agent.setSkillManager(this.skillManager);
    }

    // Set allowed skills if this agent type has restrictions
    const allowedSkills = this.agentRegistry.getAllowedSkillsForSpecialist(type);
    if (allowedSkills) {
      agent.setAllowedSkills(allowedSkills);
    }

    // Pass the RAG data manager to worker agents
    if (this.ragDataManager) {
      agent.setRagDataManager(this.ragDataManager);
    }

    await agent.init();
    this.subAgents.set(agent.identity.id, agent);
    this.agentRegistry.registerAgent(agent);

    return agent.identity.id;
  }

  async terminateAgent(agentId: string): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      await agent.shutdown();
      this.subAgents.delete(agentId);
      this.agentRegistry.unregisterAgent(agentId);
      console.log(`[${this.identity.name}] Terminated agent: ${agentId}`);
    }
  }

  getSubAgents(): string[] {
    return Array.from(this.subAgents.keys());
  }

  async delegateTask(task: string, requirements?: string): Promise<TaskAssignment> {
    const assignment: TaskAssignment = {
      id: uuid(),
      description: task,
      assignedTo: '', // Will be set when agent picks it up
      assignedBy: this.identity.id,
      status: 'pending',
      createdAt: new Date(),
    };

    this.tasks.set(assignment.id, assignment);
    return assignment;
  }

  getTaskStatus(taskId: string): TaskAssignment | undefined {
    return this.tasks.get(taskId);
  }

  protected async handleAgentCommunication(comm: AgentCommunication): Promise<void> {
    switch (comm.type) {
      case 'task_result': {
        const payload = comm.payload as TaskResultPayload;
        const task = this.tasks.get(payload.taskId);
        if (task) {
          task.status = 'completed';
          task.result = payload.result;
          task.completedAt = new Date();
        }
        break;
      }
      case 'status_update': {
        // Status updates from sub-agents - no logging needed
        break;
      }
    }
  }

  /**
   * Ensure a conversation exists for the given conversationId.
   * If conversationId is provided and valid, returns it after updating timestamp.
   * If conversationId is null, finds a recent conversation or creates a new one.
   * Does NOT set instance state - returns the conversationId to use.
   *
   * @param currentConversationId - The current conversationId from the request (or null)
   * @param firstMessageContent - Content of the first message (for title generation)
   * @returns The conversationId to use for this request
   */
  private ensureConversation(currentConversationId: string | null, firstMessageContent?: string | unknown[]): string {
    const db = getDb();

    // Helper to generate title from message content
    const generateTitleFromContent = (content: string | unknown[] | undefined): string | null => {
      if (!content) return null;
      const textContent = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text).join(' ')
          : '';
      if (!textContent) return null;
      return textContent.substring(0, CONVERSATION_TITLE_PREVIEW_LENGTH).trim() + (textContent.length > CONVERSATION_TITLE_PREVIEW_LENGTH ? '...' : '');
    };

    // If we have a conversation, update its timestamp and return it
    if (currentConversationId) {
      const conv = db.conversations.findById(currentConversationId);
      // If conversation has default title and we have message content, update the title
      if (conv && conv.title === 'New Conversation' && !conv.manuallyNamed && firstMessageContent) {
        const newTitle = generateTitleFromContent(firstMessageContent);
        if (newTitle) {
          db.conversations.update(currentConversationId, {
            title: newTitle,
            updatedAt: new Date().toISOString(),
          });
          // Notify frontend about the title update
          if (this.channel) {
            this.channel.broadcast({
              type: 'conversation_updated',
              conversation: { id: currentConversationId, title: newTitle, updatedAt: new Date().toISOString() },
            });
          }
          return currentConversationId;
        }
      }
      db.conversations.update(currentConversationId, { updatedAt: new Date().toISOString() });
      return currentConversationId;
    }

    // Check for recent conversation
    const recentConversation = db.conversations.findRecent(RECENT_CONVERSATION_WINDOW_MS);

    if (recentConversation) {
      const recentId = recentConversation.id;
      // If recent conversation has default title and we have message content, update the title
      if (recentConversation.title === 'New Conversation' && !recentConversation.manuallyNamed && firstMessageContent) {
        const newTitle = generateTitleFromContent(firstMessageContent);
        if (newTitle) {
          db.conversations.update(recentId, {
            title: newTitle,
            updatedAt: new Date().toISOString(),
          });
          // Notify frontend about the title update
          if (this.channel) {
            this.channel.broadcast({
              type: 'conversation_updated',
              conversation: { id: recentId, title: newTitle, updatedAt: new Date().toISOString() },
            });
          }
          return recentId;
        }
      }
      db.conversations.update(recentId, { updatedAt: new Date().toISOString() });
      return recentId;
    }

    // Create a new conversation
    const id = uuid();
    const now = new Date().toISOString();
    // Generate temporary title from first message (truncate to 30 chars)
    // Will be auto-named with a better title after 3 messages
    const title = generateTitleFromContent(firstMessageContent) || 'New Conversation';

    db.conversations.create({
      id,
      title,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    // Notify frontend about the new conversation
    if (this.channel) {
      this.channel.broadcast({
        type: 'conversation_created',
        conversation: {
          id,
          title,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return id;
  }

  /**
   * Load conversation history from database.
   * Returns the history as an array - does NOT set instance state.
   * This is request-scoped and called at the start of handleMessage.
   */
  private loadConversationHistory(conversationId: string | null): Message[] {
    if (!conversationId) {
      return [];
    }

    const db = getDb();
    const dbMessages = db.messages.findByConversationId(conversationId);

    // Update message count for auto-naming
    this.conversationMessageCount.set(conversationId, dbMessages.length);

    // Convert DB messages to Message format for in-memory history
    // Filter out 'tool' role messages - these are UI display events, not LLM conversation turns.
    // Tool results during a conversation are handled inline and not persisted as separate messages.
    // Also filter out delegation messages which are UI-only.
    return dbMessages
      .filter((m) => {
        // Skip tool events (UI display only)
        if (m.role === 'tool') return false;
        // Skip delegation events (UI display only)
        if (m.metadata?.type === 'delegation') return false;
        // Skip task_run markers (UI display only)
        if (m.metadata?.type === 'task_run') return false;
        return true;
      })
      .map((m) => ({
        id: m.id,
        role: m.role as Message['role'],
        content: m.content,
        createdAt: new Date(m.createdAt),
        metadata: m.metadata,
      }));
  }

  /**
   * Low-level DB persistence for any message (user or assistant).
   * Supervisor-specific because it handles conversation lifecycle:
   * - Calls ensureConversation() to get/create conversationId
   * - Strips attachment base64 data from metadata
   * - Calls incrementMessageCount() for auto-naming
   *
   * Workers don't need this because their conversationId is set by
   * supervisor when spawning, and they don't receive user messages.
   *
   * @param message - The message to save
   * @param currentConversationId - The current conversationId (or null to create/find one)
   * @param turnId - The turnId for this message
   * @returns The conversationId used (may be different from input if new conversation was created)
   */
  private saveMessageInternal(message: Message, currentConversationId: string | null, turnId: string): string {
    try {
      const db = getDb();
      const conversationId = this.ensureConversation(
        currentConversationId,
        message.role === 'user' ? message.content : undefined
      );

      // Include attachment info in metadata (without base64 data)
      const metadata = {
        ...(message.metadata || {}),
        attachments: message.attachments?.map(a => ({
          name: a.name,
          type: a.type,
          size: a.size,
        })),
      };

      db.messages.create({
        id: message.id,
        conversationId,
        role: message.role,
        content: message.content,
        metadata,
        createdAt: message.createdAt.toISOString(),
        turnId,
      });

      // Track message count for auto-naming
      this.incrementMessageCount(conversationId);

      return conversationId;
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to save message:`, error);
      // Return whatever we had, even if save failed
      return currentConversationId || 'error';
    }
  }

  /**
   * Save an assistant message to conversation history and database.
   * Requires conversationId and turnId to be passed explicitly (request-scoped).
   */
  protected saveAssistantMessageWithContext(
    content: string,
    conversationId: string,
    turnId: string,
    options?: { citations?: StoredCitationData; reasoningMode?: string; usage?: AgentTurnUsage }
  ): void {
    const metadata: Record<string, unknown> = {
      agentId: this.identity.id,
      agentName: this.identity.name,
      ...(options?.reasoningMode && { reasoningMode: options.reasoningMode }),
    };

    // Include citations in metadata if present
    if (options?.citations && options.citations.sources.length > 0) {
      metadata.citations = options.citations;
    }

    // Include usage in metadata if present
    if (options?.usage) {
      metadata.usage = options.usage;
    }

    const message: Message = {
      id: uuid(),
      role: 'assistant',
      content,
      metadata,
      createdAt: new Date(),
    };
    this.conversationHistory.push(message);
    this.saveMessageInternal(message, conversationId, turnId);
  }

  /**
   * @deprecated Use saveAssistantMessageWithContext instead for request-scoped conversationId.
   * This override exists for compatibility with base class but should not be used directly.
   */
  protected override saveAssistantMessage(content: string, options?: { citations?: StoredCitationData; reasoningMode?: string }): void {
    // This should not be called directly in supervisor - we need conversationId context.
    // Log a warning if this is ever reached without proper context.
    console.warn(`[${this.identity.name}] saveAssistantMessage called without context - this may cause issues`);
    const message: Message = {
      id: uuid(),
      role: 'assistant',
      content,
      metadata: {
        agentId: this.identity.id,
        agentName: this.identity.name,
        ...(options?.reasoningMode && { reasoningMode: options.reasoningMode }),
        ...(options?.citations && options.citations.sources.length > 0 && { citations: options.citations }),
      },
      createdAt: new Date(),
    };
    this.conversationHistory.push(message);
    // Can't save to DB without conversationId - just add to in-memory history
  }

  /**
   * Auto-generate a conversation title based on the first few messages
   * Skips conversations that have been manually named by the user
   */
  private async autoNameConversation(conversationId: string): Promise<void> {
    try {
      const db = getDb();

      // Skip if conversation was manually named
      const conversation = db.conversations.findById(conversationId);
      if (conversation?.manuallyNamed) {
        console.log(`[${this.identity.name}] Skipping auto-name for manually named conversation`);
        return;
      }

      const messages = db.messages.findByConversationId(conversationId, { limit: AUTO_NAME_MESSAGES_TO_LOAD });

      if (messages.length < AUTO_NAME_MESSAGE_THRESHOLD) return;

      // Build context from messages (database messages always have string content)
      const context = messages
        .map((m) => `${m.role}: ${m.content.substring(0, AUTO_NAME_CONTENT_PREVIEW_LENGTH)}`)
        .join('\n');

      // Use fast LLM to generate a title
      const response = await this.llmService.quickGenerate(
        [
          {
            role: 'user',
            content: `Generate a short, descriptive title (3-6 words max) for a conversation that starts like this:\n\n${context}\n\nRespond with ONLY the title, no quotes or punctuation.`,
          },
        ],
        { maxTokens: AUTO_NAME_LLM_MAX_TOKENS }
      );

      const title = response.content.trim().substring(0, CONVERSATION_TITLE_MAX_LENGTH);

      if (title) {
        const now = new Date().toISOString();
        db.conversations.update(conversationId, { title, updatedAt: now });

        // Notify frontend about the updated title
        if (this.channel) {
          this.channel.broadcast({
            type: 'conversation_updated',
            conversation: {
              id: conversationId,
              title,
              updatedAt: now,
            },
          });
        }

        console.log(`[${this.identity.name}] Auto-named conversation: "${title}"`);
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to auto-name conversation:`, error);
    }
  }

  private incrementMessageCount(conversationId: string): void {
    const count = (this.conversationMessageCount.get(conversationId) || 0) + 1;
    this.conversationMessageCount.set(conversationId, count);

    // Auto-name after reaching message threshold
    if (count === AUTO_NAME_MESSAGE_THRESHOLD) {
      // Run async without blocking
      this.autoNameConversation(conversationId).catch((err) => {
        console.error(`[${this.identity.name}] Auto-naming error:`, err);
      });
    }
  }


}
