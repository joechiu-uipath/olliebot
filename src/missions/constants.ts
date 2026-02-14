/**
 * Mission system constants
 *
 * Centralizes domain-specific magic numbers and well-known ID patterns
 * used across the mission module (manager, schema, tools).
 */

// =============================================================================
// TODO capacity defaults
// =============================================================================

/** Maximum concurrent active TODOs (pending + in_progress) per mission */
export const DEFAULT_ACTIVE_TODO_LIMIT = 10;

/** Maximum backlog TODOs per mission */
export const DEFAULT_BACKLOG_TODO_LIMIT = 50;

// =============================================================================
// Metric computation
// =============================================================================

/** Number of recent readings used for trend computation (half-split mean comparison) */
export const TREND_HISTORY_COUNT = 10;

/** Minimum number of readings required before trend can be computed */
export const TREND_MIN_READINGS = 3;

/** Percentage change threshold below which trend is considered "stable" (5%) */
export const TREND_STABILITY_THRESHOLD = 0.05;

/** Number of decimal places for metric value rounding */
export const METRIC_PRECISION = 2;

/** Default number of history entries returned by getMetricHistory() */
export const DEFAULT_METRIC_HISTORY_LIMIT = 30;

// =============================================================================
// Well-known conversation ID patterns
//
// These are non-GUID, slug-derived IDs for mission utility conversations.
// They must be deterministic from slugs (no DB lookup required).
// =============================================================================

/** Metric collection conversation ID for a mission */
export function metricConversationId(missionSlug: string): string {
  return `${missionSlug}-metric`;
}

/** Pillar TODO conversation ID for a mission + pillar */
export function pillarTodoConversationId(missionSlug: string, pillarSlug: string): string {
  return `${missionSlug}-${pillarSlug}-todo`;
}
