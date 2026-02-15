/**
 * Base class for LLM-based retrieval strategies.
 *
 * Provides common functionality for strategies that:
 * 1. Use an LLM to transform chunk text before embedding
 * 2. Participate in shared preprocessing via labeled directives
 * 3. Have a word-count threshold for query transformation
 * 4. Fall back to raw text on LLM failure
 */

import type { DocumentChunk, SummarizationProvider } from '../types.js';
import type { RetrievalStrategy, PreprocessedChunkMap } from './types.js';

/**
 * Abstract base class for LLM-based strategies.
 * Subclasses must define their prompts and label.
 */
export abstract class LLMBasedStrategy implements RetrievalStrategy {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;

  protected summarizationProvider: SummarizationProvider;

  /**
   * Unique label used in the shared preprocessing prompt and response.
   * Must be distinctive to avoid collisions with other strategies.
   */
  protected abstract readonly label: string;

  /**
   * Query word count threshold. Queries with fewer words than this
   * are used as-is; longer queries get LLM transformation.
   */
  protected abstract readonly queryWordThreshold: number;

  /**
   * Prompt for the shared preprocessing directive.
   * Should include instructions and the expected output format.
   */
  protected abstract getDirectivePrompt(): string;

  /**
   * Standalone prompt for chunk transformation when not using shared preprocessing.
   */
  protected abstract getStandaloneChunkPrompt(): string;

  /**
   * Standalone prompt for query transformation.
   */
  protected abstract getQueryTransformPrompt(): string;

  constructor(summarizationProvider: SummarizationProvider) {
    this.summarizationProvider = summarizationProvider;
  }

  // ─── Shared LLM preprocessing contribution ─────────────────────

  getPreprocessingDirective(): string {
    return this.getDirectivePrompt();
  }

  extractPreprocessedResult(rawResponse: string): string | null {
    // Parse response looking for lines matching "LABEL: content"
    for (const line of rawResponse.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.toUpperCase().startsWith(`${this.label}:`)) {
        const value = trimmed.slice(`${this.label}:`.length).trim();
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
      const transformed = await this.summarizationProvider.summarize(
        chunk.text,
        this.getStandaloneChunkPrompt()
      );
      return transformed.trim();
    } catch (error) {
      console.warn(`[${this.name}] Chunk transformation failed, falling back to raw text:`, error);
      return chunk.text;
    }
  }

  async prepareQueryText(query: string): Promise<string> {
    // Skip transformation for short queries
    const wordCount = query.split(/\s+/).length;
    if (wordCount <= this.queryWordThreshold) {
      return query;
    }

    // Transform longer queries
    try {
      const transformed = await this.summarizationProvider.summarize(
        query,
        this.getQueryTransformPrompt()
      );
      return transformed.trim();
    } catch (error) {
      console.warn(`[${this.name}] Query transformation failed, using raw query:`, error);
      return query;
    }
  }
}
