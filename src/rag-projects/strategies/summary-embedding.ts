/**
 * Summary Embedding Strategy
 *
 * Uses an LLM to generate a concise summary of each chunk, then embeds the summary.
 * This creates a "semantic summary space" where retrieval focuses on the high-level
 * meaning of each chunk, improving results for broad conceptual queries.
 *
 * Participates in shared LLM preprocessing by contributing a SUMMARY directive
 * and extracting its result from the combined response. Falls back to a standalone
 * LLM call if no preprocessed data is available.
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { RetrievalStrategy, PreprocessedChunkMap } from './types.js';

/** Label used in the combined prompt and response. Must be unique across strategies. */
const LABEL = 'SUMMARY';

const STANDALONE_PROMPT =
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

  // ─── Shared LLM preprocessing contribution ─────────────────────

  getPreprocessingDirective(): string {
    return (
      `${LABEL}: Write a concise 1-2 sentence summary capturing the main point and key details. ` +
      `Output format: "${LABEL}: Your summary here."`
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
      const summary = await this.summarizationProvider.summarize(
        chunk.text,
        STANDALONE_PROMPT
      );
      return summary.trim();
    } catch (error) {
      console.warn(`[SummaryStrategy] Summarization failed, falling back to raw text:`, error);
      return chunk.text;
    }
  }

  async prepareQueryText(query: string): Promise<string> {
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
