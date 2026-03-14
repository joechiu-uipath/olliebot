/**
 * Shared test constants for API integration tests
 *
 * Centralizes magic numbers to improve test readability and maintainability.
 */

// ---------------------------------------------------------------------------
// HTTP Status Codes
// ---------------------------------------------------------------------------

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// ---------------------------------------------------------------------------
// Timeouts (in milliseconds)
// ---------------------------------------------------------------------------

export const TIMEOUTS = {
  /** Brief pause for async operations to settle */
  BRIEF: 100,
  /** Short wait for database operations */
  SHORT: 200,
  /** Standard wait for message processing */
  STANDARD: 500,
  /** WebSocket connection timeout */
  WS_CONNECT: 3_000,
  /** LLM response streaming timeout */
  LLM_STREAM: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Conversation & Message Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Maximum conversation title length */
  CONVERSATION_TITLE_MAX: 100,
  /** Minimum messages per page */
  MESSAGE_PAGE_MIN: 1,
  /** Maximum messages per page */
  MESSAGE_PAGE_MAX: 100,
  /** Default page size for testing */
  DEFAULT_PAGE_SIZE: 5,
  /** Large page size for testing clamping */
  LARGE_PAGE_SIZE: 999,
} as const;

// ---------------------------------------------------------------------------
// Test Data Sizes
// ---------------------------------------------------------------------------

export const TEST_SIZES = {
  /** Small dataset for basic tests */
  SMALL: 5,
  /** Medium dataset for pagination tests */
  MEDIUM: 10,
  /** Large dataset for pagination edge cases */
  LARGE: 15,
  /** String length to exceed title limit */
  LONG_TITLE: 150,
} as const;
