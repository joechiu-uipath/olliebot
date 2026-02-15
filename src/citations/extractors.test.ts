/**
 * Unit tests for Citation Extractors
 *
 * Tests the pure extraction logic that converts tool outputs into citation sources.
 * Maps to e2e test plan: CITE-001 (web_search), CITE-002 (web_scrape), CITE-003 (RAG)
 */

import { describe, it, expect } from 'vitest';
import {
  webSearchExtractor,
  webScrapeExtractor,
  ragQueryExtractor,
  wikipediaSearchExtractor,
  httpClientExtractor,
  mcpToolExtractor,
  getDefaultExtractors,
} from './extractors.js';
import {
  testPattern,
  buildWebSearchResult,
  buildRagQueryResult,
  repeatString,
  TEST_REQUEST_ID_PREFIX,
  TEST_PROJECT_ID_PREFIX,
  TEST_URL,
  TEST_DOMAIN,
  WEB_SCRAPE_SNIPPET_MAX_LENGTH,
  RAG_QUERY_SNIPPET_MAX_LENGTH,
  HTTP_CLIENT_SNIPPET_MAX_LENGTH,
  MCP_ARRAY_RESULTS_LIMIT,
  LONG_STRING_LENGTH_300,
  LONG_STRING_LENGTH_500,
  SHORT_TEST_DURATION_MS,
  MEDIUM_TEST_DURATION_MS,
} from '../test-helpers/index.js';

describe('webSearchExtractor', () => {
  it('matches only web_search tool name', () => {
    expect(testPattern(webSearchExtractor.pattern, 'web_search')).toBe(true);
    expect(testPattern(webSearchExtractor.pattern, 'web_scrape')).toBe(false);
    expect(testPattern(webSearchExtractor.pattern, 'search')).toBe(false);
  });

  it('extracts citations from search results', () => {
    const output = {
      query: 'test query',
      provider: 'tavily',
      results: [
        buildWebSearchResult({ 
          title: 'Result 1', 
          link: `${TEST_URL}/page1`, 
          snippet: 'Snippet 1', 
          position: 1 
        }),
        buildWebSearchResult({ 
          title: 'Result 2', 
          link: `https://www.${TEST_DOMAIN}/page2`, 
          snippet: 'Snippet 2', 
          position: 2 
        }),
      ],
      totalResults: 2,
    };

    const sources = webSearchExtractor.extract(`${TEST_REQUEST_ID_PREFIX}1`, 'web_search', {}, output);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      id: `${TEST_REQUEST_ID_PREFIX}1-0`,
      type: 'web',
      toolName: 'web_search',
      toolRequestId: `${TEST_REQUEST_ID_PREFIX}1`,
      uri: `${TEST_URL}/page1`,
      title: 'Result 1',
      domain: TEST_DOMAIN,
      snippet: 'Snippet 1',
    });
    expect(sources[1].domain).toBe(TEST_DOMAIN); // www. stripped
  });

  it('returns empty array for null/undefined output', () => {
    const requestId = `${TEST_REQUEST_ID_PREFIX}1`;
    expect(webSearchExtractor.extract(requestId, 'web_search', {}, null)).toEqual([]);
    expect(webSearchExtractor.extract(requestId, 'web_search', {}, undefined)).toEqual([]);
  });

  it('returns empty array when results is not an array', () => {
    const requestId = `${TEST_REQUEST_ID_PREFIX}1`;
    expect(webSearchExtractor.extract(requestId, 'web_search', {}, { results: 'not-array' })).toEqual([]);
    expect(webSearchExtractor.extract(requestId, 'web_search', {}, {})).toEqual([]);
  });

  it('handles invalid URLs gracefully', () => {
    const output = {
      query: 'test',
      provider: 'tavily',
      results: [buildWebSearchResult({ title: 'Bad', link: 'not-a-url', snippet: 'test', position: 1 })],
      totalResults: 1,
    };

    const sources = webSearchExtractor.extract(`${TEST_REQUEST_ID_PREFIX}1`, 'web_search', {}, output);
    expect(sources[0].domain).toBe('unknown');
  });
});

