import { v4 as uuid } from 'uuid';
import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMResponseWithTools,
  StreamCallbacks,
} from './types.js';
import { DATA_SIZE_THRESHOLDS } from './types.js';
import { LLM_SUMMARIZE_MAX_TOKENS, LLM_TASK_CONFIG_MAX_TOKENS } from '../constants.js';
import type { TraceStore } from '../tracing/trace-store.js';
import type { TraceContext, LlmWorkload } from '../tracing/types.js';

export interface LLMServiceConfig {
  main: LLMProvider;
  fast: LLMProvider;
  traceStore?: TraceStore;
}

export class LLMService {
  private main: LLMProvider;
  private fast: LLMProvider;
  private traceStore: TraceStore | null;

  // Context stack for associating LLM calls with traces/spans
  private contextStack: TraceContext[] = [];

  constructor(config: LLMServiceConfig) {
    this.main = config.main;
    this.fast = config.fast;
    this.traceStore = config.traceStore || null;
  }

  // ============================================================
  // Trace context management
  // ============================================================

  /**
   * Push a trace context. Called by agents before making LLM calls.
   */
  pushContext(ctx: TraceContext): void {
    this.contextStack.push(ctx);
  }

  /**
   * Pop the most recent trace context.
   */
  popContext(): void {
    this.contextStack.pop();
  }

  /**
   * Get the current (top of stack) trace context.
   */
  private getContext(): TraceContext | undefined {
    return this.contextStack.length > 0
      ? this.contextStack[this.contextStack.length - 1]
      : undefined;
  }

  /**
   * Record start of an LLM call with the trace store.
   * @param callerName - Optional fallback caller name when no agent context is available
   */
  private traceStart(workload: LlmWorkload, provider: LLMProvider, messages: LLMMessage[], options?: LLMOptions, purpose?: string, callerName?: string): string | null {
    if (!this.traceStore) return null;
    const ctx = this.getContext();
    const callId = uuid();

    // Serialize toolChoice (can be string or object)
    let toolChoiceStr: string | undefined;
    if (options?.toolChoice) {
      toolChoiceStr = typeof options.toolChoice === 'string'
        ? options.toolChoice
        : JSON.stringify(options.toolChoice);
    }

    this.traceStore.recordLlmCallStart({
      id: callId,
      traceId: ctx?.traceId,
      spanId: ctx?.spanId,
      workload,
      provider: provider.name,
      model: provider.model,
      messages: messages as unknown[],
      systemPrompt: options?.systemPrompt,
      tools: options?.tools as unknown[],
      toolChoice: toolChoiceStr,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      reasoningEffort: options?.reasoningEffort,
      callerAgentId: ctx?.agentId,
      callerAgentName: ctx?.agentName || callerName,
      callerPurpose: purpose || ctx?.purpose,
      conversationId: ctx?.conversationId,
    });
    return callId;
  }

  /**
   * Record completion of an LLM call.
   */
  private traceComplete(callId: string | null, response: LLMResponse | LLMResponseWithTools, streamChunks?: Array<{ text: string; timestamp: string }>): void {
    if (!this.traceStore || !callId) return;
    const withTools = response as LLMResponseWithTools;
    this.traceStore.completeLlmCall(callId, {
      content: response.content,
      toolUse: withTools.toolUse,
      stopReason: withTools.stopReason || response.finishReason,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      streamChunks,
    });
  }

  /**
   * Record failure of an LLM call.
   */
  private traceFail(callId: string | null, error: unknown): void {
    if (!this.traceStore || !callId) return;
    this.traceStore.failLlmCall(callId, error);
  }

  // ============================================================
  // Data processing
  // ============================================================

  /**
   * Process data according to size-based strategy:
   * - Small (<3000 chars): Return as-is
   * - Medium (3000-50000 chars): Summarize using Fast LLM
   * - Large (>50000 chars): Requires RAG (handled externally)
   */
  async processData(
    data: string,
    context?: string
  ): Promise<{ processed: string; strategy: 'direct' | 'summarized' | 'rag-required' }> {
    const size = data.length;

    if (size <= DATA_SIZE_THRESHOLDS.SMALL) {
      return { processed: data, strategy: 'direct' };
    }

    if (size <= DATA_SIZE_THRESHOLDS.MEDIUM) {
      const summary = await this.summarize(data, context);
      return { processed: summary, strategy: 'summarized' };
    }

    // For large data, signal that RAG is needed
    return {
      processed: `[Data too large: ${size} characters. RAG processing required.]`,
      strategy: 'rag-required',
    };
  }

