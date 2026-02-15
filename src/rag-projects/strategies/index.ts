/**
 * Strategy Registry
 *
 * Factory and registry for retrieval strategies.
 * Creates strategy instances based on configuration.
 */

import type { SummarizationProvider } from '../types.js';
import type { RetrievalStrategy, StrategyConfig, StrategyFactoryOptions, StrategyType } from './types.js';
import { DirectEmbeddingStrategy } from './direct-embedding.js';
import { KeywordEmbeddingStrategy } from './keyword-embedding.js';
import { SummaryEmbeddingStrategy } from './summary-embedding.js';

/**
 * Create a retrieval strategy instance from its type identifier.
 * @throws Error if the strategy type is unknown or required dependencies are missing.
 */
export function createStrategy(
  type: StrategyType,
  options: StrategyFactoryOptions = {}
): RetrievalStrategy {
  switch (type) {
    case 'direct':
      return new DirectEmbeddingStrategy();

    case 'keyword':
      if (!options.summarizationProvider) {
        throw new Error(
          `Cannot create KeywordEmbeddingStrategy: missing summarization provider (LLM). ` +
          `This strategy requires LLM access to extract keywords. ` +
          `Check that your LLM configuration is valid and a summarization provider is available.`
        );
      }
      return new KeywordEmbeddingStrategy(options.summarizationProvider);

    case 'summary':
      if (!options.summarizationProvider) {
        throw new Error(
          `Cannot create SummaryEmbeddingStrategy: missing summarization provider (LLM). ` +
          `This strategy requires LLM access to generate summaries. ` +
          `Check that your LLM configuration is valid and a summarization provider is available.`
        );
      }
      return new SummaryEmbeddingStrategy(options.summarizationProvider);

    default:
      throw new Error(
        `Unknown strategy type '${type}'. ` +
        `Available types: 'direct', 'keyword', 'summary'. ` +
        `Check your project's strategy configuration.`
      );
  }
}

/**
 * Create strategy instances for a list of strategy configs.
 * Only creates enabled strategies. Logs warnings for strategies that can't be created.
 */
export function createStrategiesFromConfig(
  configs: StrategyConfig[],
  options: StrategyFactoryOptions = {}
): RetrievalStrategy[] {
  const strategies: RetrievalStrategy[] = [];
  const failures: string[] = [];

  for (const config of configs) {
    if (!config.enabled) continue;

    try {
      strategies.push(createStrategy(config.type, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${config.type}: ${message}`);
      console.warn(`[Strategies] Failed to create strategy '${config.type}':`, message);
    }
  }

  if (strategies.length === 0 && failures.length > 0) {
    console.warn(
      `[Strategies] No strategies could be created. All ${failures.length} strategy(ies) failed. ` +
      `Falling back to legacy single-strategy mode.`
    );
  }

  return strategies;
}

/**
 * Default strategy configuration: just direct embedding (backward compatible).
 */
export const DEFAULT_STRATEGIES: StrategyConfig[] = [
  { type: 'direct', weight: 1.0, enabled: true },
];

/**
 * Multi-strategy configuration with all three built-in strategies.
 * Direct gets highest weight, keyword and summary provide supplementary signals.
 */
export const MULTI_STRATEGY_PRESET: StrategyConfig[] = [
  { type: 'direct', weight: 1.0, enabled: true },
  { type: 'keyword', weight: 0.7, enabled: true },
  { type: 'summary', weight: 0.5, enabled: true },
];

/**
 * Get list of available strategy types with descriptions.
 */
export function getAvailableStrategies(): Array<{ type: StrategyType; name: string; description: string; requiresLLM: boolean }> {
  return [
    {
      type: 'direct',
      name: 'Direct Embedding',
      description: 'Embeds raw chunk text directly. Best for literal and semantic matching.',
      requiresLLM: false,
    },
    {
      type: 'keyword',
      name: 'Keyword Embedding',
      description: 'Extracts keywords via LLM before embedding. Improves recall for concept-based queries.',
      requiresLLM: true,
    },
    {
      type: 'summary',
      name: 'Summary Embedding',
      description: 'Summarizes chunks via LLM before embedding. Improves results for broad conceptual queries.',
      requiresLLM: true,
    },
  ];
}

// Re-exports
export type { RetrievalStrategy, StrategyConfig, StrategyType, FusionMethod, StrategyFactoryOptions, PreprocessedChunkMap } from './types.js';
export { DirectEmbeddingStrategy } from './direct-embedding.js';
export { KeywordEmbeddingStrategy } from './keyword-embedding.js';
export { SummaryEmbeddingStrategy } from './summary-embedding.js';
export { LLMBasedStrategy } from './llm-based-strategy.js';
export { ChunkPreprocessor } from './chunk-preprocessor.js';
