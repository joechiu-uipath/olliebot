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

describe('webSearchExtractor', () => {
  it('matches only web_search tool name', () => {
    expect(webSearchExtractor.pattern.test('web_search')).toBe(true);
    expect(webSearchExtractor.pattern.test('web_scrape')).toBe(false);
    expect(webSearchExtractor.pattern.test('search')).toBe(false);
  });

  it('extracts citations from search results', () => {
    const output = {
      query: 'test query',
      provider: 'tavily',
      results: [
        { title: 'Result 1', link: 'https://example.com/page1', snippet: 'Snippet 1', position: 1 },
        { title: 'Result 2', link: 'https://www.example.org/page2', snippet: 'Snippet 2', position: 2 },
      ],
      totalResults: 2,
    };

    const sources = webSearchExtractor.extract('req-1', 'web_search', {}, output);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      id: 'req-1-0',
      type: 'web',
      toolName: 'web_search',
      toolRequestId: 'req-1',
      uri: 'https://example.com/page1',
      title: 'Result 1',
      domain: 'example.com',
      snippet: 'Snippet 1',
    });
    expect(sources[1].domain).toBe('example.org'); // www. stripped
  });

  it('returns empty array for null/undefined output', () => {
    expect(webSearchExtractor.extract('req-1', 'web_search', {}, null)).toEqual([]);
    expect(webSearchExtractor.extract('req-1', 'web_search', {}, undefined)).toEqual([]);
  });

  it('returns empty array when results is not an array', () => {
    expect(webSearchExtractor.extract('req-1', 'web_search', {}, { results: 'not-array' })).toEqual([]);
    expect(webSearchExtractor.extract('req-1', 'web_search', {}, {})).toEqual([]);
  });

  it('handles invalid URLs gracefully', () => {
    const output = {
      query: 'test',
      provider: 'tavily',
      results: [{ title: 'Bad', link: 'not-a-url', snippet: 'test', position: 1 }],
      totalResults: 1,
    };

    const sources = webSearchExtractor.extract('req-1', 'web_search', {}, output);
    expect(sources[0].domain).toBe('unknown');
  });
});

describe('webScrapeExtractor', () => {
  it('matches only web_scrape tool name', () => {
    expect(webScrapeExtractor.pattern.test('web_scrape')).toBe(true);
    expect(webScrapeExtractor.pattern.test('web_search')).toBe(false);
  });

  it('extracts citation from scrape output', () => {
    const output = {
      url: 'https://example.com/article',
      title: 'Test Article',
      metaDescription: 'A test article about testing',
      contentType: 'text/html',
      outputMode: 'markdown',
      content: 'Full article content here...',
      contentLength: 1000,
    };

    const sources = webScrapeExtractor.extract('req-2', 'web_scrape', {}, output);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: 'req-2-0',
      type: 'web',
      uri: 'https://example.com/article',
      title: 'Test Article',
      domain: 'example.com',
      snippet: 'A test article about testing',
    });
    expect(sources[0].fullContent).toBe('Full article content here...');
  });

  it('uses summary as snippet when metaDescription is absent', () => {
    const output = {
      url: 'https://example.com/page',
      contentType: 'text/html',
      outputMode: 'markdown',
      summary: 'Summary of the page',
      contentLength: 500,
    };

    const sources = webScrapeExtractor.extract('req-3', 'web_scrape', {}, output);
    expect(sources[0].snippet).toBe('Summary of the page');
  });

  it('truncates long snippets to 200 chars with ellipsis', () => {
    const longDesc = 'A'.repeat(300);
    const output = {
      url: 'https://example.com',
      metaDescription: longDesc,
      contentType: 'text/html',
      outputMode: 'markdown',
      contentLength: 300,
    };

    const sources = webScrapeExtractor.extract('req-4', 'web_scrape', {}, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(203); // 200 + '...'
    expect(sources[0].snippet!.endsWith('...')).toBe(true);
  });

  it('returns empty for missing URL', () => {
    expect(webScrapeExtractor.extract('req-5', 'web_scrape', {}, {})).toEqual([]);
    expect(webScrapeExtractor.extract('req-5', 'web_scrape', {}, null)).toEqual([]);
  });
});

