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
          'KeywordEmbeddingStrategy requires a summarization provider (LLM). ' +
          'Ensure a summarization provider is configured.'
        );
      }
      return new KeywordEmbeddingStrategy(options.summarizationProvider);

    case 'summary':
      if (!options.summarizationProvider) {
        throw new Error(
          'SummaryEmbeddingStrategy requires a summarization provider (LLM). ' +
          'Ensure a summarization provider is configured.'
        );
      }
      return new SummaryEmbeddingStrategy(options.summarizationProvider);

    default:
      throw new Error(`Unknown strategy type: ${type}`);
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

  for (const config of configs) {
    if (!config.enabled) continue;

    try {
      strategies.push(createStrategy(config.type, options));
    } catch (error) {
      console.warn(
        `[Strategies] Failed to create strategy '${config.type}':`,
        error instanceof Error ? error.message : error
      );
    }
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
export type { RetrievalStrategy, StrategyConfig, StrategyType, FusionMethod, StrategyFactoryOptions } from './types.js';
export { DirectEmbeddingStrategy } from './direct-embedding.js';
export { KeywordEmbeddingStrategy } from './keyword-embedding.js';
export { SummaryEmbeddingStrategy } from './summary-embedding.js';
export { ChunkPreprocessor } from './chunk-preprocessor.js';
export type { PreprocessedChunk } from './chunk-preprocessor.js';
