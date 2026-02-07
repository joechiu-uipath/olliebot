/**
 * Application-wide constants
 */

export const SUPERVISOR_ICON = '🐙';
export const SUPERVISOR_NAME = 'OllieBot';
export const DEFAULT_AGENT_ICON = '🤖';

// ============================================================
// AGENT TIMEOUT CONFIGURATION
// ============================================================

/**
 * Timeout for sub-agent delegation in milliseconds.
 * This is how long a parent agent will wait for a sub-agent to complete.
 *
 * IMPORTANT: If research workers are timing out, increase this value.
 * The timeout should account for:
 * - Multiple web searches (each ~1s)
 * - Multiple web scrapes (each ~10-20s)
 * - LLM processing time
 * - Network latency
 *
 * Current: 10 minutes (600,000ms)
 */
export const SUB_AGENT_TIMEOUT_MS = 600_000;

// ============================================================
// CITATION GENERATOR CONFIGURATION
// ============================================================

/**
 * Maximum characters to include from source snippets in citation prompts.
 * Longer snippets provide more context but increase token usage.
 */
export const CITATION_SOURCE_SNIPPET_LIMIT = 500;

/**
 * Number of sources to process per batch in citation generation.
 * Larger batches are more efficient but may hit token limits.
 */
export const CITATION_BATCH_SIZE = 50;

/**
 * Maximum concurrent citation batches to process in parallel.
 * Higher values are faster but may hit API rate limits.
 */
export const CITATION_MAX_CONCURRENT_BATCHES = 3;

/**
 * Minimum response length (chars) to trigger citation generation.
 * Very short responses are skipped to avoid unnecessary processing.
 */
export const CITATION_MIN_RESPONSE_LENGTH = 50;

/**
 * Substring length for fallback citation matching.
 * When exact match fails, try matching the first N characters.
 */
export const CITATION_FALLBACK_SUBSTRING_LENGTH = 40;

/**
 * Code percentage threshold for skipping citation generation.
 * If more than this fraction of the response is code, skip citations.
 */
export const CITATION_CODE_THRESHOLD = 0.8;

/**
 * Max tokens for citation LLM response.
 */
export const CITATION_LLM_MAX_TOKENS = 4000;
