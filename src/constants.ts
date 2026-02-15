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

// ============================================================
// CONVERSATION HISTORY CONFIGURATION
// ============================================================

/**
 * Number of recent messages to include when generating responses.
 * More messages provide better context but increase token usage.
 */
export const CONVERSATION_HISTORY_LIMIT = 10;

/**
 * Number of recent messages for worker agents (smaller context).
 * Workers handle focused tasks and need less conversation history.
 */
export const WORKER_HISTORY_LIMIT = 5;

// ============================================================
// AGENTIC LOOP CONFIGURATION
// ============================================================

/**
 * Maximum iterations for the tool execution loop.
 * Each iteration = one LLM call that may request tools.
 * The loop continues until:
 * - LLM returns a response without tool calls, OR
 * - This limit is reached
 *
 * Higher values allow more complex multi-step tasks but risk infinite loops.
 * Current: 10 iterations
 */
export const AGENT_MAX_TOOL_ITERATIONS = 10;

/**
 * Maximum concurrent tasks a supervisor can manage.
 * Limits how many sub-agents can be spawned simultaneously.
 */
export const SUPERVISOR_MAX_CONCURRENT_TASKS = 10;

// ============================================================
// CACHE & TIMEOUT CONFIGURATION
// ============================================================

/**
 * TTL for RAG data cache in milliseconds.
 * Agents refresh their RAG context after this duration.
 * Current: 60 seconds
 */
export const RAG_CACHE_TTL_MS = 60_000;

/**
 * How long to keep processed message IDs in memory to prevent re-processing.
 * Protects against duplicate processing from timeouts/retries.
 * Current: 5 minutes
 */
export const MESSAGE_DEDUP_WINDOW_MS = 300_000;

/**
 * Time window for finding a "recent" conversation to continue.
 * If user sends a message without conversationId, we look for a
 * conversation updated within this window before creating a new one.
 * Current: 1 hour
 */
export const RECENT_CONVERSATION_WINDOW_MS = 60 * 60 * 1000;

// ============================================================
// AUTO-NAMING CONFIGURATION
// ============================================================

/**
 * Number of messages before triggering auto-naming.
 * Conversation gets an LLM-generated title after this many messages.
 */
export const AUTO_NAME_MESSAGE_THRESHOLD = 3;

/**
 * Number of messages to load for generating conversation title.
 */
export const AUTO_NAME_MESSAGES_TO_LOAD = 5;

/**
 * Max characters to use from each message for title generation context.
 */
export const AUTO_NAME_CONTENT_PREVIEW_LENGTH = 200;

/**
 * Max tokens for the LLM call that generates conversation titles.
 */
export const AUTO_NAME_LLM_MAX_TOKENS = 20;

/**
 * Max length for conversation titles (truncated if longer).
 */
export const CONVERSATION_TITLE_MAX_LENGTH = 60;

/**
 * Max length for auto-generated title from first message (before LLM naming).
 */
export const CONVERSATION_TITLE_PREVIEW_LENGTH = 30;

// ============================================================
// LLM DEFAULT PARAMETERS
// ============================================================

/**
 * Default max tokens for LLM responses when not specified.
 */
export const LLM_DEFAULT_MAX_TOKENS = 8192;

/**
 * Max tokens for summarization tasks (Fast LLM).
 */
export const LLM_SUMMARIZE_MAX_TOKENS = 1500;

/**
 * Max tokens for task config parsing.
 */
export const LLM_TASK_CONFIG_MAX_TOKENS = 2000;

/**
 * Max retries for LLM API calls with exponential backoff.
 */
export const API_MAX_RETRIES = 3;

/**
 * Base delay for exponential backoff in milliseconds.
 * Actual delay = 2^attempt * base + random(0-1000)ms
 */
export const API_BACKOFF_BASE_MS = 1000;

// ============================================================
// DATA SIZE LIMITS
// ============================================================

/**
 * Max size for tool results containing media (images, etc.) in bytes.
 * Larger results are truncated before storage.
 * Current: 5MB
 */
export const TOOL_RESULT_MEDIA_LIMIT_BYTES = 5_000_000;

/**
 * Max size for tool results containing text/JSON in bytes.
 * Larger results are truncated before storage.
 * Current: 10KB
 */
export const TOOL_RESULT_TEXT_LIMIT_BYTES = 10_000;

/**
 * Maximum file upload size for RAG document ingestion.
 * Current: 50MB
 */
export const MAX_FILE_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

// ============================================================
// RAG CONFIGURATION
// ============================================================

/**
 * Default chunk size for text splitting during RAG ingestion.
 * Smaller chunks = more precise retrieval but more storage.
 */
export const RAG_DEFAULT_CHUNK_SIZE = 1000;

/**
 * Default overlap between chunks for RAG ingestion.
 * Overlap helps preserve context across chunk boundaries.
 */
export const RAG_DEFAULT_CHUNK_OVERLAP = 100;

/**
 * Default number of results to return from RAG queries.
 */
