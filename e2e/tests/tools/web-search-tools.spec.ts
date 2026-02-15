/**
 * Tools - Web & Search Tests
 *
 * Covers: TOOL-WEB-001 through TOOL-WEB-005
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Web & Search Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-tools', title: 'Tools Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Tools Test');
  });

  // TOOL-WEB-001: Web search
  test('executes web_search and shows results', async ({ app }) => {
    await app.chat.sendMessage('Search for Playwright testing');

    app.ws.simulateToolExecution({
      conversationId: 'conv-tools',
      turnId: 'turn-ws1',
      requestId: 'req-ws1',
      toolName: 'web_search',
      parameters: { query: 'Playwright testing' },
      result: JSON.stringify({
        results: [
          { title: 'Playwright Documentation', url: 'https://playwright.dev', content: 'End-to-end testing framework' },
        ],
      }),
    });

    app.ws.simulateResponse({
      conversationId: 'conv-tools',
      content: 'Based on my search, Playwright is an end-to-end testing framework.',
      turnId: 'turn-ws1',
    });

    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });
    await app.chat.waitForMessageContaining('Playwright');
  });

  // TOOL-WEB-002: Web scrape
  test('scrapes content from URL via web_scrape', async ({ app }) => {
    await app.chat.sendMessage('Scrape https://example.com');

    app.ws.simulateToolExecution({
      conversationId: 'conv-tools',
      turnId: 'turn-scrape',
      requestId: 'req-scrape',
      toolName: 'web_scrape',
      parameters: { url: 'https://example.com' },
      result: 'Page title: Example Domain. Content: This domain is for use in illustrative examples.',
    });

    await expect(app.chat.toolByName('web_scrape')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-WEB-003: Wikipedia search
  test('searches Wikipedia via wikipedia_search', async ({ app }) => {
    await app.chat.sendMessage('Search Wikipedia for quantum computing');

    app.ws.simulateToolExecution({
      conversationId: 'conv-tools',
      turnId: 'turn-wiki',
      requestId: 'req-wiki',
      toolName: 'wikipedia_search',
      parameters: { query: 'quantum computing' },
      result: 'Quantum computing is a type of computation...',
    });

    await expect(app.chat.toolByName('wikipedia_search')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-WEB-004: HTTP client
  test('makes HTTP requests via http_client', async ({ app }) => {
    await app.chat.sendMessage('GET https://api.example.com/data');

    app.ws.simulateToolExecution({
      conversationId: 'conv-tools',
      turnId: 'turn-http',
      requestId: 'req-http',
      toolName: 'http_client',
      parameters: { method: 'GET', url: 'https://api.example.com/data' },
      result: JSON.stringify({ status: 200, body: { data: 'test' } }),
    });

    await expect(app.chat.toolByName('http_client')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-WEB-005: Website crawler
  test('crawls multiple pages via website_crawler', async ({ app }) => {
    await app.chat.sendMessage('Crawl https://docs.example.com');

    app.ws.simulateToolExecution({
      conversationId: 'conv-tools',
      turnId: 'turn-crawl',
      requestId: 'req-crawl',
      toolName: 'website_crawler',
      parameters: { url: 'https://docs.example.com', maxPages: 5 },
      result: 'Crawled 5 pages. Summary: Documentation for example project.',
    });

    await expect(app.chat.toolByName('website_crawler')).toBeVisible({ timeout: 5000 });
  });
});