describe('webScrapeExtractor', () => {
  it('matches only web_scrape tool name', () => {
    expect(testPattern(webScrapeExtractor.pattern, 'web_scrape')).toBe(true);
    expect(testPattern(webScrapeExtractor.pattern, 'web_search')).toBe(false);
  });

  it('extracts citation from scrape output', () => {
    const output = {
      url: `${TEST_URL}/article`,
      title: 'Test Article',
      metaDescription: 'A test article about testing',
      contentType: 'text/html',
      outputMode: 'markdown',
      content: 'Full article content here...',
      contentLength: 1000,
    };

    const sources = webScrapeExtractor.extract(`${TEST_REQUEST_ID_PREFIX}2`, 'web_scrape', {}, output);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: `${TEST_REQUEST_ID_PREFIX}2-0`,
      type: 'web',
      uri: `${TEST_URL}/article`,
      title: 'Test Article',
      domain: TEST_DOMAIN,
      snippet: 'A test article about testing',
    });
    expect(sources[0].fullContent).toBe('Full article content here...');
  });

  it('uses summary as snippet when metaDescription is absent', () => {
    const output = {
      url: `${TEST_URL}/page`,
      contentType: 'text/html',
      outputMode: 'markdown',
      summary: 'Summary of the page',
      contentLength: 500,
    };

    const sources = webScrapeExtractor.extract(`${TEST_REQUEST_ID_PREFIX}3`, 'web_scrape', {}, output);
    expect(sources[0].snippet).toBe('Summary of the page');
  });

  it('truncates long snippets to max length with ellipsis', () => {
    const longDesc = repeatString('A', LONG_STRING_LENGTH_300);
    const output = {
      url: TEST_URL,
      metaDescription: longDesc,
      contentType: 'text/html',
      outputMode: 'markdown',
      contentLength: LONG_STRING_LENGTH_300,
    };

    const sources = webScrapeExtractor.extract(`${TEST_REQUEST_ID_PREFIX}4`, 'web_scrape', {}, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(WEB_SCRAPE_SNIPPET_MAX_LENGTH + 3); // 3 for '...'
    expect(sources[0].snippet!.endsWith('...')).toBe(true);
  });

  it('returns empty for missing URL', () => {
    const requestId = `${TEST_REQUEST_ID_PREFIX}5`;
    expect(webScrapeExtractor.extract(requestId, 'web_scrape', {}, {})).toEqual([]);
    expect(webScrapeExtractor.extract(requestId, 'web_scrape', {}, null)).toEqual([]);
  });
});

describe('ragQueryExtractor', () => {
  it('matches only query_rag_project tool name', () => {
    expect(testPattern(ragQueryExtractor.pattern, 'query_rag_project')).toBe(true);
    expect(testPattern(ragQueryExtractor.pattern, 'rag_query')).toBe(false);
  });

  it('extracts citations from RAG results', () => {
    const output = {
      projectId: `${TEST_PROJECT_ID_PREFIX}1`,
      query: 'what is testing',
      results: [
        buildRagQueryResult({ 
          documentPath: '/docs/testing.pdf', 
          text: 'Testing is important...', 
          score: 0.95, 
          chunkIndex: 0 
        }),
        buildRagQueryResult({
          documentPath: '/docs/guide.pdf',
          text: 'Guide content...',
          score: 0.8,
          chunkIndex: 1,
          metadata: { pageNumber: 5 },
        }),
      ],
      totalResults: 2,
      queryTimeMs: MEDIUM_TEST_DURATION_MS,
    };

    const sources = ragQueryExtractor.extract(`${TEST_REQUEST_ID_PREFIX}6`, 'query_rag_project', {}, output);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      type: 'file',
      uri: '/docs/testing.pdf',
      title: 'testing.pdf',
      projectId: `${TEST_PROJECT_ID_PREFIX}1`,
    });
    expect(sources[1].title).toBe('guide.pdf (page 5)');
    expect(sources[1].pageNumber).toBe(5);
  });

  it('handles Windows-style paths', () => {
    const output = {
      projectId: `${TEST_PROJECT_ID_PREFIX}2`,
      query: 'test',
      results: [buildRagQueryResult({ documentPath: 'C:\\docs\\file.txt', text: 'content', score: 0.9, chunkIndex: 0 })],
      totalResults: 1,
      queryTimeMs: SHORT_TEST_DURATION_MS,
    };

    const sources = ragQueryExtractor.extract(`${TEST_REQUEST_ID_PREFIX}7`, 'query_rag_project', {}, output);
    expect(sources[0].title).toBe('file.txt');
  });

  it('truncates long text snippets to max length', () => {
    const longText = repeatString('X', LONG_STRING_LENGTH_500);
    const output = {
      projectId: `${TEST_PROJECT_ID_PREFIX}3`,
      query: 'test',
      results: [buildRagQueryResult({ documentPath: 'doc.txt', text: longText, score: 0.9, chunkIndex: 0 })],
      totalResults: 1,
      queryTimeMs: SHORT_TEST_DURATION_MS,
    };

    const sources = ragQueryExtractor.extract(`${TEST_REQUEST_ID_PREFIX}8`, 'query_rag_project', {}, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(RAG_QUERY_SNIPPET_MAX_LENGTH + 3); // 3 for '...'
  });

  it('returns empty for invalid output', () => {
    const requestId = `${TEST_REQUEST_ID_PREFIX}9`;
    expect(ragQueryExtractor.extract(requestId, 'query_rag_project', {}, null)).toEqual([]);
    expect(ragQueryExtractor.extract(requestId, 'query_rag_project', {}, { results: 'bad' })).toEqual([]);
  });
});

