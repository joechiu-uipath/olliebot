/**
 * Message Embeddings Module
 *
 * Background indexing and semantic search for chat messages.
 * Reuses the RAG infrastructure (LanceStore, strategies, fusion, embedding providers).
 */

// Service
export { MessageEmbeddingService } from './service.js';

// Search handler
export { handleMessageSearch } from './search-handler.js';
export type { SearchMode, SearchParams } from './search-handler.js';

// Message chunker
export { chunkMessage } from './message-chunker.js';
export type { MessageForChunking } from './message-chunker.js';

// Utilities
export { createSnippet } from './utils.js';

// Types
export type {
  MessageEmbeddingConfig,
  MessageEmbeddingState,
  MessageSearchResult,
  MessageSearchResultSource,
  MessageEmbeddingStats,
  IndexingCompleteEvent,
  SearchSource,
  SemanticStrategyType,
} from './types.js';

export { DEFAULT_MESSAGE_EMBEDDING_CONFIG } from './types.js';
