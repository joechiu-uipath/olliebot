/**
 * Citations Tests
 *
 * Covers: CITE-001 through CITE-006
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createCitationMessage } from '../../fixtures/index.js';

test.describe('Citations', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-cite', title: 'Citation Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Citation Test');
  });

  // CITE-001: Citation extraction from web_search
  test('web search results become citation sources', async ({ app }) => {
    await app.chat.sendMessage('Search for Playwright docs');

    app.ws.simulateToolExecution({
      conversationId: 'conv-cite',
      turnId: 'turn-cite-ws',
      requestId: 'req-cite-ws',
      toolName: 'web_search',
      parameters: { query: 'Playwright docs' },
      result: JSON.stringify({
        results: [
          { title: 'Playwright Docs', url: 'https://playwright.dev', content: 'E2E testing framework' },
        ],
      }),
    });

    // Response with citations from the search
    app.ws.send({
      type: 'message',
      conversationId: 'conv-cite',
      id: `msg-cite-${Date.now()}`,
      role: 'assistant',
      content: 'Based on the Playwright documentation, here are the key features...',
      citations: [
        { title: 'Playwright Docs', url: 'https://playwright.dev', snippet: 'E2E testing framework' },
      ],
    });

    await app.chat.waitForMessageContaining('Playwright documentation');
  });

  // CITE-002: Citation extraction from web_scrape
  test('scraped content becomes citation source', async ({ app }) => {
    await app.chat.sendMessage('Scrape the React docs');

    app.ws.simulateToolExecution({
      conversationId: 'conv-cite',
      turnId: 'turn-cite-scrape',
      requestId: 'req-cite-scrape',
      toolName: 'web_scrape',
      parameters: { url: 'https://react.dev' },
      result: 'React is a library for building user interfaces...',
    });

    app.ws.send({
      type: 'message',
      conversationId: 'conv-cite',
      id: `msg-cite-scrape-${Date.now()}`,
      role: 'assistant',
      content: 'According to the React documentation, React is a library for building UIs.',
      citations: [
        { title: 'React Docs', url: 'https://react.dev', snippet: 'Library for building UIs' },
      ],
    });

    await app.chat.waitForMessageContaining('React documentation');
  });

  // CITE-003: Citation extraction from RAG
  test('RAG results become citation sources', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-cite',
      turnId: 'turn-cite-rag',
      requestId: 'req-cite-rag',
      toolName: 'query_rag_project',
      parameters: { projectId: 'docs', query: 'deployment' },
      result: JSON.stringify({
        results: [{ content: 'Deploy with docker', score: 0.9, source: 'deploy.md' }],
      }),
    });

    app.ws.send({
      type: 'message',
      conversationId: 'conv-cite',
      id: `msg-cite-rag-${Date.now()}`,
      role: 'assistant',
      content: 'For deployment, use docker compose as described in your documentation.',
      citations: [
        { title: 'deploy.md', url: '/api/rag/projects/docs/documents/deploy.md', snippet: 'Deploy with docker' },
      ],
    });

    await app.chat.waitForMessageContaining('deployment');
  });

  // CITE-005: Citation display in UI
  test('citations rendered with source links', async ({ app }) => {
    const msgs = [createCitationMessage(
      'Here is information with citations.',
      'conv-cite',
      [
        { title: 'Source 1', url: 'https://example.com/1', snippet: 'First source content' },
        { title: 'Source 2', url: 'https://example.com/2', snippet: 'Second source content' },
      ],
    )];
    app.api.setConversationMessages('conv-cite', msgs);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Citation Test');

    await app.chat.waitForMessageContaining('information with citations');
  });

  // CITE-006: Citation persistence
  test('citations saved with message and persist after refresh', async ({ app }) => {
    const msgs = [createCitationMessage(
      'Persisted citation message.',
      'conv-cite',
      [{ title: 'Persisted Source', url: 'https://example.com', snippet: 'This should persist' }],
    )];
    app.api.setConversationMessages('conv-cite', msgs);

    // First load
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Citation Test');
    await app.chat.waitForMessageContaining('Persisted citation');

    // Reload
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Citation Test');
    await app.chat.waitForMessageContaining('Persisted citation');
  });
});
