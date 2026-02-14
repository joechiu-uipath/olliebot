/**
 * Keyword Embedding Strategy
 *
 * Uses an LLM to extract a keyword list from each chunk, then embeds the keywords.
 * This creates a "keyword-space" index where retrieval focuses on key concepts
 * rather than full prose, improving recall for queries that use different wording
 * than the source text.
 *
 * Participates in shared LLM preprocessing by contributing a KEYWORDS directive
 * and extracting its result from the combined response. Falls back to a standalone
 * LLM call if no preprocessed data is available.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { RetrievalStrategy, PreprocessedChunkMap } from './types.js';

/** Label used in the combined prompt and response. Must be unique across strategies. */
const LABEL = 'KEYWORDS';

const STANDALONE_PROMPT =
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

  // ─── Shared LLM preprocessing contribution ─────────────────────

  getPreprocessingDirective(): string {
    return (
      `${LABEL}: Extract 10-20 important keywords and key phrases. ` +
      'Focus on specific terms, named entities, technical concepts, and core topics. ' +
      `Output format: "${LABEL}: keyword1, keyword2, keyword3, ..."`
    );
  }

  extractPreprocessedResult(rawResponse: string): string | null {
    for (const line of rawResponse.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.toUpperCase().startsWith(`${LABEL}:`)) {
        const value = trimmed.slice(`${LABEL}:`.length).trim();
        if (value) return value;
      }
    }
    return null;
  }

  // ─── Core strategy methods ─────────────────────────────────────

  async prepareChunkText(chunk: DocumentChunk, preprocessed?: PreprocessedChunkMap): Promise<string> {
    // Use result from shared LLM call when available
    const cached = preprocessed?.get(this.id);
    if (cached) return cached;

    // Fallback: standalone LLM call
    try {
      const keywords = await this.summarizationProvider.summarize(
        chunk.text,
        STANDALONE_PROMPT
      );
      return keywords.trim();
    } catch (error) {
      console.warn(`[KeywordStrategy] Keyword extraction failed, falling back to raw text:`, error);
      return chunk.text;
    }
  }

  async prepareQueryText(query: string): Promise<string> {
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
