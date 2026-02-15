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

import { RAG_SUMMARY_QUERY_WORD_THRESHOLD } from '../../constants.js';
import type { SummarizationProvider } from '../types.js';
import { LLMBasedStrategy } from './llm-based-strategy.js';

export class SummaryEmbeddingStrategy extends LLMBasedStrategy {
  readonly id = 'summary';
  readonly name = 'Summary Embedding';
  readonly description =
    'Summarizes chunks via LLM before embedding. Improves results for broad conceptual queries.';

  protected readonly label = 'SUMMARY';
  protected readonly queryWordThreshold = RAG_SUMMARY_QUERY_WORD_THRESHOLD;

  constructor(summarizationProvider: SummarizationProvider) {
    super(summarizationProvider);
  }

  protected getDirectivePrompt(): string {
    return (
      `${this.label}: Write a concise 1-2 sentence summary capturing the main point and key details. ` +
      `Output format: "${this.label}: Your summary here."`
    );
  }

  protected getStandaloneChunkPrompt(): string {
    return (
      'Write a concise 1-2 sentence summary of this text. ' +
      'Capture the main point and key details. Return ONLY the summary, nothing else.'
    );
  }

  protected getQueryTransformPrompt(): string {
    return (
      'Rephrase this search query as a concise statement describing the information being sought. ' +
      'Return ONLY the rephrased statement, nothing else.'
    );
  }
}
