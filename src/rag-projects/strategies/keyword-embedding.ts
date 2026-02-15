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

import {
  RAG_KEYWORD_EXTRACTION_MIN,
  RAG_KEYWORD_EXTRACTION_MAX,
  RAG_KEYWORD_QUERY_WORD_THRESHOLD,
} from '../../constants.js';
import type { SummarizationProvider } from '../types.js';
import { LLMBasedStrategy } from './llm-based-strategy.js';

export class KeywordEmbeddingStrategy extends LLMBasedStrategy {
  readonly id = 'keyword';
  readonly name = 'Keyword Embedding';
  readonly description =
    'Extracts keywords via LLM before embedding. Improves recall for concept-based queries.';

  protected readonly label = 'KEYWORDS';
  protected readonly queryWordThreshold = RAG_KEYWORD_QUERY_WORD_THRESHOLD;

  constructor(summarizationProvider: SummarizationProvider) {
    super(summarizationProvider);
  }

  protected getDirectivePrompt(): string {
    return (
      `${this.label}: Extract ${RAG_KEYWORD_EXTRACTION_MIN}-${RAG_KEYWORD_EXTRACTION_MAX} important keywords and key phrases. ` +
      'Focus on specific terms, named entities, technical concepts, and core topics. ' +
      `Output format: "${this.label}: keyword1, keyword2, keyword3, ..."`
    );
  }

  protected getStandaloneChunkPrompt(): string {
    return (
      `Extract ${RAG_KEYWORD_EXTRACTION_MIN}-${RAG_KEYWORD_EXTRACTION_MAX} important keywords and key phrases from this text. ` +
      'Return ONLY a comma-separated list of keywords, nothing else. ' +
      'Focus on: specific terms, named entities, technical concepts, and core topics.'
    );
  }

  protected getQueryTransformPrompt(): string {
    return (
      'Extract the key search terms from this query. ' +
      'Return ONLY a comma-separated list of keywords, nothing else.'
    );
  }
}
