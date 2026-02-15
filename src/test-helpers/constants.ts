/**
 * Test Constants
 *
 * Centralized constants used across test files to avoid magic numbers
 * and improve maintainability.
 */

// Snippet/Content Truncation Limits
export const WEB_SCRAPE_SNIPPET_MAX_LENGTH = 200;
export const RAG_QUERY_SNIPPET_MAX_LENGTH = 400;
export const HTTP_CLIENT_SNIPPET_MAX_LENGTH = 200;

// Buffer and Collection Limits
export const MCP_ARRAY_RESULTS_LIMIT = 10;
export const LOG_BUFFER_MAX_QUERY_LIMIT = 500;
export const LOG_BUFFER_MIN_QUERY_LIMIT = 1;

// Data Size Thresholds
export const BASE64_MIN_LENGTH_THRESHOLD = 1000;
export const DATA_SIZE_CALCULATION_KB_DIVISOR = 1024;

// Test Buffer Sizes
export const SMALL_TEST_BUFFER_SIZE = 5;
export const MEDIUM_TEST_BUFFER_SIZE = 10;
export const LARGE_TEST_BUFFER_SIZE = 1000;

// Statistical Test Constants
export const STATISTICAL_SIGNIFICANCE_LEVEL = 0.05;
export const CONFIDENCE_INTERVAL_PRECISION = 5;

// Effect Size Thresholds (Cohen's d)
export const EFFECT_SIZE_NEGLIGIBLE_THRESHOLD = 0.2;
export const EFFECT_SIZE_SMALL_THRESHOLD = 0.5;
export const EFFECT_SIZE_MEDIUM_THRESHOLD = 0.8;

// Test Score Values
export const PERFECT_SCORE = 1.0;
export const HALF_SCORE = 0.5;
export const ZERO_SCORE = 0.0;

// Test Data Patterns
export const LONG_STRING_LENGTH_300 = 300;
export const LONG_STRING_LENGTH_500 = 500;
export const LONG_STRING_LENGTH_2000 = 2000;
export const VERY_LONG_STRING_LENGTH_10240 = 10240; // ~10KB

// Test Timing
export const DEFAULT_TEST_DURATION_MS = 100;
export const SHORT_TEST_DURATION_MS = 10;
export const MEDIUM_TEST_DURATION_MS = 50;
export const LONG_TEST_DURATION_MS = 150;

// Default Test Values
export const DEFAULT_TEST_PORT = 3000;
export const ALTERNATIVE_TEST_PORT = 8080;
export const DEFAULT_BIND_ADDRESS = '127.0.0.1';

// Statistical Computation
export const DECIMAL_PLACES_TWO = 2;
export const DECIMAL_PLACES_TEN = 10;

// Sample Sizes
export const MIN_SAMPLE_SIZE_FOR_OUTLIERS = 4;
export const SMALL_SAMPLE_SIZE = 3;
export const MEDIUM_SAMPLE_SIZE = 5;
export const LARGE_SAMPLE_SIZE = 600;

// Test Identifiers Prefixes
export const TEST_REQUEST_ID_PREFIX = 'req-';
export const TEST_RUN_ID_PREFIX = 'run-';
export const TEST_PROJECT_ID_PREFIX = 'proj-';
export const TEST_SOURCE_ID_PREFIX = 'src-';
export const TEST_REF_ID_PREFIX = 'ref-';
export const TEST_ELEMENT_ID_PREFIX = 'e';

// Common Test Strings
export const TEST_QUERY = 'test query';
export const TEST_MESSAGE = 'test message';
export const TEST_TIMESTAMP = '2024-01-01T00:00:00Z';
export const TEST_URL = 'https://example.com';
export const TEST_DOMAIN = 'example.com';
