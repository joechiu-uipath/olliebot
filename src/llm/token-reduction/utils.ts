/**
 * Token Reduction Utilities
 *
 * Shared helper functions for token reduction calculations and formatting.
 * Extracted to avoid duplication across service, provider, and UI layers.
 */

// ============================================================
// Constants
// ============================================================

/** Estimated characters per token (heuristic for token count estimation) */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Maximum length for text preview in trace storage (chars) */
export const TRACE_TEXT_PREVIEW_LENGTH = 2000;

/** Workload-specific activation thresholds (min chars to trigger compression) */
export const WORKLOAD_THRESHOLDS = {
  main: 1000,
  fast: 2000,
} as const;

// ============================================================
// Calculation Helpers
// ============================================================

/**
 * Calculate percentage of tokens saved by compression.
 * Returns a value between 0-100 with 2 decimal precision.
 */
export function calculateSavingsPercent(
  originalTokens: number,
  compressedTokens: number
): number {
  if (originalTokens <= 0) return 0;
  const savings = originalTokens - compressedTokens;
  return Math.round((savings / originalTokens) * 10000) / 100;
}

/**
 * Estimate token count from text length using heuristic.
 * Useful when actual tokenization is not available.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// ============================================================
// Text Processing
// ============================================================

/**
 * Truncate text to maximum length for storage/display.
 * Returns undefined if input is null/undefined.
 */
export function truncateForStorage(
  text: string | null | undefined,
  maxLength = TRACE_TEXT_PREVIEW_LENGTH
): string | undefined {
  if (!text) return undefined;
  return text.substring(0, maxLength);
}
