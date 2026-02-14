/**
 * Chunk Preprocessor
 *
 * Makes a single combined LLM call per chunk to produce both keywords and summary,
 * instead of letting each strategy make independent calls with the same input tokens.
 *
 * Before: keyword strategy sends chunk → LLM → keywords (N input tokens)
 *         summary strategy sends chunk → LLM → summary (N input tokens again)
 *         Total: 2× input token cost for the same chunk text
 *
 * After:  preprocessor sends chunk → LLM → { keywords, summary } (N input tokens once)
 *         strategies read from cached preprocessor output
 *         Total: 1× input token cost
 */

import type { SummarizationProvider } from '../types.js';

const COMBINED_PROMPT =
  'Analyze the following text and produce two outputs.\n\n' +
  'KEYWORDS: Extract 10-20 important keywords and key phrases. ' +
  'Focus on specific terms, named entities, technical concepts, and core topics.\n\n' +
  'SUMMARY: Write a concise 1-2 sentence summary capturing the main point and key details.\n\n' +
  'Respond in EXACTLY this format (no other text):\n' +
  'KEYWORDS: keyword1, keyword2, keyword3, ...\n' +
  'SUMMARY: Your summary here.';

/**
 * Preprocessed output for a single chunk.
 */
export interface PreprocessedChunk {
  /** Comma-separated keyword list */
  keywords: string;
  /** 1-2 sentence summary */
  summary: string;
}

/**
 * Preprocesses chunks with a single LLM call per chunk, producing both
 * keywords and summaries that multiple strategies can consume.
 *
 * Usage:
 *   const preprocessor = new ChunkPreprocessor(llmProvider);
 *   const result = await preprocessor.process(chunkText);
 *   // result.keywords → for KeywordEmbeddingStrategy
 *   // result.summary  → for SummaryEmbeddingStrategy
 */
export class ChunkPreprocessor {
  private summarizationProvider: SummarizationProvider;
  /** Cache keyed by chunk text to avoid re-processing the same chunk */
  private cache: Map<string, PreprocessedChunk> = new Map();

  constructor(summarizationProvider: SummarizationProvider) {
    this.summarizationProvider = summarizationProvider;
  }

  /**
   * Process a chunk's text, returning both keywords and summary.
   * Results are cached so repeated calls with the same text are free.
   */
  async process(chunkText: string): Promise<PreprocessedChunk> {
    const cached = this.cache.get(chunkText);
    if (cached) return cached;

    try {
      const response = await this.summarizationProvider.summarize(
        chunkText,
        COMBINED_PROMPT
      );

      const result = this.parseResponse(response, chunkText);
      this.cache.set(chunkText, result);
      return result;
    } catch (error) {
      console.warn('[ChunkPreprocessor] Combined LLM call failed, using fallbacks:', error);
      // Fallback: use raw text for both
      const fallback: PreprocessedChunk = {
        keywords: chunkText,
        summary: chunkText,
      };
      this.cache.set(chunkText, fallback);
      return fallback;
    }
  }

  /**
   * Parse the structured LLM response into keywords and summary.
   * Handles minor formatting variations gracefully.
   */
  private parseResponse(response: string, fallbackText: string): PreprocessedChunk {
    const lines = response.trim().split('\n');

    let keywords = '';
    let summary = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toUpperCase().startsWith('KEYWORDS:')) {
        keywords = trimmed.slice('KEYWORDS:'.length).trim();
      } else if (trimmed.toUpperCase().startsWith('SUMMARY:')) {
        summary = trimmed.slice('SUMMARY:'.length).trim();
      }
    }

    return {
      keywords: keywords || fallbackText,
      summary: summary || fallbackText,
    };
  }

  /**
   * Clear the cache (e.g., between documents to bound memory).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
