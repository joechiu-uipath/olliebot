/**
 * OllieBot Promptfoo Custom Provider
 *
 * Wraps OllieBot's agent loop as a black-box provider for Promptfoo evaluation.
 * Promptfoo sends user input; OllieBot handles system prompt assembly, tool calls,
 * and multi-turn loops internally; only the final output is returned.
 *
 * Usage in promptfoo config:
 *   providers: ['file://src/evaluation/promptfoo-provider.ts']
 *
 * Or with config:
 *   providers: [{
 *     id: 'file://src/evaluation/promptfoo-provider.ts',
 *     config: { maxToolIterations: 5, target: 'supervisor' }
 *   }]
 */

import { config as loadEnv } from 'dotenv';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage } from '../llm/types.js';
import type { ToolRunner } from '../tools/runner.js';
import { PromptLoader } from './prompt-loader.js';
import type { TargetType } from './types.js';

// Load environment variables for API keys
loadEnv();

// Promptfoo types (inline to avoid import resolution issues with promptfoo's bundled types)
interface ProviderOptions {
  id?: string;
  config?: Record<string, unknown>;
  label?: string;
}

interface ProviderResponse {
  output?: string | unknown;
  error?: string;
  tokenUsage?: { total: number; prompt: number; completion: number };
  cost?: number;
  metadata?: Record<string, unknown>;
}

interface CallApiContext {
  vars: Record<string, string | object>;
  prompt?: unknown;
  logger?: unknown;
}

/**
 * Configuration for the OllieBot provider.
 * Passed via the `config` field in promptfoo config.
 */
export interface OllieBotProviderConfig {
  /** Which agent target to evaluate: 'supervisor', 'sub-agent:researcher', etc. */
  target?: TargetType;
  /** Max tool call iterations before stopping */
  maxToolIterations?: number;
  /** LLM provider override (default: uses MAIN_PROVIDER from .env) */
  provider?: string;
  /** LLM model override (default: uses MAIN_MODEL from .env) */
  model?: string;
}

// Lazy-initialized singletons (created on first callApi)
let llmService: LLMService | null = null;
let toolRunner: ToolRunner | null = null;

/**
 * Initialize LLMService and ToolRunner from environment config.
 * Mirrors the bootstrap in src/index.ts but minimal — no server, no channels.
 */
async function ensureInitialized(providerConfig: OllieBotProviderConfig): Promise<{
  llmService: LLMService;
  toolRunner: ToolRunner;
}> {
  if (llmService && toolRunner) {
    return { llmService, toolRunner };
  }

  // Dynamic imports to avoid circular dependency issues
  const { LLMService: LLMServiceClass } = await import('../llm/service.js');
  const { AnthropicProvider } = await import('../llm/anthropic.js');
  const { OpenAIProvider } = await import('../llm/openai.js');
  const { GoogleProvider } = await import('../llm/google.js');
  const { ToolRunner: ToolRunnerClass } = await import('../tools/runner.js');

  const mainProviderName = providerConfig.provider || process.env.MAIN_PROVIDER || 'anthropic';
  const mainModel = providerConfig.model || process.env.MAIN_MODEL || 'claude-sonnet-4-5-20250929';
  const fastProviderName = process.env.FAST_PROVIDER || mainProviderName;
  const fastModel = process.env.FAST_MODEL || mainModel;

  function createProvider(name: string, model: string) {
    switch (name) {
      case 'anthropic':
        return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, model);
      case 'openai':
        return new OpenAIProvider(process.env.OPENAI_API_KEY!, model);
      case 'google':
        return new GoogleProvider(process.env.GOOGLE_API_KEY!, model);
      default:
        throw new Error(`Unsupported provider: ${name}. Use anthropic, openai, or google.`);
    }
  }

  llmService = new LLMServiceClass({
    main: createProvider(mainProviderName, mainModel),
    fast: createProvider(fastProviderName, fastModel),
  });

  toolRunner = new ToolRunnerClass();

  return { llmService, toolRunner };
}

/**
 * The main provider class that Promptfoo instantiates.
 */
class OllieBotProvider {
  private config: OllieBotProviderConfig;

  constructor(options: ProviderOptions) {
    this.config = (options.config || {}) as OllieBotProviderConfig;
  }

  id(): string {
    const target = this.config.target || 'supervisor';
    return `olliebot:${target}`;
  }

  async callApi(prompt: string, _context?: CallApiContext): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      const { llmService: svc, toolRunner: tools } = await ensureInitialized(this.config);

      const target: TargetType = this.config.target || 'supervisor';
      const maxToolIterations = this.config.maxToolIterations || 10;

      // Load system prompt using the existing PromptLoader
      const promptLoader = new PromptLoader();
      const systemPrompt = promptLoader.loadForTarget(target);

      // Build messages — prompt is the user message from the test case
      const messages: LLMMessage[] = [{ role: 'user', content: prompt }];

      // Get tool definitions from the tool runner
      const llmTools = tools.getToolsForLLM();

      // Run the agentic tool loop (mirrors EvaluationRunner.executeWithTools)
      let currentMessages: LLMMessage[] = [...messages];
      let finalResponse = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let iterations = 0;
      const toolCallLog: Array<{ name: string; input: Record<string, unknown> }> = [];

      while (iterations < maxToolIterations) {
        iterations++;

        const response = await svc.generateWithTools(currentMessages, {
          systemPrompt,
          tools: llmTools,
          maxTokens: 4096,
        });

        if (response.usage) {
          totalInputTokens += response.usage.inputTokens;
          totalOutputTokens += response.usage.outputTokens;
        }

        // No tool use — we're done
        if (!response.toolUse || response.toolUse.length === 0 || response.stopReason === 'end_turn') {
          finalResponse = response.content;
          break;
        }

        // Log and mock tool calls (eval mode — no real tool execution)
        const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];

        for (const toolUse of response.toolUse) {
          toolCallLog.push({ name: toolUse.name, input: toolUse.input });
          toolResults.push({
            tool_use_id: toolUse.id,
            content: JSON.stringify({ result: `[Mocked output for ${toolUse.name}]` }),
          });
        }

        // Append assistant message with tool use
        currentMessages.push({
          role: 'assistant',
          content: response.content,
          toolUse: response.toolUse,
        });

        // Append tool results
        for (const toolResult of toolResults) {
          currentMessages.push({
            role: 'user',
            content: JSON.stringify({
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              content: toolResult.content,
              is_error: toolResult.is_error,
            }),
          });
        }

        if (response.content && response.stopReason !== 'tool_use') {
          finalResponse = response.content;
        }
      }

      if (iterations >= maxToolIterations && !finalResponse) {
        finalResponse = '[Max tool iterations reached without final response]';
      }

      const latencyMs = Date.now() - startTime;
      const totalTokens = totalInputTokens + totalOutputTokens;

      return {
        output: finalResponse,
        tokenUsage: {
          total: totalTokens,
          prompt: totalInputTokens,
          completion: totalOutputTokens,
        },
        metadata: {
          toolCalls: toolCallLog,
          toolCallCount: toolCallLog.length,
          iterations,
          target: this.config.target || 'supervisor',
          latencyMs,
        },
      };
    } catch (error) {
      return {
        error: `OllieBot provider error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export default OllieBotProvider;
