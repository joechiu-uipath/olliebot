/**
 * Unit tests for Citation Generator helper functions
 *
 * Tests the pure utility functions (isCodeOnly, parseJsonResponse, toStoredCitationData)
 * and the early-return paths of generatePostHocCitations.
 * Maps to e2e test plan: CITE-004 (post-hoc citation generation)
 */

import { describe, it, expect, vi } from 'vitest';
import { toStoredCitationData, generatePostHocCitations } from './generator.js';
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

describe('generatePostHocCitations - early returns', () => {
  it('returns empty result when no sources provided', async () => {
    const mockLlmService = {} as any; // Not called for early return

    const result = await generatePostHocCitations(
      mockLlmService,
      'Some response text that is long enough to not be skipped.',
      []
    );

    expect(result.references).toEqual([]);
    expect(result.usedSources).toEqual([]);
    expect(result.allSources).toEqual([]);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty result for short response', async () => {
    const mockLlmService = {} as any;
    const source = buildCitationSource();

    const result = await generatePostHocCitations(
      mockLlmService,
      'Short', // Less than CITATION_MIN_RESPONSE_LENGTH (50)
      [source]
    );

    expect(result.references).toEqual([]);
    expect(result.usedSources).toEqual([]);
    expect(result.allSources).toEqual([source]);
  });

  it('returns empty result for code-heavy response', async () => {
    const mockLlmService = {} as any;
    const source = buildCitationSource();

    // Create a response that's >80% code blocks
    const codeBlock = '```javascript\nconst x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\n```';
    const response = `Here is the code:\n${codeBlock}\n${codeBlock}\n${codeBlock}\n${codeBlock}\n${codeBlock}`;

    const result = await generatePostHocCitations(
      mockLlmService,
      response,
      [source]
    );

    expect(result.references).toEqual([]);
    expect(result.allSources).toEqual([source]);
  });

  it('does NOT skip citation for response with moderate code', async () => {
    // If the response has some code but < 80%, it should proceed (not early return)
    // We mock the LLM to verify it gets called
    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({ content: '{"citations": []}' }),
    } as any;
    const source = buildCitationSource({ snippet: 'Relevant content here' });

    // More text than code
    const response = 'This is a long explanation about how the system works. '.repeat(5)
      + '```js\nconst x = 1;\n```';

    await generatePostHocCitations(mockLlmService, response, [source]);

    // LLM should have been called since the response is not code-heavy
    expect(mockLlmService.quickGenerate).toHaveBeenCalled();
  });
});

describe('generatePostHocCitations - LLM integration', () => {
  it('handles LLM returning JSON with markdown code fences', async () => {
    const source = buildCitationSource({
      id: 'src-1',
      title: 'Test Source',
      snippet: 'The capital of France is Paris.',
    });

    const response = 'According to sources, the capital of France is Paris. This is a well-known fact.';

    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({
        content: '```json\n{"citations": [{"claim": "the capital of France is Paris", "sourceIndex": 1, "confidence": "full"}]}\n```',
      }),
    } as any;

    const result = await generatePostHocCitations(mockLlmService, response, [source]);

    expect(result.references.length).toBeGreaterThanOrEqual(1);
    expect(result.usedSources).toHaveLength(1);
    expect(result.usedSources[0].id).toBe('src-1');
  });

  it('handles LLM returning empty citations', async () => {
    const source = buildCitationSource();
    const response = 'A response that has no citable claims but is long enough to process for citations.';

    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({
        content: '{"citations": []}',
      }),
    } as any;

    const result = await generatePostHocCitations(mockLlmService, response, [source]);

    expect(result.references).toEqual([]);
    expect(result.usedSources).toEqual([]);
  });

  it('handles LLM returning malformed JSON gracefully', async () => {
    const source = buildCitationSource();
    const response = 'A response with enough content to be processed for citation generation purposes.';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({
        content: 'This is not valid JSON at all!',
      }),
    } as any;

    const result = await generatePostHocCitations(mockLlmService, response, [source]);

    expect(result.references).toEqual([]);
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('skips citations with confidence "none"', async () => {
    const source = buildCitationSource({ id: 'src-1' });
    const response = 'Some long response that contains enough text for citation analysis to proceed.';

    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          citations: [
            { claim: 'Some long response', sourceIndex: 1, confidence: 'none' },
          ],
        }),
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await generatePostHocCitations(mockLlmService, response, [source]);
    logSpy.mockRestore();

    expect(result.references).toEqual([]);
    expect(result.usedSources).toEqual([]);
  });

  it('skips citations with out-of-bounds source index', async () => {
    const source = buildCitationSource({ id: 'src-1' });
    const response = 'Some long response with text that is long enough to proceed with citation generation.';

    const mockLlmService = {
      quickGenerate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          citations: [
            { claim: 'Some long response', sourceIndex: 99, confidence: 'full' },
          ],
        }),
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await generatePostHocCitations(mockLlmService, response, [source]);
    logSpy.mockRestore();

    expect(result.references).toEqual([]);
  });

  it('handles LLM error in batch gracefully', async () => {
    const source = buildCitationSource();
    const response = 'A response with enough content to be processed for citation generation purposes.';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockLlmService = {
      quickGenerate: vi.fn().mockRejectedValue(new Error('API timeout')),
    } as any;

    const result = await generatePostHocCitations(mockLlmService, response, [source]);

    expect(result.references).toEqual([]);
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
