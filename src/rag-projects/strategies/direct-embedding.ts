/**
 * Direct Embedding Strategy
 *
 * The simplest strategy: embeds the raw chunk text as-is.
 * This is equivalent to the original single-strategy RAG behavior.
 */

import type { DocumentChunk } from '../types.js';
import type { PreprocessedChunk } from './chunk-preprocessor.js';
import type { RetrievalStrategy } from './types.js';

export class DirectEmbeddingStrategy implements RetrievalStrategy {
  readonly id = 'direct';
  readonly name = 'Direct Embedding';
  readonly description = 'Embeds the raw chunk text directly. Best for literal and semantic matching.';

  async prepareChunkText(chunk: DocumentChunk, _preprocessed?: PreprocessedChunk): Promise<string> {
    return chunk.text;
  }

  async prepareQueryText(query: string): Promise<string> {
    return query;
  }
}
