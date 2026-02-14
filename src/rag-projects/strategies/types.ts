/**
 * Retrieval Strategy Types
 *
 * Defines the interface for pluggable retrieval strategies in the multi-strategy RAG system.
 * Each strategy transforms chunk text differently before embedding, allowing the same
 * document chunks to be indexed and searched in multiple ways.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';

/**
 * Built-in strategy identifiers.
 */
export type StrategyType = 'direct' | 'keyword' | 'summary';

/**
 * Configuration for a single retrieval strategy within a project.
 */
export interface StrategyConfig {
  /** Strategy type identifier */
  type: StrategyType;
  /** Weight for fusion scoring (0-1). Higher = more influence. */
  weight: number;
  /** Whether this strategy is enabled */
  enabled: boolean;
}

/**
 * Supported fusion methods for combining multi-strategy results.
 */
export type FusionMethod = 'rrf' | 'weighted_score';

/**
 * Map of strategy ID → extracted text from a shared LLM preprocessing call.
 * Built by ChunkPreprocessor after collecting directives from all contributing
 * strategies and making a single LLM call.
 */
export type PreprocessedChunkMap = Map<string, string>;

/**
 * A retrieval strategy that controls how chunks are preprocessed for embedding
 * and how queries are transformed before search.
 *
 * All strategies share the same embedding provider - the differentiation is
 * in the text transformation, not the embedding model.
 *
 * Strategies that need LLM preprocessing should also implement the optional
 * preprocessing methods (getPreprocessingDirective / extractPreprocessedResult)
 * so the ChunkPreprocessor can batch their work into a single LLM call.
 */
export interface RetrievalStrategy {
  /** Unique identifier for this strategy (used as table suffix) */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this strategy does */
  readonly description: string;

  /**
   * Transform a chunk's text before embedding for indexing.
   *
   * When `preprocessed` is provided, the strategy should look up its own result
   * by its `id` from the map. This data was produced by a single shared LLM call
   * that included this strategy's directive alongside other strategies' directives.
   *
   * @param chunk - The document chunk
   * @param preprocessed - Map of strategyId → extracted text from shared LLM call
   * @returns The text to be embedded and stored alongside the original chunk text.
   */
  prepareChunkText(chunk: DocumentChunk, preprocessed?: PreprocessedChunkMap): Promise<string>;

  /**
   * Transform a query string before embedding for search.
   * @returns The text to be embedded for the vector search.
   */
  prepareQueryText(query: string): Promise<string>;

  /**
   * Return the prompt directive this strategy wants included in the shared
   * LLM preprocessing call. The preprocessor will concatenate directives from
   * all contributing strategies into a single prompt.
   *
   * The strategy is responsible for defining a clear, parseable output format
   * (e.g., a labeled section) that it can later find in the combined response.
   * Strategies can break each other if their formats collide, so each must
   * choose a distinctive label.
   *
   * Return undefined if this strategy does not need LLM preprocessing.
   */
  getPreprocessingDirective?(): string;

  /**
   * Extract this strategy's result from the raw combined LLM response.
   * The response contains interleaved output from all contributing strategies.
   * The strategy must locate and parse its own section.
   *
   * @returns The extracted text for this strategy, or null if extraction failed.
   */
  extractPreprocessedResult?(rawResponse: string): string | null;
}

/**
 * Options for creating a retrieval strategy instance.
 */
export interface StrategyFactoryOptions {
  /** Summarization/LLM provider for strategies that need text generation */
  summarizationProvider?: SummarizationProvider | null;
}
