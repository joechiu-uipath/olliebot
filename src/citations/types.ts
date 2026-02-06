/**
 * Citation System Types
 *
 * Core type definitions for the citation system that tracks and displays
 * sources of information used in tool outputs.
 */

/**
 * Type of citation source
 */
export type CitationSourceType =
  | 'web'
  | 'file'
  | 'api'
  | 'database'
  | 'memory'
  | 'skill'
  | 'mcp';

/**
 * A citable source from tool output
 */
export interface CitationSource {
  /** Unique identifier for this source */
  id: string;

  /** Type of source */
  type: CitationSourceType;

  /** Tool that produced this source */
  toolName: string;
  toolRequestId: string;

  /** Source identification */
  uri?: string; // URL or file path
  title?: string; // Page title or filename
  domain?: string; // e.g., "example.com"
  favicon?: string; // Favicon URL for web sources

  /** Content */
  snippet?: string; // Brief excerpt (for previews)
  fullContent?: string; // Complete content (for RAG)

  /** Metadata */
  timestamp?: string; // When source was accessed
  author?: string; // Content author if known
  publishedDate?: string; // Publication date if known

  /** Location within document (for file sources) */
  pageNumber?: number; // For PDF sources
  lineStart?: number; // For text files
  lineEnd?: number;

  /** Project context (for RAG file sources) */
  projectId?: string; // RAG project ID for constructing document URLs
}

/**
 * A reference from response text to sources
 */
export interface CitationReference {
  /** Unique identifier */
  id: string;

  /** Display index (e.g., [1], [2]) */
  index: number;

  /** Text span in response */
  startIndex: number;
  endIndex: number;
  citedText: string;

  /** Source references */
  sourceIds: string[];
}

/**
 * Full citation context for an assistant response
 */
export interface CitationContext {
  /** Response message ID */
  messageId: string;

  /** All sources available for this response */
  sources: CitationSource[];

  /** References linking text to sources */
  references: CitationReference[];

  /** Generation metadata */
  generatedAt: string;
  modelUsed?: string;
}

/**
 * Extracts citation sources from tool output
 */
export interface CitationExtractor {
  /** Tool name pattern this extractor handles */
  pattern: string | RegExp;

  /** Extract citations from tool result */
  extract(
    requestId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[];
}

/**
 * Citation data stored with messages (simplified for storage)
 */
export interface StoredCitationData {
  sources: Array<{
    id: string;
    type: CitationSourceType;
    toolName: string;
    uri?: string;
    title?: string;
    domain?: string;
    snippet?: string;
    pageNumber?: number;
    projectId?: string;
  }>;
  references: Array<{
    index: number;
    startIndex: number;
    endIndex: number;
    sourceIds: string[];
  }>;
}

/**
 * Citation configuration options
 */
export interface CitationConfig {
  /** Enable/disable citation system */
  enabled: boolean;

  /** Citation display format */
  format: 'brackets' | 'superscript' | 'inline-links';

  /** Show source panel by default */
  expandSourcesByDefault: boolean;

  /** Max sources to display */
  maxSourcesDisplayed: number;

  /** Tools to extract citations from (glob patterns) */
  enabledTools: string[];

  /** Show hover tooltips */
  enableTooltips: boolean;
}

/**
 * Default citation configuration
 */
export const DEFAULT_CITATION_CONFIG: CitationConfig = {
  enabled: true,
  format: 'brackets',
  expandSourcesByDefault: false,
  maxSourcesDisplayed: 10,
  enabledTools: ['*'],
  enableTooltips: true,
};