export const RAG_DEFAULT_TOP_K = 10;

/**
 * Reciprocal Rank Fusion (RRF) constant.
 * This dampens the influence of high ranks in the RRF formula: score = weight / (k + rank).
 * Standard value from Cormack, Clarke & Buettcher (2009).
 */
export const RAG_RRF_K = 60;

/**
 * LLM re-ranker relevance score scale (0 to this value).
 * Results are judged on this scale and normalized to 0-1.
 */
export const RAG_RERANKER_MAX_SCORE = 10;

/**
 * Number of chunks from the start of a document to use for generating file summaries.
 */
export const RAG_DOCUMENT_SUMMARY_CHUNK_COUNT = 10;

/**
 * Query word count threshold for keyword strategy.
 * Queries shorter than this are used as-is; longer queries get keyword extraction.
 */
export const RAG_KEYWORD_QUERY_WORD_THRESHOLD = 5;

/**
 * Query word count threshold for summary strategy.
 * Queries shorter than this are used as-is; longer queries get rephrased.
 */
export const RAG_SUMMARY_QUERY_WORD_THRESHOLD = 8;

/**
 * Keyword count range for extraction (lower bound).
 */
export const RAG_KEYWORD_EXTRACTION_MIN = 10;

/**
 * Keyword count range for extraction (upper bound).
 */
export const RAG_KEYWORD_EXTRACTION_MAX = 20;

/**
 * Multiplier for topK when querying individual strategies before fusion.
 * Requesting more results gives fusion a better pool to work with.
 */
export const RAG_STRATEGY_TOPK_MULTIPLIER = 2;

// ============================================================
// QUERY & FETCH LIMITS
// ============================================================

/**
 * Default limit for conversation list queries.
 */
export const DEFAULT_CONVERSATIONS_LIMIT = 50;

/**
 * Default limit for message history queries.
 */
export const DEFAULT_MESSAGES_LIMIT = 100;

/**
 * Default limit for task list queries.
 */
export const DEFAULT_TASKS_LIMIT = 20;

/**
 * Maximum allowed limit for paginated queries.
 * Prevents excessive memory usage from unbounded queries.
 */
export const MAX_QUERY_LIMIT = 100;

// ============================================================
// MISSION CONFIGURATION
// ============================================================

/**
 * Maximum concurrent TODOs in-progress across an entire mission.
 * Controls worker agent dispatch throttle.
 */
export const MISSION_MAX_CONCURRENT_TODOS = 3;

/**
 * Default limit for mission list queries.
 */
export const DEFAULT_MISSIONS_LIMIT = 50;

// ============================================================
// SKILL EXECUTION
// ============================================================

/**
 * Timeout for skill script execution in milliseconds.
 * Current: 2 minutes
 */
export const SKILL_EXECUTION_TIMEOUT_MS = 120_000;

// ============================================================
// DASHBOARD CONFIGURATION
// ============================================================

/**
 * Max tokens for the LLM call that generates dashboard HTML.
 * Higher values allow more complex dashboards with more charts/tables.
 */
export const DASHBOARD_RENDER_MAX_TOKENS = 16384;

/**
 * Temperature for the LLM dashboard rendering call.
 * Low temperature for consistent, predictable HTML output.
 */
export const DASHBOARD_RENDER_TEMPERATURE = 0.3;

/**
 * Default time range for agent analytics snapshots (milliseconds).
 * Current: 24 hours
 */
export const DASHBOARD_DEFAULT_TIME_RANGE_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum traces to fetch when capturing a snapshot.
 */
export const DASHBOARD_MAX_TRACES = 100;

/**
 * Maximum LLM calls to fetch when capturing a snapshot.
 */
export const DASHBOARD_MAX_LLM_CALLS = 500;

/**
 * Maximum tool calls to fetch when capturing a snapshot.
 */
export const DASHBOARD_MAX_TOOL_CALLS = 500;

/**
 * Maximum LLM call summaries to include in metricsJson.
 * Limits payload size sent to the rendering LLM.
 */
export const DASHBOARD_MAX_LLM_CALL_SUMMARIES = 200;

/**
 * Maximum trace summaries to include in metricsJson.
 */
export const DASHBOARD_MAX_TRACE_SUMMARIES = 50;

/**
 * Time series bucket size in milliseconds.
 * Current: 1 hour
 */
export const DASHBOARD_TIME_SERIES_BUCKET_MS = 60 * 60 * 1000;

/**
 * Default retention period for old dashboard snapshots (days).
 * Snapshots older than this are eligible for cleanup.
 */
export const DASHBOARD_DEFAULT_RETENTION_DAYS = 30;

/**
 * Default limit for dashboard snapshot list queries.
 */
export const DASHBOARD_DEFAULT_QUERY_LIMIT = 20;

/**
 * Maximum metricsJson payload size in bytes.
 * Payloads exceeding this are trimmed to prevent LLM context overflow.
 */
export const DASHBOARD_MAX_METRICS_PAYLOAD_BYTES = 50_000;
