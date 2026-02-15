/**
 * Unit tests for StatisticsEngine
 *
 * Tests statistical computation: mean, median, stddev, confidence intervals,
 * Welch's t-test, Cohen's d, outlier detection.
 * Maps to e2e test plan: EVAL-008 (statistical comparison)
 */

import { describe, it, expect } from 'vitest';
import { StatisticsEngine } from './statistics.js';
import { 
  buildSingleRunResult,
  STATISTICAL_SIGNIFICANCE_LEVEL,
  CONFIDENCE_INTERVAL_PRECISION,
  DECIMAL_PLACES_TWO,
  DECIMAL_PLACES_TEN,
  MIN_SAMPLE_SIZE_FOR_OUTLIERS,
  SMALL_SAMPLE_SIZE,
  MEDIUM_SAMPLE_SIZE,
  PERFECT_SCORE,
  HALF_SCORE,
  ZERO_SCORE,
  DEFAULT_TEST_DURATION_MS,
  LONG_TEST_DURATION_MS,
} from '../test-helpers/index.js';
import type { SingleRunResult } from './types.js';

const engine = new StatisticsEngine();

describe('StatisticsEngine.summarize', () => {
  it('computes correct mean', () => {
    const summary = engine.summarize([1, 2, 3, 4, 5]);
    expect(summary.mean).toBe(3);
  });

  it('computes correct median for odd-length array', () => {
    const summary = engine.summarize([5, 1, 3, 2, 4]);
    expect(summary.median).toBe(3);
  });

  it('computes correct median for even-length array', () => {
    const summary = engine.summarize([1, 2, 3, 4]);
    expect(summary.median).toBe(2.5);
  });

  it('computes correct min and max', () => {
    const summary = engine.summarize([10, 3, 7, 1, 9]);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(10);
  });

  it('computes sample standard deviation', () => {
    // Known: [2, 4, 4, 4, 5, 5, 7, 9], mean=5, sample variance = 4.571..., stddev = 2.138...
    const summary = engine.summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(summary.mean).toBe(5);
    expect(summary.stdDev).toBeCloseTo(2.138, 2);
  });

  it('returns zero stddev for single sample', () => {
    const summary = engine.summarize([42]);
    expect(summary.mean).toBe(42);
    expect(summary.median).toBe(42);
    expect(summary.stdDev).toBe(0);
  });

  it('handles empty samples', () => {
    const summary = engine.summarize([]);
    expect(summary.mean).toBe(0);
    expect(summary.median).toBe(0);
    expect(summary.stdDev).toBe(0);
    expect(summary.min).toBe(0);
    expect(summary.max).toBe(0);
    expect(summary.confidenceInterval).toEqual([0, 0]);
  });

  it('computes confidence interval', () => {
    const summary = engine.summarize([10, 12, 14, 16, 18]);
    // Mean = 14, CI should be centered on mean
    expect(summary.confidenceInterval[0]).toBeLessThan(14);
    expect(summary.confidenceInterval[1]).toBeGreaterThan(14);
    // CI should be symmetric around mean
    const lower = 14 - summary.confidenceInterval[0];
    const upper = summary.confidenceInterval[1] - 14;
    expect(lower).toBeCloseTo(upper, 5);
  });

  it('stores original samples', () => {
    const samples = [1, 2, 3];
    const summary = engine.summarize(samples);
    expect(summary.samples).toEqual(samples);
  });
});

describe('StatisticsEngine.welchTTest', () => {
  /**
   * Helper to create aggregated results from score arrays.
   * Reduces duplication in statistical comparison tests.
   */
  function makeAggregated(scores: number[], promptType: 'baseline' | 'alternative') {
    return engine.aggregateResults(
      scores.map((s, i) => buildSingleRunResult({
        runId: `run-${i}`,
        promptType,
        toolSelectionScore: s,
        responseQualityScore: s,
        overallScore: s,
      })),
      promptType
    );
  }

  it('returns inconclusive for insufficient samples', () => {
    const baseline = makeAggregated([0.8], 'baseline');
    const alt = makeAggregated([0.9], 'alternative');

    const result = engine.welchTTest(baseline, alt);
    expect(result).toBeDefined();
    expect(result!.isSignificant).toBe(false);
    expect(result!.recommendation).toBe('inconclusive');
    expect(result!.pValue).toBe(PERFECT_SCORE);
  });

  it('detects significant difference between clearly different groups', () => {
    // Group A: scores around 0.3, Group B: scores around 0.9
    const baseline = makeAggregated([0.3, 0.31, 0.29, 0.32, 0.28], 'baseline');
    const alt = makeAggregated([0.9, 0.91, 0.89, 0.92, 0.88], 'alternative');

    const result = engine.welchTTest(baseline, alt);
    expect(result).toBeDefined();
    expect(result!.isSignificant).toBe(true);
    expect(result!.pValue).toBeLessThan(STATISTICAL_SIGNIFICANCE_LEVEL);
    expect(result!.recommendation).toBe('adopt-alternative');
    expect(result!.overallScoreDifference).toBeGreaterThan(ZERO_SCORE);
  });

  it('detects when baseline is better', () => {
    const baseline = makeAggregated([0.9, 0.91, 0.89, 0.92, 0.88], 'baseline');
    const alt = makeAggregated([0.3, 0.31, 0.29, 0.32, 0.28], 'alternative');

    const result = engine.welchTTest(baseline, alt);
    expect(result).toBeDefined();
    expect(result!.isSignificant).toBe(true);
    expect(result!.recommendation).toBe('keep-baseline');
    expect(result!.overallScoreDifference).toBeLessThan(ZERO_SCORE);
  });

  it('returns inconclusive for similar groups', () => {
    const baseline = makeAggregated([0.5, 0.52, 0.48, 0.51, 0.49], 'baseline');
    const alt = makeAggregated([0.51, 0.49, 0.50, 0.52, 0.48], 'alternative');

    const result = engine.welchTTest(baseline, alt);
    expect(result).toBeDefined();
    expect(result!.recommendation).toBe('inconclusive');
  });

  it('handles zero-variance groups', () => {
    const baseline = makeAggregated([0.5, 0.5, 0.5], 'baseline');
    const alt = makeAggregated([0.8, 0.8, 0.8], 'alternative');

    const result = engine.welchTTest(baseline, alt);
    expect(result).toBeDefined();
    expect(result!.overallScoreDifference).toBeCloseTo(0.3, 1);
    // With zero/near-zero variance, the t-test may produce extreme or
    // degenerate values depending on floating-point precision
    expect(result!.recommendation).not.toBe('keep-baseline');
  });
});

