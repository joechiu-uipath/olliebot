/**
 * Test Data Builders
 *
 * Factory functions for creating common test objects with sensible defaults.
 * Reduces duplication and improves test readability.
 */

import type { ToolResult } from '../tools/types.js';
import type { SingleRunResult, ElementMatchResult } from '../evaluation/types.js';
import type { LogEntry } from '../mcp-server/log-buffer.js';
import type { CitationSource } from '../citations/types.js';
import {
  TEST_REQUEST_ID_PREFIX,
  TEST_RUN_ID_PREFIX,
  TEST_PROJECT_ID_PREFIX,
  TEST_SOURCE_ID_PREFIX,
  TEST_TIMESTAMP,
  TEST_URL,
  TEST_DOMAIN,
  DEFAULT_TEST_DURATION_MS,
} from './constants.js';

/**
 * Build a ToolResult with required timing fields and sensible defaults.
 * Override any field by passing partial object.
 */
export function buildToolResult(
  overrides: Partial<ToolResult> & Pick<ToolResult, 'requestId' | 'toolName' | 'success'>
): ToolResult {
  const now = new Date();
  return {
    startTime: now,
    endTime: now,
    durationMs: 0, // Default to 0 for same-time start/end
    ...overrides,
  };
}

/**
 * Build a SingleRunResult for evaluation tests.
 * Override any field by passing partial object.
 */
export function buildSingleRunResult(
  overrides?: Partial<SingleRunResult>
): SingleRunResult {
  const defaultElementResults: ElementMatchResult[] = [];
  
  return {
    runId: `${TEST_RUN_ID_PREFIX}1`,
    timestamp: new Date(),
    promptType: 'baseline',
    rawResponse: 'test response',
    toolCalls: [],
    toolSelectionScore: 1.0,
    responseQualityScore: 1.0,
    overallScore: 1.0,
    elementResults: defaultElementResults,
    constraintViolations: [],
    latencyMs: DEFAULT_TEST_DURATION_MS,
    ...overrides,
  };
}

/**
 * Build a LogEntry for log buffer tests.
 */
export function buildLogEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: TEST_TIMESTAMP,
    level: 'log',
    message: 'test message',
    source: 'server',
    ...overrides,
  };
}

/**
 * Build a CitationSource for citation tests.
 */
export function buildCitationSource(
  overrides?: Partial<CitationSource>
): CitationSource {
  return {
    id: `${TEST_SOURCE_ID_PREFIX}1`,
    type: 'web',
    toolName: 'web_search',
    toolRequestId: `${TEST_REQUEST_ID_PREFIX}1`,
    uri: TEST_URL,
    title: 'Test Source',
    domain: TEST_DOMAIN,
    ...overrides,
  };
}

/**
 * Build a web search result object (for extractor tests).
 */
export function buildWebSearchResult(overrides?: {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}) {
  return {
    title: 'Test Result',
    link: TEST_URL,
    snippet: 'Test snippet',
    position: 1,
    ...overrides,
  };
}

/**
 * Build a RAG query result object (for extractor tests).
 */
export function buildRagQueryResult(overrides?: {
  documentPath?: string;
  text?: string;
  score?: number;
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
}) {
  return {
    documentPath: '/docs/test.pdf',
    text: 'Test content',
    score: 0.9,
    chunkIndex: 0,
    ...overrides,
  };
}

/**
 * Build a tool call record for evaluation tests.
 */
export function buildToolCall(overrides?: {
  toolName?: string;
  parameters?: Record<string, unknown>;
  timestamp?: Date;
  order?: number;
}) {
  return {
    toolName: 'test_tool',
    parameters: {},
    timestamp: new Date(),
    order: 0,
    ...overrides,
  };
}

/**
 * Generate a repeated string pattern for testing truncation.
 */
export function repeatString(char: string, length: number): string {
  return char.repeat(length);
}

/**
 * Generate a data URL with specified size for binary stripping tests.
 */
export function buildDataUrl(sizeBytes: number = 100): string {
  const base64Data = repeatString('A', sizeBytes);
  return `data:image/png;base64,${base64Data}`;
}

/**
 * Generate a base64-like string (alphanumeric) of specified length.
 */
export function buildBase64String(length: number): string {
  return repeatString('A', length);
}
