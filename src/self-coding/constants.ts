/**
 * Self-Coding Workflow Constants
 *
 * These constants control the behavior of the self-modifying code system.
 * The system allows agents to modify the frontend codebase through a
 * structured multi-agent workflow.
 */

// ============================================================
// WORKFLOW IDENTIFIERS
// ============================================================

/**
 * Workflow ID for self-coding (used in delegation restrictions).
 */
export const SELF_CODING_WORKFLOW_ID = 'self-coding';

/**
 * Agent IDs for self-coding agents.
 */
export const AGENT_IDS = {
  /** Orchestrates the coding workflow, validates builds, commits changes */
  LEAD: 'coding-lead',
  /** Plans and breaks down change requests into atomic operations */
  PLANNER: 'coding-planner',
  /** Executes individual code changes using modify_frontend_code tool */
  WORKER: 'coding-worker',
} as const;

// ============================================================
// EXECUTION PARAMETERS
// ============================================================

/**
 * Maximum number of atomic changes per request.
 * Prevents overly complex modifications.
 */
export const MAX_CHANGES_PER_REQUEST = 10;

/**
 * Maximum number of retry attempts for a failed change.
 */
export const MAX_RETRIES_PER_CHANGE = 2;

/**
 * Timeout for sub-agent delegation in milliseconds.
 */
export const SUB_AGENT_TIMEOUT_MS = 180_000; // 3 minutes

/**
 * Timeout for build validation in milliseconds.
 */
export const BUILD_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Maximum number of coding workers that can run in parallel.
 */
export const MAX_PARALLEL_WORKERS = 3;

// ============================================================
// FILE PATH RESTRICTIONS
// ============================================================

/**
 * Base path for frontend code (relative to project root).
 */
export const FRONTEND_BASE_PATH = 'web';

/**
 * Protected files that cannot be deleted (relative to FRONTEND_BASE_PATH).
 */
export const PROTECTED_FILES = [
  'src/main.jsx',
  'index.html',
  'vite.config.js',
  'package.json',
];

// ============================================================
// BUILD COMMANDS
// ============================================================

/**
 * Command to run frontend build for validation.
 */
export const BUILD_COMMAND = 'npm run build';

/**
 * Working directory for build command (relative to project root).
 */
export const BUILD_WORKING_DIR = 'web';

// ============================================================
// GIT INTEGRATION
// ============================================================

/**
 * Whether to auto-commit changes after successful modification.
 */
export const AUTO_COMMIT = true;

/**
 * Commit message prefix for self-coding changes.
 */
export const COMMIT_PREFIX = '[self-coding]';

/**
 * Git working directory (project root).
 */
export const GIT_WORKING_DIR = '.';
