/**
 * Keyword Embedding Strategy
 *
 * Uses an LLM to extract a keyword list from each chunk, then embeds the keywords.
 * This creates a "keyword-space" index where retrieval focuses on key concepts
 * rather than full prose, improving recall for queries that use different wording
 * than the source text.
 *
 * During indexing, prefers pre-computed keywords from ChunkPreprocessor (shared
 * single LLM call) to avoid redundant input token costs. Falls back to its own
 * LLM call only if no preprocessed data is available.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { PreprocessedChunk } from './chunk-preprocessor.js';
import type { RetrievalStrategy } from './types.js';

const KEYWORD_EXTRACTION_PROMPT =
  'Extract 10-20 important keywords and key phrases from this text. ' +
  'Return ONLY a comma-separated list of keywords, nothing else. ' +
  'Focus on: specific terms, named entities, technical concepts, and core topics.';

const QUERY_KEYWORD_PROMPT =
  'Extract the key search terms from this query. ' +
  'Return ONLY a comma-separated list of keywords, nothing else.';

export class KeywordEmbeddingStrategy implements RetrievalStrategy {
  readonly id = 'keyword';
  readonly name = 'Keyword Embedding';
  readonly description =
    'Extracts keywords via LLM before embedding. Improves recall for concept-based queries.';

  private summarizationProvider: SummarizationProvider;

  constructor(summarizationProvider: SummarizationProvider) {
    this.summarizationProvider = summarizationProvider;
  }

  async prepareChunkText(chunk: DocumentChunk, preprocessed?: PreprocessedChunk): Promise<string> {
    // Use pre-computed keywords from shared LLM call when available
    if (preprocessed) {
      return preprocessed.keywords;
    }

    // Fallback: standalone LLM call (only when preprocessor is not wired in)
    try {
      const keywords = await this.summarizationProvider.summarize(
        chunk.text,
        KEYWORD_EXTRACTION_PROMPT
      );
      return keywords.trim();
    } catch (error) {
      console.warn(`[KeywordStrategy] Keyword extraction failed, falling back to raw text:`, error);
      return chunk.text;
    }
  }

  async prepareQueryText(query: string): Promise<string> {
    // For short queries (likely already keyword-like), use as-is
    if (query.split(/\s+/).length <= 5) {
      return query;
    }

    try {
      const keywords = await this.summarizationProvider.summarize(
        query,
        QUERY_KEYWORD_PROMPT
      );
      return keywords.trim();
    } catch (error) {
      console.warn(`[KeywordStrategy] Query keyword extraction failed, using raw query:`, error);
      return query;
    }
  }
}