describe('wikipediaSearchExtractor', () => {
  it('matches only wikipedia_search tool name', () => {
    expect(testPattern(wikipediaSearchExtractor.pattern, 'wikipedia_search')).toBe(true);
    expect(testPattern(wikipediaSearchExtractor.pattern, 'web_search')).toBe(false);
  });

  it('extracts citations with correct Wikipedia URLs', () => {
    const output = {
      query: 'unit testing',
      results: [
        { title: 'Unit testing', pageid: 12345, snippet: '<span>Unit testing</span> is a method' },
        { title: 'Test driven development', pageid: 67890, snippet: 'TDD is a <b>practice</b>', url: 'https://en.wikipedia.org/wiki/Test-driven_development' },
      ],
    };

    const sources = wikipediaSearchExtractor.extract('req-10', 'wikipedia_search', {}, output);

    expect(sources).toHaveLength(2);
    expect(sources[0].uri).toBe('https://en.wikipedia.org/wiki/Unit_testing');
    expect(sources[0].domain).toBe('wikipedia.org');
    expect(sources[0].snippet).toBe('Unit testing is a method'); // HTML stripped
    expect(sources[1].uri).toBe('https://en.wikipedia.org/wiki/Test-driven_development'); // Uses provided URL
    expect(sources[1].snippet).toBe('TDD is a practice'); // HTML stripped
  });

  it('returns empty for invalid output', () => {
    expect(wikipediaSearchExtractor.extract('req-11', 'wikipedia_search', {}, null)).toEqual([]);
  });
});

describe('httpClientExtractor', () => {
  it('matches only http_client tool name', () => {
    expect(testPattern(httpClientExtractor.pattern, 'http_client')).toBe(true);
    expect(testPattern(httpClientExtractor.pattern, 'web_search')).toBe(false);
  });

  it('extracts citation from HTTP response', () => {
    const params = { url: 'https://api.example.com/data' };
    const output = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"key": "value"}',
      url: 'https://api.example.com/data',
    };

    const sources = httpClientExtractor.extract(`${TEST_REQUEST_ID_PREFIX}12`, 'http_client', params, output);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      type: 'api',
      uri: 'https://api.example.com/data',
      domain: 'api.example.com',
    });
    expect(sources[0].title).toContain('API:');
  });

  it('falls back to output URL when parameter URL missing', () => {
    const output = { status: 200, statusText: 'OK', headers: {}, body: '', url: 'https://fallback.com/api' };
    const sources = httpClientExtractor.extract(`${TEST_REQUEST_ID_PREFIX}13`, 'http_client', {}, output);
    expect(sources[0].uri).toBe('https://fallback.com/api');
  });

  it('returns empty when no URL available', () => {
    const sources = httpClientExtractor.extract(`${TEST_REQUEST_ID_PREFIX}14`, 'http_client', {}, {});
    expect(sources).toEqual([]);
  });

  it('truncates long body snippets', () => {
    const longBody = repeatString('Z', LONG_STRING_LENGTH_300);
    const output = { status: 200, statusText: 'OK', headers: {}, body: longBody, url: TEST_URL };
    const sources = httpClientExtractor.extract(`${TEST_REQUEST_ID_PREFIX}15`, 'http_client', { url: TEST_URL }, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(HTTP_CLIENT_SNIPPET_MAX_LENGTH + 3); // 3 for '...'
  });
});

