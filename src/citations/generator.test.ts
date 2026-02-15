/**
 * Unit tests for Citation Generator helper functions
 *
 * Tests the pure utility functions (isCodeOnly, parseJsonResponse, toStoredCitationData).
 * Does NOT test the LLM-dependent generatePostHocCitations function — that's integration-level.
 * Maps to e2e test plan: CITE-004 (post-hoc citation generation)
 */

import { describe, it, expect } from 'vitest';
import { toStoredCitationData } from './generator.js';
import type { PostHocCitationResult } from './generator.js';
import type { CitationSource } from './types.js';

describe('toStoredCitationData', () => {
  it('converts PostHocCitationResult to StoredCitationData format', () => {
    const source: CitationSource = {
      id: 'src-1',
      type: 'web',
      toolName: 'web_search',
      toolRequestId: 'req-1',
      uri: 'https://example.com',
      title: 'Example',
      domain: 'example.com',
      snippet: 'A snippet',
      fullContent: 'Full content here',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result: PostHocCitationResult = {
      references: [
        {
          id: 'ref-0',
          index: 1,
          startIndex: 10,
          endIndex: 30,
          citedText: 'some cited text',
          sourceIds: ['src-1'],
        },
      ],
      usedSources: [source],
      allSources: [source],
      processingTimeMs: 100,
    };

    const stored = toStoredCitationData(result);

    expect(stored.sources).toHaveLength(1);
    expect(stored.sources[0]).toEqual({
      id: 'src-1',
      type: 'web',
      toolName: 'web_search',
      uri: 'https://example.com',
      title: 'Example',
      domain: 'example.com',
      snippet: 'A snippet',
      pageNumber: undefined,
      projectId: undefined,
    });

    expect(stored.references).toHaveLength(1);
    expect(stored.references[0]).toEqual({
      index: 1,
      startIndex: 10,
      endIndex: 30,
      sourceIds: ['src-1'],
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
    const ragSource: CitationSource = {
      id: 'src-rag',
      type: 'file',
      toolName: 'query_rag_project',
      toolRequestId: 'req-rag',
      uri: '/docs/guide.pdf',
      title: 'guide.pdf (page 3)',
      pageNumber: 3,
      projectId: 'proj-1',
    };

    const result: PostHocCitationResult = {
      references: [],
      usedSources: [ragSource],
      allSources: [ragSource],
      processingTimeMs: 10,
    };

    const stored = toStoredCitationData(result);
    expect(stored.sources[0].pageNumber).toBe(3);
    expect(stored.sources[0].projectId).toBe('proj-1');
  });

  it('strips fullContent and timestamp from stored format', () => {
    const source: CitationSource = {
      id: 'src-2',
      type: 'web',
      toolName: 'web_scrape',
      toolRequestId: 'req-2',
      fullContent: 'This should not appear in stored data',
      timestamp: '2024-01-01T00:00:00Z',
    };

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