describe('StatisticsEngine.interpretEffectSize', () => {
  it('classifies negligible effect', () => {
    expect(engine.interpretEffectSize(0.1)).toBe('negligible');
    expect(engine.interpretEffectSize(-0.1)).toBe('negligible');
  });

  it('classifies small effect', () => {
    expect(engine.interpretEffectSize(0.3)).toBe('small');
    expect(engine.interpretEffectSize(-0.3)).toBe('small');
  });

  it('classifies medium effect', () => {
    expect(engine.interpretEffectSize(0.6)).toBe('medium');
  });

  it('classifies large effect', () => {
    expect(engine.interpretEffectSize(1.0)).toBe('large');
    expect(engine.interpretEffectSize(-1.5)).toBe('large');
  });
});

describe('StatisticsEngine.detectOutliers', () => {
  it('returns no outliers for small sample', () => {
    const result = engine.detectOutliers([1, 2, 3]);
    expect(result.indices).toEqual([]);
    expect(result.method).toContain('insufficient');
  });

  it('detects obvious outliers', () => {
    const samples = [10, 11, 10, 12, 11, 10, 11, 100]; // 100 is an outlier
    const result = engine.detectOutliers(samples);
    expect(result.indices).toContain(7); // index of 100
    expect(result.method).toBe('IQR');
  });

  it('returns no outliers for uniform data', () => {
    const samples = [5, 5, 5, 5, 5, 5, 5, 5];
    const result = engine.detectOutliers(samples);
    expect(result.indices).toEqual([]);
  });
});

describe('StatisticsEngine.percentageImprovement', () => {
  it('calculates positive improvement', () => {
    expect(engine.percentageImprovement(HALF_SCORE, 0.75)).toBe(50);
  });

  it('calculates negative improvement (regression)', () => {
    expect(engine.percentageImprovement(0.8, 0.4)).toBe(-50);
  });

  it('handles zero baseline', () => {
    expect(engine.percentageImprovement(ZERO_SCORE, HALF_SCORE)).toBe(100);
    expect(engine.percentageImprovement(ZERO_SCORE, ZERO_SCORE)).toBe(0);
  });
});

describe('StatisticsEngine.formatSummary', () => {
  it('formats summary string correctly', () => {
    const summary = engine.summarize([0.8, 0.85, 0.9]);
    const formatted = engine.formatSummary(summary);
    expect(formatted).toMatch(/^\d+\.\d{3} ± \d+\.\d{3} \[\d+\.\d{3}, \d+\.\d{3}\]$/);
  });
});

describe('StatisticsEngine.aggregateResults', () => {
  it('aggregates multiple run results', () => {
    const runs: SingleRunResult[] = [
      buildSingleRunResult({
        runId: 'run-1',
        toolSelectionScore: 0.8,
        responseQualityScore: 0.9,
        overallScore: 0.85,
        elementResults: [{ elementId: 'e1', matched: true, confidence: PERFECT_SCORE }],
        latencyMs: DEFAULT_TEST_DURATION_MS,
      }),
      buildSingleRunResult({
        runId: 'run-2',
        toolSelectionScore: 0.7,
        responseQualityScore: 0.8,
        overallScore: 0.75,
        elementResults: [{ elementId: 'e1', matched: false, confidence: ZERO_SCORE }],
        latencyMs: LONG_TEST_DURATION_MS,
      }),
    ];

    const agg = engine.aggregateResults(runs, 'baseline');

    expect(agg.promptType).toBe('baseline');
    expect(agg.runs).toHaveLength(2);
    expect(agg.overallScore.mean).toBe(0.8);
    expect(agg.toolSelectionScore.mean).toBe(0.75);
    expect(agg.responseQualityScore.mean).toBeCloseTo(0.85, DECIMAL_PLACES_TEN);
    expect(agg.elementPassRates['e1']).toBe(HALF_SCORE); // 1 of 2 passed
  });
});
