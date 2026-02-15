/**
 * Unit tests for Citation Generator helper functions
 *
 * Tests the pure utility functions (isCodeOnly, parseJsonResponse, toStoredCitationData).
 * Does NOT test the LLM-dependent generatePostHocCitations function — that's integration-level.
 * Maps to e2e test plan: CITE-004 (post-hoc citation generation)
 */

import { describe, it, expect } from 'vitest';
import { toStoredCitationData } from './generator.js';
import { 
  buildCitationSource,
  TEST_REQUEST_ID_PREFIX,
  TEST_PROJECT_ID_PREFIX,
  TEST_URL,
  TEST_DOMAIN,
  DEFAULT_TEST_DURATION_MS,
  SHORT_TEST_DURATION_MS,
} from '../test-helpers/index.js';
import type { PostHocCitationResult } from './generator.js';
import type { CitationSource } from './types.js';

describe('toStoredCitationData', () => {
  it('converts PostHocCitationResult to StoredCitationData format', () => {
    const source = buildCitationSource({
      id: `${TEST_REQUEST_ID_PREFIX}1`,
      uri: TEST_URL,
      title: 'Example',
      domain: TEST_DOMAIN,
      snippet: 'A snippet',
      fullContent: 'Full content here',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const result: PostHocCitationResult = {
      references: [
        {
          id: 'ref-0',
          index: 1,
          startIndex: 10,
          endIndex: 30,
          citedText: 'some cited text',
          sourceIds: [`${TEST_REQUEST_ID_PREFIX}1`],
        },
      ],
      usedSources: [source],
      allSources: [source],
      processingTimeMs: DEFAULT_TEST_DURATION_MS,
    };

    const stored = toStoredCitationData(result);

    expect(stored.sources).toHaveLength(1);
    expect(stored.sources[0]).toEqual({
      id: `${TEST_REQUEST_ID_PREFIX}1`,
      type: 'web',
      toolName: 'web_search',
      uri: TEST_URL,
      title: 'Example',
      domain: TEST_DOMAIN,
      snippet: 'A snippet',
      pageNumber: undefined,
      projectId: undefined,
    });

    expect(stored.references).toHaveLength(1);
    expect(stored.references[0]).toEqual({
      index: 1,
      startIndex: 10,
      endIndex: 30,
      sourceIds: [`${TEST_REQUEST_ID_PREFIX}1`],
    });
  });

  it('handles empty result', () => {
    const result: PostHocCitationResult = {
      references: [],
      usedSources: [],
      allSources: [],
      processingTimeMs: 5,
    };

    const stored = toStoredCitationData(result);
    expect(stored.sources).toEqual([]);
    expect(stored.references).toEqual([]);
  });

  it('includes pageNumber and projectId for RAG sources', () => {
    const ragSource = buildCitationSource({
      id: `${TEST_REQUEST_ID_PREFIX}rag`,
      type: 'file',
      toolName: 'query_rag_project',
      toolRequestId: `${TEST_REQUEST_ID_PREFIX}rag`,
      uri: '/docs/guide.pdf',
      title: 'guide.pdf (page 3)',
      pageNumber: 3,
      projectId: `${TEST_PROJECT_ID_PREFIX}1`,
    });

    const result: PostHocCitationResult = {
      references: [],
      usedSources: [ragSource],
      allSources: [ragSource],
      processingTimeMs: SHORT_TEST_DURATION_MS,
    };

    const stored = toStoredCitationData(result);
    expect(stored.sources[0].pageNumber).toBe(3);
    expect(stored.sources[0].projectId).toBe(`${TEST_PROJECT_ID_PREFIX}1`);
  });

  it('strips fullContent and timestamp from stored format', () => {
    const source = buildCitationSource({
      id: `${TEST_REQUEST_ID_PREFIX}2`,
      toolName: 'web_scrape',
      toolRequestId: `${TEST_REQUEST_ID_PREFIX}2`,
      fullContent: 'This should not appear in stored data',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const result: PostHocCitationResult = {
      references: [],
      usedSources: [source],
      allSources: [source],
      processingTimeMs: 5,
    };

    const stored = toStoredCitationData(result);
    expect(stored.sources[0]).not.toHaveProperty('fullContent');
    expect(stored.sources[0]).not.toHaveProperty('timestamp');
  });
});
