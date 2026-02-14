/**
 * Summary Embedding Strategy
 *
 * Uses an LLM to generate a concise summary of each chunk, then embeds the summary.
 * This creates a "semantic summary space" where retrieval focuses on the high-level
 * meaning of each chunk, improving results for broad conceptual queries.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { RetrievalStrategy } from './types.js';

const CHUNK_SUMMARY_PROMPT =
  'Write a concise 1-2 sentence summary of this text. ' +
  'Capture the main point and key details. Return ONLY the summary, nothing else.';

const QUERY_SUMMARY_PROMPT =
  'Rephrase this search query as a concise statement describing the information being sought. ' +
  'Return ONLY the rephrased statement, nothing else.';

export class SummaryEmbeddingStrategy implements RetrievalStrategy {
  readonly id = 'summary';
  readonly name = 'Summary Embedding';
  readonly description =
    'Summarizes chunks via LLM before embedding. Improves results for broad conceptual queries.';

  private summarizationProvider: SummarizationProvider;

  constructor(summarizationProvider: SummarizationProvider) {
    this.summarizationProvider = summarizationProvider;
  }

  async prepareChunkText(chunk: DocumentChunk): Promise<string> {
    try {
      const summary = await this.summarizationProvider.summarize(
        chunk.text,
        CHUNK_SUMMARY_PROMPT
      );
      return summary.trim();
    } catch (error) {
      console.warn(`[SummaryStrategy] Summarization failed, falling back to raw text:`, error);
      return chunk.text;
    }
  }

  async prepareQueryText(query: string): Promise<string> {
    // For short queries, use as-is (they're already concise)
    if (query.split(/\s+/).length <= 8) {
      return query;
    }

    try {
      const rephrased = await this.summarizationProvider.summarize(
        query,
        QUERY_SUMMARY_PROMPT
      );
      return rephrased.trim();
    } catch (error) {
      console.warn(`[SummaryStrategy] Query rephrasing failed, using raw query:`, error);
      return query;
    }
  }
}
