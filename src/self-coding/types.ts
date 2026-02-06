/**
 * Self-Coding Types
 *
 * Type definitions for the self-modifying code system.
 */

/**
 * A single atomic code change specification.
 */
export interface CodeChange {
  /** Unique identifier for this change */
  id: string;
  /** Relative path from /web directory */
  file_path: string;
  /** Human-readable description of the change */
  description: string;
  /** Type of file operation */
  operation: 'create' | 'edit' | 'delete';
  /** For edit operations: the type of edit */
  edit_type?: 'replace' | 'insert_before' | 'insert_after' | 'append' | 'prepend' | 'full_replace';
  /** For replace/insert operations: the target string to find */
  target?: string;
  /** For create/edit operations: the content to write */
  content?: string;
  /** Optional priority (lower = higher priority) */
  priority?: number;
  /** Dependencies on other change IDs */
  depends_on?: string[];
}

/**
 * A plan containing multiple code changes.
 */
export interface CodeChangePlan {
  /** Summary of the overall change */
  summary: string;
  /** List of atomic changes in execution order */
  changes: CodeChange[];
  /** Any warnings or considerations */
  warnings?: string[];
  /** Files that will be read to understand context */
  files_to_read?: string[];
}

/**
 * Result of executing a single code change.
 */
export interface CodeChangeResult {
  /** ID of the change that was executed */
  change_id: string;
  /** Whether the change succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Details about the change made */
  details?: {
    file_path: string;
    operation: string;
    previous_size?: number;
    new_size?: number;
    line_count?: number;
  };
}

/**
 * Result of the entire self-coding workflow.
 */
export interface SelfCodingResult {
  /** Whether the overall workflow succeeded */
  success: boolean;
  /** Summary of what was done */
  summary: string;
  /** Results for each change */
  change_results: CodeChangeResult[];
  /** Whether the build succeeded after changes */
  build_success?: boolean;
  /** Build output/errors if any */
  build_output?: string;
  /** Git commit hash if changes were committed */
  commit_hash?: string;
  /** Any errors encountered */
  errors?: string[];
}

/**
 * Input for the coding-planner agent.
 */
export interface PlannerInput {
  /** User's request in natural language */
  user_request: string;
  /** Optional context about current frontend state */
  current_context?: string;
  /** Files that were already read for context */
  files_read?: Array<{
    path: string;
    content: string;
  }>;
}

/**
 * Input for the coding-worker agent.
 */
export interface WorkerInput {
  /** The specific change to execute */
  change: CodeChange;
  /** Context from files that were read */
  context?: string;
}
