/**
 * Message Embedding Types
 *
 * Types for the background message indexing and semantic search system.
 */

import type { StrategyConfig, FusionMethod } from '../rag-projects/strategies/types.js';

// ─── Watermark State ─────────────────────────────────────────

/** Persisted watermark state in SQLite (single row). */
export interface MessageEmbeddingState {
  /** ISO timestamp of the newest indexed message */
  lastIndexedAt: string;
  /** ID of the newest indexed message (tiebreaker for same-timestamp) */
  lastIndexedId: string;
  /** Running count of total messages indexed */
  totalIndexed: number;
}

// ─── Service Configuration ───────────────────────────────────

/** Configuration for the MessageEmbeddingService. */
export interface MessageEmbeddingConfig {
  /** Path for the LanceDB database (e.g., user/data/message-embeddings.lance) */
  dbPath: string;
  /** Interval in ms between indexing runs (default: 60000) */
  indexInterval: number;
  /** Batch size for embedding API calls (default: 50) */
  embeddingBatchSize: number;
  /** Maximum messages to process per indexing run (default: 500) */
  maxMessagesPerRun: number;
  /** Roles to index (default: ['user', 'assistant']) */
  indexableRoles: string[];
  /** Minimum content length to index — skip empty/tiny messages (default: 10) */
  minContentLength: number;
  /** Retrieval strategies (default: direct only) */
  strategies: StrategyConfig[];
  /** Fusion method for combining results from multiple strategies */
  fusionMethod: FusionMethod;
}

/** Default configuration. */
export const DEFAULT_MESSAGE_EMBEDDING_CONFIG: Omit<MessageEmbeddingConfig, 'dbPath'> = {
  indexInterval: 60_000,
  embeddingBatchSize: 50,
  maxMessagesPerRun: 500,
  indexableRoles: ['user', 'assistant'],
  minContentLength: 10,
  strategies: [{ type: 'direct', weight: 1.0, enabled: true }],
  fusionMethod: 'rrf',
};

// ─── Search Result Types ─────────────────────────────────────

/** Which search provider produced a result. */
export type SearchSource = 'fts' | 'semantic';

/** Semantic strategy type identifiers. */
export type SemanticStrategyType = 'direct' | 'keyword' | 'summary';

/** Provenance info for a single result source. */
export interface MessageSearchResultSource {
  /** Which search provider found this result */
  source: SearchSource;
  /** Which embedding strategy (only set when source === 'semantic') */
  strategy?: SemanticStrategyType;
  /** Raw score from this source (BM25 rank for FTS, cosine similarity for semantic) */
  score: number;
}

/** Unified search result from any search mode (fts, semantic, hybrid). */
export interface MessageSearchResult {
  /** Message ID */
  messageId: string;
  /** Conversation this message belongs to */
  conversationId: string;
  /** Title of the conversation */
  conversationTitle: string;
  /** Message role (user, assistant) */
  role: string;
  /** The matched chunk text */
  text: string;
  /** Highlighted snippet for display */
  snippet: string;
  /** When the message was created */
  createdAt: string;
  /** Final score (fused in hybrid mode, raw in single mode) */
  score: number;
  /**
   * All sources that found this result.
   * In hybrid mode, a message found by both FTS and semantic
   * will have two entries, each with its own source, strategy, and score.
   */
  sources: MessageSearchResultSource[];
}

// ─── Indexing Progress Event ─────────────────────────────────

/** Emitted by the service during/after indexing runs. */
export interface IndexingCompleteEvent {
  /** Number of messages indexed in this run */
  messagesIndexed: number;
  /** Number of chunks created */
  chunksCreated: number;
  /** Duration of this indexing run in ms */
  durationMs: number;
  /** Whether there are more messages to index (hit maxMessagesPerRun cap) */
  hasMore: boolean;
}

// ─── Indexing Stats ──────────────────────────────────────────

/** Stats returned by getStats(). */
export interface MessageEmbeddingStats {
  /** Current watermark state */
  state: MessageEmbeddingState;
  /** Vector count per strategy table */
  vectorCounts: Record<string, number>;
  /** Total vectors across all strategies */
  totalVectors: number;
}
