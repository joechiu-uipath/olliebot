/**
 * Result Fusion
 *
 * Algorithms for merging ranked result lists from multiple retrieval strategies
 * into a single unified ranking.
 */

import type { SearchResult } from './types.js';
import type { FusionMethod, StrategyConfig } from './strategies/types.js';

/**
 * Results from a single strategy's search, tagged with the strategy ID.
 */
export interface StrategySearchResult {
  /** Which strategy produced these results */
  strategyId: string;
  /** The ranked results from this strategy */
  results: SearchResult[];
}

/**
 * A fused search result with provenance information.
 */
export interface FusedSearchResult extends SearchResult {
  /** The fused/combined score */
  fusedScore: number;
  /** Per-strategy scores and ranks for transparency */
  strategyScores: Array<{
    strategyId: string;
    rank: number;
    score: number;
  }>;
}

/**
 * Fuse results from multiple strategies into a single ranked list.
 *
 * @param strategyResults - Results from each strategy
 * @param strategyConfigs - Strategy configurations (for weights)
 * @param method - Fusion algorithm to use
 * @param topK - Maximum results to return
 * @returns Unified ranked list with fused scores
 */
export function fuseResults(
  strategyResults: StrategySearchResult[],
  strategyConfigs: StrategyConfig[],
  method: FusionMethod,
  topK: number
): FusedSearchResult[] {
  if (strategyResults.length === 0) {
    return [];
  }

  // Single strategy: no fusion needed, just pass through
  if (strategyResults.length === 1) {
    return strategyResults[0].results.slice(0, topK).map((result, rank) => ({
      ...result,
      fusedScore: result.score,
      strategyScores: [
        {
          strategyId: strategyResults[0].strategyId,
          rank: rank + 1,
          score: result.score,
        },
      ],
    }));
  }

  switch (method) {
    case 'rrf':
      return reciprocalRankFusion(strategyResults, strategyConfigs, topK);
    case 'weighted_score':
      return weightedScoreFusion(strategyResults, strategyConfigs, topK);
    default:
      return reciprocalRankFusion(strategyResults, strategyConfigs, topK);
  }
}

/**
 * Reciprocal Rank Fusion (RRF)
 *
 * A well-proven rank-based fusion method. For each chunk, the fused score is:
 *   score = Σ (weight_i / (k + rank_i))
 *
 * where k is a constant (typically 60) that dampens the influence of high ranks,
 * and weight_i is the strategy's configured weight.
 *
 * RRF is robust because it uses ranks instead of raw scores, making it
 * insensitive to score scale differences between strategies.
 *
 * Reference: Cormack, Clarke & Buettcher (2009) "Reciprocal Rank Fusion
 * outperforms Condorcet and individual Rank Learning Methods"
 */
function reciprocalRankFusion(
  strategyResults: StrategySearchResult[],
  strategyConfigs: StrategyConfig[],
  topK: number
): FusedSearchResult[] {
  const RRF_K = 60; // Standard RRF constant

  // Build weight lookup
  const weightMap = new Map<string, number>();
  for (const config of strategyConfigs) {
    weightMap.set(config.type, config.weight);
  }

  // Accumulate scores per chunk ID
  const chunkMap = new Map<string, {
    result: SearchResult;
    fusedScore: number;
    strategyScores: Array<{ strategyId: string; rank: number; score: number }>;
  }>();

  for (const { strategyId, results } of strategyResults) {
    const weight = weightMap.get(strategyId) ?? 1.0;

    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const rrfContribution = weight / (RRF_K + rank + 1);

      const existing = chunkMap.get(result.id);
      if (existing) {
        existing.fusedScore += rrfContribution;
        existing.strategyScores.push({
          strategyId,
          rank: rank + 1,
          score: result.score,
        });
      } else {
        chunkMap.set(result.id, {
          result,
          fusedScore: rrfContribution,
          strategyScores: [{
            strategyId,
            rank: rank + 1,
            score: result.score,
          }],
        });
      }
    }
  }

  // Sort by fused score descending and take topK
  return Array.from(chunkMap.values())
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK)
    .map(({ result, fusedScore, strategyScores }) => ({
      ...result,
      fusedScore,
      strategyScores,
    }));
}

/**
 * Weighted Score Fusion
 *
 * Combines raw similarity scores from each strategy using configured weights:
 *   fused_score = Σ (weight_i * score_i) / Σ weight_i
 *
 * For chunks that only appear in some strategies' results, missing scores
 * are treated as 0. This is simpler than RRF but sensitive to score
 * calibration differences between strategies.
 */
function weightedScoreFusion(
  strategyResults: StrategySearchResult[],
  strategyConfigs: StrategyConfig[],
  topK: number
): FusedSearchResult[] {
  // Build weight lookup
  const weightMap = new Map<string, number>();
  let totalWeight = 0;
  for (const config of strategyConfigs) {
    if (config.enabled) {
      weightMap.set(config.type, config.weight);
      totalWeight += config.weight;
    }
  }

  if (totalWeight === 0) totalWeight = 1;

  // Accumulate weighted scores per chunk ID
  const chunkMap = new Map<string, {
    result: SearchResult;
    weightedScoreSum: number;
    strategyScores: Array<{ strategyId: string; rank: number; score: number }>;
  }>();

  for (const { strategyId, results } of strategyResults) {
    const weight = weightMap.get(strategyId) ?? 1.0;

    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const weightedScore = weight * result.score;

      const existing = chunkMap.get(result.id);
      if (existing) {
        existing.weightedScoreSum += weightedScore;
        existing.strategyScores.push({
          strategyId,
          rank: rank + 1,
          score: result.score,
        });
      } else {
        chunkMap.set(result.id, {
          result,
          weightedScoreSum: weightedScore,
          strategyScores: [{
            strategyId,
            rank: rank + 1,
            score: result.score,
          }],
        });
      }
    }
  }

  // Normalize by total weight and sort
  return Array.from(chunkMap.values())
    .sort((a, b) => b.weightedScoreSum - a.weightedScoreSum)
    .slice(0, topK)
    .map(({ result, weightedScoreSum, strategyScores }) => ({
      ...result,
      fusedScore: weightedScoreSum / totalWeight,
      strategyScores,
    }));
}
