/**
 * Re-ranker
 *
 * Post-fusion re-ranking step. After N strategies produce N ranked lists and
 * fusion merges them into a single list, the re-ranker makes a final pass
 * to adjust the ordering.
 *
 * The LLM re-ranker sends the query + candidate chunks to an LLM and asks
 * it to judge relevance directly from the text — independent of embedding
 * similarity scores. This can catch relevance signals that vector search misses.
 */

import type { SearchResult, SummarizationProvider } from './types.js';

/**
 * Re-ranker configuration in project settings.
 */
export type RerankerMethod = 'none' | 'llm';

/**
 * A re-ranker takes fused search results and re-orders them.
 */
export interface Reranker {
  /**
   * Re-rank the given results for the query.
   * Returns results in new order with updated scores.
   */
  rerank(query: string, results: SearchResult[], topK: number): Promise<SearchResult[]>;
}

/**
 * LLM-based re-ranker.
 *
 * Sends the query and candidate chunk texts to an LLM, asking it to score
 * each chunk's relevance on a 0-10 scale. Results are re-ordered by the
 * LLM's relevance scores.
 *
 * The LLM sees the actual text, not embeddings, so it can catch semantic
 * relevance that vector similarity misses (e.g., paraphrases, implicit
 * answers, negations).
 */
export class LLMReranker implements Reranker {
  private summarizationProvider: SummarizationProvider;

  constructor(summarizationProvider: SummarizationProvider) {
    this.summarizationProvider = summarizationProvider;
  }

  async rerank(query: string, results: SearchResult[], topK: number): Promise<SearchResult[]> {
    if (results.length === 0) return [];

    // Build the prompt with numbered candidates
    const candidateList = results
      .map((r, i) => `[${i}] ${r.text}`)
      .join('\n\n');

    const prompt =
      `You are a relevance judge. Given a search query and candidate text chunks, ` +
      `score each chunk's relevance to the query on a scale of 0-10.\n\n` +
      `Respond with ONLY one line per chunk in this exact format:\n` +
      `[index] score\n\n` +
      `Example response:\n` +
      `[0] 8\n[1] 3\n[2] 9\n\n` +
      `Query: "${query}"\n\n` +
      `Candidates:\n${candidateList}`;

    try {
      const response = await this.summarizationProvider.summarize(candidateList, prompt);
      const scores = this.parseScores(response, results.length);

      // Re-order by LLM relevance score descending
      const scored = results.map((result, i) => ({
        result,
        llmScore: scores.get(i) ?? 0,
      }));

      scored.sort((a, b) => b.llmScore - a.llmScore);

      return scored
        .slice(0, topK)
        .map(({ result, llmScore }) => ({
          ...result,
          // Normalize LLM score to 0-1 range and use as the final score
          score: llmScore / 10,
          metadata: {
            ...result.metadata,
            rerankerScore: llmScore / 10,
            preFusionScore: result.score,
          },
        }));
    } catch (error) {
      console.warn('[LLMReranker] Re-ranking failed, returning fusion order:', error);
      return results.slice(0, topK);
    }
  }

  /**
   * Parse the LLM response to extract [index] score pairs.
   */
  private parseScores(response: string, count: number): Map<number, number> {
    const scores = new Map<number, number>();

    for (const line of response.split('\n')) {
      const match = line.trim().match(/^\[(\d+)\]\s+([\d.]+)/);
      if (match) {
        const index = parseInt(match[1], 10);
        const score = Math.min(10, Math.max(0, parseFloat(match[2])));
        if (index >= 0 && index < count && !isNaN(score)) {
          scores.set(index, score);
        }
      }
    }

    return scores;
  }
}

/**
 * Create a re-ranker based on the method.
 * Returns null for 'none' or if dependencies are missing.
 */
export function createReranker(
  method: RerankerMethod,
  summarizationProvider: SummarizationProvider | null
): Reranker | null {
  switch (method) {
    case 'llm':
      if (!summarizationProvider) {
        console.warn('[Reranker] LLM reranker requires a summarization provider');
        return null;
      }
      return new LLMReranker(summarizationProvider);
    case 'none':
    default:
      return null;
  }
}
