/**
 * Retrieval Strategy Types
 *
 * Defines the interface for pluggable retrieval strategies in the multi-strategy RAG system.
 * Each strategy transforms chunk text differently before embedding, allowing the same
 * document chunks to be indexed and searched in multiple ways.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { PreprocessedChunk } from './chunk-preprocessor.js';

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
 * A retrieval strategy that controls how chunks are preprocessed for embedding
 * and how queries are transformed before search.
 *
 * All strategies share the same embedding provider - the differentiation is
 * in the text transformation, not the embedding model.
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
   * When `preprocessed` is provided, the strategy should use the already-computed
   * data (keywords/summary from a single shared LLM call) instead of making its
   * own LLM call. This avoids sending the same input tokens multiple times.
   *
   * @param chunk - The document chunk
   * @param preprocessed - Pre-computed keywords/summary from ChunkPreprocessor (if available)
   * @returns The text to be embedded and stored alongside the original chunk text.
   */
  prepareChunkText(chunk: DocumentChunk, preprocessed?: PreprocessedChunk): Promise<string>;

  /**
   * Transform a query string before embedding for search.
   * @returns The text to be embedded for the vector search.
   */
  prepareQueryText(query: string): Promise<string>;
}

/**
 * Options for creating a retrieval strategy instance.
 */
export interface StrategyFactoryOptions {
  /** Summarization/LLM provider for strategies that need text generation */
  summarizationProvider?: SummarizationProvider | null;
}
