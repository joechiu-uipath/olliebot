/**
 * Chunk Preprocessor
 *
 * A generic combiner that makes a single shared LLM call per chunk for all
 * strategies that need LLM preprocessing. The preprocessor has ZERO knowledge
 * of what any strategy does — it only knows how to:
 *
 *   1. Ask each strategy: "what's your prompt directive?" (getPreprocessingDirective)
 *   2. Concatenate all directives into one combined prompt
 *   3. Make one LLM call with the chunk text + combined prompt
 *   4. Ask each strategy: "extract your result from this response" (extractPreprocessedResult)
 *
 * Each strategy owns its directive format and extraction logic. Strategies can
 * break each other if their output labels collide — that's their responsibility
 * to coordinate (e.g., by choosing distinctive section labels like KEYWORDS:, SUMMARY:).
 */

import type { SummarizationProvider } from '../types.js';
import type { RetrievalStrategy, PreprocessedChunkMap } from './types.js';

/**
 * Preprocesses chunks with a single shared LLM call whose prompt is assembled
 * from strategy-contributed directives.
 */
export class ChunkPreprocessor {
  private summarizationProvider: SummarizationProvider;
  private strategies: RetrievalStrategy[];
  /** The combined prompt built from all contributing strategies' directives */
  private combinedDirective: string;
  /** IDs of strategies that contribute to the shared call */
  private contributorIds: string[];
  /** Cache keyed by chunk text to avoid re-processing identical chunks */
  private cache: Map<string, PreprocessedChunkMap> = new Map();

  /**
   * @param summarizationProvider - The LLM provider for the shared call
   * @param strategies - All enabled strategies. Only those implementing
   *   getPreprocessingDirective() will participate in the shared call.
   */
  constructor(summarizationProvider: SummarizationProvider, strategies: RetrievalStrategy[]) {
    this.summarizationProvider = summarizationProvider;
    this.strategies = strategies;

    // Collect directives from strategies that opt in
    const directives: string[] = [];
    this.contributorIds = [];

    for (const strategy of strategies) {
      if (strategy.getPreprocessingDirective) {
        const directive = strategy.getPreprocessingDirective();
        if (directive) {
          directives.push(directive);
          this.contributorIds.push(strategy.id);
        }
      }
    }

    this.combinedDirective = directives.length > 0
      ? 'Analyze the following text and produce the outputs described below.\n\n' +
        directives.join('\n\n') +
        '\n\nRespond in EXACTLY the format specified above, nothing else.'
      : '';
  }

  /**
   * Whether this preprocessor has any work to do (at least one strategy contributed a directive).
   */
  hasContributors(): boolean {
    return this.contributorIds.length > 0;
  }

  /**
   * Process a chunk's text through the shared LLM call.
   * Returns a map of strategyId → extracted text for each contributing strategy.
   * Results are cached by chunk text.
   */
  async process(chunkText: string): Promise<PreprocessedChunkMap> {
    const cached = this.cache.get(chunkText);
    if (cached) return cached;

    const result: PreprocessedChunkMap = new Map();

    if (!this.hasContributors()) {
      this.cache.set(chunkText, result);
      return result;
    }

    try {
      // One LLM call with the combined directive
      const rawResponse = await this.summarizationProvider.summarize(
        chunkText,
        this.combinedDirective
      );

      // Let each contributing strategy extract its own result from the raw response
      for (const strategy of this.strategies) {
        if (strategy.extractPreprocessedResult && this.contributorIds.includes(strategy.id)) {
          const extracted = strategy.extractPreprocessedResult(rawResponse);
          if (extracted !== null) {
            result.set(strategy.id, extracted);
          }
        }
      }
    } catch (error) {
      console.warn(
        '[ChunkPreprocessor] Shared LLM preprocessing failed. ' +
        'Strategies will fall back to individual LLM calls. Error:',
        error
      );
      // Result map stays empty — strategies will fall back to their own LLM calls
    }

    this.cache.set(chunkText, result);
    return result;
  }

  /**
   * Clear the cache (e.g., between documents to bound memory).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