describe('ragQueryExtractor', () => {
  it('matches only query_rag_project tool name', () => {
    expect(ragQueryExtractor.pattern.test('query_rag_project')).toBe(true);
    expect(ragQueryExtractor.pattern.test('rag_query')).toBe(false);
  });

  it('extracts citations from RAG results', () => {
    const output = {
      projectId: 'proj-1',
      query: 'what is testing',
      results: [
        { documentPath: '/docs/testing.pdf', text: 'Testing is important...', score: 0.95, chunkIndex: 0 },
        {
          documentPath: '/docs/guide.pdf',
          text: 'Guide content...',
          score: 0.8,
          chunkIndex: 1,
          metadata: { pageNumber: 5 },
        },
      ],
      totalResults: 2,
      queryTimeMs: 50,
    };

    const sources = ragQueryExtractor.extract('req-6', 'query_rag_project', {}, output);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      type: 'file',
      uri: '/docs/testing.pdf',
      title: 'testing.pdf',
      projectId: 'proj-1',
    });
    expect(sources[1].title).toBe('guide.pdf (page 5)');
    expect(sources[1].pageNumber).toBe(5);
  });

  it('handles Windows-style paths', () => {
    const output = {
      projectId: 'proj-2',
      query: 'test',
      results: [{ documentPath: 'C:\\docs\\file.txt', text: 'content', score: 0.9, chunkIndex: 0 }],
      totalResults: 1,
      queryTimeMs: 10,
    };

    const sources = ragQueryExtractor.extract('req-7', 'query_rag_project', {}, output);
    expect(sources[0].title).toBe('file.txt');
  });

  it('truncates long text snippets to 400 chars', () => {
    const longText = 'X'.repeat(500);
    const output = {
      projectId: 'proj-3',
      query: 'test',
      results: [{ documentPath: 'doc.txt', text: longText, score: 0.9, chunkIndex: 0 }],
      totalResults: 1,
      queryTimeMs: 10,
    };

    const sources = ragQueryExtractor.extract('req-8', 'query_rag_project', {}, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(403); // 400 + '...'
  });

  it('returns empty for invalid output', () => {
    expect(ragQueryExtractor.extract('req-9', 'query_rag_project', {}, null)).toEqual([]);
    expect(ragQueryExtractor.extract('req-9', 'query_rag_project', {}, { results: 'bad' })).toEqual([]);
  });
});

describe('wikipediaSearchExtractor', () => {
  it('matches only wikipedia_search tool name', () => {
    expect(wikipediaSearchExtractor.pattern.test('wikipedia_search')).toBe(true);
    expect(wikipediaSearchExtractor.pattern.test('web_search')).toBe(false);
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
    expect(httpClientExtractor.pattern.test('http_client')).toBe(true);
    expect(httpClientExtractor.pattern.test('web_search')).toBe(false);
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

    const sources = httpClientExtractor.extract('req-12', 'http_client', params, output);

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
    const sources = httpClientExtractor.extract('req-13', 'http_client', {}, output);
    expect(sources[0].uri).toBe('https://fallback.com/api');
  });

  it('returns empty when no URL available', () => {
    const sources = httpClientExtractor.extract('req-14', 'http_client', {}, {});
    expect(sources).toEqual([]);
  });

  it('truncates long body snippets', () => {
    const longBody = 'Z'.repeat(300);
    const output = { status: 200, statusText: 'OK', headers: {}, body: longBody, url: 'https://example.com' };
    const sources = httpClientExtractor.extract('req-15', 'http_client', { url: 'https://example.com' }, output);
    expect(sources[0].snippet!.length).toBeLessThanOrEqual(203);
  });
});

describe('mcpToolExtractor', () => {
  it('matches MCP tool name pattern', () => {
    expect(mcpToolExtractor.pattern.test('mcp.server1__tool_name')).toBe(true);
    expect(mcpToolExtractor.pattern.test('mcp.my-server__search')).toBe(true);
    expect(mcpToolExtractor.pattern.test('web_search')).toBe(false);
    expect(mcpToolExtractor.pattern.test('mcp.')).toBe(false);
  });

  it('extracts source from output with URL field', () => {
    const output = {
      url: 'https://source.example.com/data',
      title: 'MCP Data',
      content: 'Some content from MCP tool',
    };

    const sources = mcpToolExtractor.extract('req-16', 'mcp.server__tool', {}, output);

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

    const sources = mcpToolExtractor.extract('req-17', 'mcp.s__t', {}, output);
    expect(sources).toHaveLength(2);
    expect(sources[0].uri).toBe('https://a.com');
    expect(sources[1].uri).toBe('https://b.com');
  });

  it('returns empty for non-object output', () => {
    expect(mcpToolExtractor.extract('req-18', 'mcp.s__t', {}, null)).toEqual([]);
    expect(mcpToolExtractor.extract('req-18', 'mcp.s__t', {}, 'string')).toEqual([]);
    expect(mcpToolExtractor.extract('req-18', 'mcp.s__t', {}, 42)).toEqual([]);
  });

  it('returns empty when no URL-like fields exist', () => {
    const output = { name: 'test', value: 42 };
    const sources = mcpToolExtractor.extract('req-19', 'mcp.s__t', {}, output);
    expect(sources).toEqual([]);
  });

  it('limits array results to 10 items', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Item ${i}`,
    }));
    const output = { results: items };

    const sources = mcpToolExtractor.extract('req-20', 'mcp.s__t', {}, output);
    expect(sources).toHaveLength(10);
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