  /**
   * Summarize text using the Fast LLM
   * @param callerName - Optional caller identifier for tracing (defaults to "System")
   */
  async summarize(text: string, context?: string, callerName?: string): Promise<string> {
    const systemPrompt = `You are a precise summarizer. Summarize the following content into no more than 3000 characters while preserving key information and structure.${context ? ` Context: ${context}` : ''}`;

    const messages: LLMMessage[] = [{ role: 'user', content: text }];
    const options = { systemPrompt, maxTokens: LLM_SUMMARIZE_MAX_TOKENS };

    const callId = this.traceStart('fast', this.fast, messages, options, 'summarize', callerName || 'System');
    try {
      const response = await this.fast.complete(messages, options);
      this.traceComplete(callId, response);
      return response.content;
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Generate response using Main LLM
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const callId = this.traceStart('main', this.main, messages, options, 'generate');
    try {
      const response = await this.main.complete(messages, options);
      this.traceComplete(callId, response);
      return response;
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Generate response with tool use support
   * Requires a provider that supports completeWithTools (e.g., Anthropic)
   */
  async generateWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const toolCount = options?.tools?.length || 0;

    // Check if provider supports tool use
    if (typeof this.main.completeWithTools === 'function') {
      const callId = this.traceStart('main', this.main, messages, options, 'generate_with_tools');
      try {
        const startTime = Date.now();
        const response = await this.main.completeWithTools(messages, options);
        const duration = Date.now() - startTime;

        // Log LLM API call details
        const toolNames = response.toolUse?.map(t => t.name).join(', ') || 'none';
        const stopDesc = response.stopReason === 'tool_use' ? 'tool_use (LLM wants to call tools)' : response.stopReason || 'end_turn (response complete)';
        console.log(`[LLMService] API call: model=${this.main.model}, duration=${duration}ms, tools_available=${toolCount}, stop_reason=${stopDesc}, tools_requested=${toolNames}`);

        this.traceComplete(callId, response);
        return response;
      } catch (error) {
        this.traceFail(callId, error);
        throw error;
      }
    }

    // Fallback: Use regular complete without tools
    console.warn('[LLMService] ⚠ Provider does not support completeWithTools, tools unavailable');
    const callId = this.traceStart('main', this.main, messages, options, 'generate_with_tools');
    try {
      const response = await this.main.complete(messages, options);
      const result = { ...response, toolUse: undefined, stopReason: 'end_turn' as const };
      this.traceComplete(callId, result);
      return result;
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Stream response using Main LLM
   * Assembles streaming chunks into a complete response for tracing.
   */
  async generateStream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions
  ): Promise<void> {
    const callId = this.traceStart('main', this.main, messages, options, 'generate_stream');
    const streamChunks: Array<{ text: string; timestamp: string }> = [];
    let assembledContent = '';

    // Wrap callbacks to capture streaming content
    const tracedCallbacks: StreamCallbacks = {
      onChunk: (chunk: string) => {
        assembledContent += chunk;
        if (this.traceStore) {
          streamChunks.push({ text: chunk, timestamp: new Date().toISOString() });
        }
        callbacks.onChunk(chunk);
      },
      onComplete: (response: LLMResponse) => {
        // Use the assembled content if the response doesn't have it
        const finalResponse = {
          ...response,
          content: response.content || assembledContent,
        };
        this.traceComplete(callId, finalResponse, streamChunks.length > 0 ? streamChunks : undefined);
        callbacks.onComplete(response);
      },
      onError: (error: Error) => {
        this.traceFail(callId, error);
        callbacks.onError(error);
      },
    };

    if (this.main.stream) {
      return this.main.stream(messages, tracedCallbacks, options);
    }
    // Fallback to non-streaming if not supported
    try {
      const response = await this.main.complete(messages, options);
      tracedCallbacks.onChunk(response.content);
      tracedCallbacks.onComplete(response);
    } catch (error) {
      tracedCallbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stream response with tool use support.
   * Streams text chunks while accumulating tool use blocks.
   * Assembles all chunks into a complete response for tracing - NO raw SSE events stored.
   */
  async generateWithToolsStream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks & {
      onToolUse?: (toolUse: LLMResponseWithTools['toolUse']) => void;
    },
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const callId = this.traceStart('main', this.main, messages, options, 'generate_with_tools_stream');
    const streamChunks: Array<{ text: string; timestamp: string }> = [];
    let assembledContent = '';

    // Wrap callbacks to capture assembled response
    const tracedCallbacks: StreamCallbacks & { onToolUse?: (toolUse: LLMResponseWithTools['toolUse']) => void } = {
      onChunk: (chunk: string) => {
        assembledContent += chunk;
        if (this.traceStore) {
          streamChunks.push({ text: chunk, timestamp: new Date().toISOString() });
        }
        callbacks.onChunk(chunk);
      },
      onComplete: (response: LLMResponse) => {
        callbacks.onComplete(response);
      },
      onError: (error: Error) => {
        callbacks.onError(error);
      },
      onToolUse: callbacks.onToolUse,
    };

    if (typeof this.main.streamWithTools === 'function') {
      console.log(`[LLMService] generateWithToolsStream: ${this.main.name} (streaming)`);
      try {
        const response = await this.main.streamWithTools(messages, tracedCallbacks, options);
        // Record the assembled response (not raw chunks)
        this.traceComplete(callId, {
          ...response,
          content: response.content || assembledContent,
        }, streamChunks.length > 0 ? streamChunks : undefined);
        return response;
      } catch (error) {
        this.traceFail(callId, error);
        throw error;
      }
    }

    // Fallback to non-streaming if streamWithTools not supported
    console.log(`[LLMService] generateWithToolsStream: ${this.main.name} (fallback to non-streaming)`);
    try {
      const response = await this.generateWithTools(messages, options);
      callbacks.onChunk(response.content);
      if (response.toolUse && callbacks.onToolUse) {
        callbacks.onToolUse(response.toolUse);
      }
      callbacks.onComplete(response);
      // The generateWithTools call above already traced - don't double-trace
      // But we need to fail the streaming trace since generateWithTools created its own
      if (callId) {
        // Mark this streaming call as completed with the same data
        this.traceComplete(callId, response);
      }
      return response;
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Check if streaming is supported
   */
  supportsStreaming(): boolean {
    return typeof this.main.stream === 'function';
  }

  /**
   * Quick generation using Fast LLM (for simple tasks)
   * @param callerName - Optional caller identifier for tracing (defaults to "System")
   */
  async quickGenerate(
    messages: LLMMessage[],
    options?: LLMOptions,
    callerName?: string
  ): Promise<LLMResponse> {
    const callId = this.traceStart('fast', this.fast, messages, options, 'quick_generate', callerName || 'System');
    try {
      const response = await this.fast.complete(messages, options);
      this.traceComplete(callId, response);
      return response;
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Parse natural language config (.md) into structured JSON config
   */
  async parseTaskConfig(mdContent: string, existingConfig?: string): Promise<string> {
    const systemPrompt = `You are a task configuration parser. Convert the natural language task description into a structured JSON configuration.

The JSON should follow this schema:
{
  "name": "string - task name",
  "description": "string - what the task does",
  "trigger": {
    "type": "schedule" | "event" | "manual",
    "schedule": "cron expression if type is schedule",
    "event": "event name if type is event"
  },
  "tools": [
    {
      "type": "string - tool name without prefix (e.g. 'user.lottery', 'web_search', 'mcp.github.list_repos')",
      "params": {}
    }
  ],
  "mcp": {
    "whitelist": ["allowed MCP servers"],
    "blacklist": ["blocked MCP servers"]
  },
  "skills": {
    "whitelist": ["allowed skills"],
    "blacklist": ["blocked skills"]
  },
  "notifications": {
    "onSuccess": boolean,
    "onError": boolean,
    "channels": ["notification channels"]
  }
}

Only output valid JSON, no explanations.`;

    const userMessage = existingConfig
      ? `Update this existing config:\n${existingConfig}\n\nBased on this description:\n${mdContent}`
      : `Convert this task description to JSON config:\n${mdContent}`;

    const messages: LLMMessage[] = [{ role: 'user', content: userMessage }];
    const options = { systemPrompt, maxTokens: LLM_TASK_CONFIG_MAX_TOKENS };

    const callId = this.traceStart('main', this.main, messages, options, 'parse_task_config');
    try {
      const response = await this.main.complete(messages, options);
      this.traceComplete(callId, response);

      // Extract JSON from response (handle potential markdown code blocks)
      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }

      // Validate JSON
      JSON.parse(jsonStr.trim());

      return jsonStr.trim();
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  /**
   * Parse mission .md into structured JSON config for the Mission system
   */
  async parseMissionConfig(mdContent: string): Promise<string> {
    const systemPrompt = `You are a mission configuration parser. Convert a natural language mission description into structured JSON.

The JSON should follow this schema:
{
  "name": "string - mission name",
  "description": "string - mission description",
  "cadence": "cron expression for check cycle, or null if not specified",
  "scope": "string - scope description",
  "agents": {
    "lead": { "model": "string" },
    "workers": [{ "type": "string", "config": {} }]
  },
  "pillars": [
    {
      "name": "string",
      "slug": "string - kebab-case",
      "description": "string",
      "metrics": [
        { "name": "string", "target": "string", "current": "", "unit": "string" }
      ],
      "strategies": [
        { "description": "string" }
      ]
    }
  ]
}

Only output valid JSON, no explanations.`;

    const messages: LLMMessage[] = [{ role: 'user', content: `Convert this mission description to JSON config:\n${mdContent}` }];
    const options = { systemPrompt, maxTokens: LLM_TASK_CONFIG_MAX_TOKENS };

    const callId = this.traceStart('main', this.main, messages, options, 'parse_mission_config');
    try {
      const response = await this.main.complete(messages, options);
      this.traceComplete(callId, response);

      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

      JSON.parse(jsonStr.trim());
      return jsonStr.trim();
    } catch (error) {
      this.traceFail(callId, error);
      throw error;
    }
  }

  getMainModel(): string {
    return this.main.model;
  }

  getFastModel(): string {
    return this.fast.model;
  }
}