describe('mcpToolExtractor', () => {
  it('matches MCP tool name pattern', () => {
    expect(testPattern(mcpToolExtractor.pattern, 'mcp.server1__tool_name')).toBe(true);
    expect(testPattern(mcpToolExtractor.pattern, 'mcp.my-server__search')).toBe(true);
    expect(testPattern(mcpToolExtractor.pattern, 'web_search')).toBe(false);
    expect(testPattern(mcpToolExtractor.pattern, 'mcp.')).toBe(false);
  });

  it('extracts source from output with URL field', () => {
    const output = {
      url: 'https://source.example.com/data',
      title: 'MCP Data',
      content: 'Some content from MCP tool',
    };

    const sources = mcpToolExtractor.extract(`${TEST_REQUEST_ID_PREFIX}16`, 'mcp.server__tool', {}, output);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      type: 'mcp',
      uri: 'https://source.example.com/data',
      title: 'MCP Data',
      domain: 'source.example.com',
    });
  });

  it('extracts sources from array results field', () => {
    const output = {
      results: [
        { url: 'https://a.com', title: 'Result A', text: 'Text A' },
        { url: 'https://b.com', title: 'Result B', text: 'Text B' },
      ],
    };

    const sources = mcpToolExtractor.extract(`${TEST_REQUEST_ID_PREFIX}17`, 'mcp.s__t', {}, output);
    expect(sources).toHaveLength(2);
    expect(sources[0].uri).toBe('https://a.com');
    expect(sources[1].uri).toBe('https://b.com');
  });

  it('returns empty for non-object output', () => {
    const requestId = `${TEST_REQUEST_ID_PREFIX}18`;
    expect(mcpToolExtractor.extract(requestId, 'mcp.s__t', {}, null)).toEqual([]);
    expect(mcpToolExtractor.extract(requestId, 'mcp.s__t', {}, 'string')).toEqual([]);
    expect(mcpToolExtractor.extract(requestId, 'mcp.s__t', {}, 42)).toEqual([]);
  });

  it('returns empty when no URL-like fields exist', () => {
    const output = { name: 'test', value: 42 };
    const sources = mcpToolExtractor.extract(`${TEST_REQUEST_ID_PREFIX}19`, 'mcp.s__t', {}, output);
    expect(sources).toEqual([]);
  });

  it('limits array results to maximum allowed', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      url: `${TEST_URL}/${i}`,
      title: `Item ${i}`,
    }));
    const output = { results: items };

    const sources = mcpToolExtractor.extract(`${TEST_REQUEST_ID_PREFIX}20`, 'mcp.s__t', {}, output);
    expect(sources).toHaveLength(MCP_ARRAY_RESULTS_LIMIT);
  });
});

describe('getDefaultExtractors', () => {
  it('returns all 6 default extractors', () => {
    const extractors = getDefaultExtractors();
    expect(extractors).toHaveLength(6);
  });

  it('returns extractors in expected order', () => {
    const extractors = getDefaultExtractors();
    expect(extractors[0]).toBe(webSearchExtractor);
    expect(extractors[1]).toBe(webScrapeExtractor);
    expect(extractors[2]).toBe(ragQueryExtractor);
    expect(extractors[3]).toBe(wikipediaSearchExtractor);
    expect(extractors[4]).toBe(httpClientExtractor);
    expect(extractors[5]).toBe(mcpToolExtractor);
  });
});
