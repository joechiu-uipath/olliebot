/**
 * OllieBot Promptfoo Custom Provider
 *
 * Wraps OllieBot's agent loop as a black-box provider for Promptfoo evaluation.
 * Promptfoo sends user input; OllieBot handles system prompt assembly, tool calls,
 * and multi-turn loops internally; only the final output is returned.
 *
 * Delegates to EvaluationRunner.executeWithTools() — no duplication of the agentic loop.
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
import type { ToolRunner } from '../tools/runner.js';
import type { EvaluationRunner } from './runner.js';
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

// Lazy-initialized singleton
let evalRunner: EvaluationRunner | null = null;

/**
 * Initialize EvaluationRunner from environment config.
 * Mirrors the bootstrap in src/index.ts but minimal — no server, no channels.
 */
async function ensureInitialized(providerConfig: OllieBotProviderConfig): Promise<EvaluationRunner> {
  if (evalRunner) return evalRunner;

  // Dynamic imports to avoid circular dependency issues
  const { LLMService: LLMServiceClass } = await import('../llm/service.js');
  const { AnthropicProvider } = await import('../llm/anthropic.js');
  const { OpenAIProvider } = await import('../llm/openai.js');
  const { GoogleProvider } = await import('../llm/google.js');
  const { ToolRunner: ToolRunnerClass } = await import('../tools/runner.js');
  const { EvaluationRunner: EvaluationRunnerClass } = await import('./runner.js');

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

  const llmService = new LLMServiceClass({
    main: createProvider(mainProviderName, mainModel),
    fast: createProvider(fastProviderName, fastModel),
  });

  const toolRunner = new ToolRunnerClass();

  evalRunner = new EvaluationRunnerClass({
    llmService,
    toolRunner,
    maxToolIterations: providerConfig.maxToolIterations || 10,
  });

  return evalRunner;
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
      const runner = await ensureInitialized(this.config);
      const target: TargetType = this.config.target || 'supervisor';

      // Load system prompt using the existing PromptLoader
      const systemPrompt = runner.getPromptLoader().loadForTarget(target);

      // Build messages — prompt is the user message from the test case
      const messages = [{ role: 'user' as const, content: prompt }];

      // Set up mocked tool runner (empty mocks — returns default responses)
      const { MockedToolRunner } = await import('./mocked-tool-runner.js');
      const mockedToolRunner = new MockedToolRunner();

      // Delegate to EvaluationRunner — reuse the existing agentic loop
      const { response, tokenUsage } = await runner.executeWithTools(
        systemPrompt,
        messages,
        mockedToolRunner,
      );

      const toolCalls = mockedToolRunner.getRecordedCalls();
      const latencyMs = Date.now() - startTime;
      const inputTokens = tokenUsage?.input || 0;
      const outputTokens = tokenUsage?.output || 0;

      return {
        output: response,
        tokenUsage: {
          total: inputTokens + outputTokens,
          prompt: inputTokens,
          completion: outputTokens,
        },
        metadata: {
          toolCalls: toolCalls.map(c => ({ name: c.toolName, input: c.parameters })),
          toolCallCount: toolCalls.length,
          target,
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
