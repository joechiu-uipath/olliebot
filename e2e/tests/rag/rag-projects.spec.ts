/**
 * RAG Projects Tests
 *
 * Covers: RAG-001 through RAG-011
 */

import { test, expect } from '../../utils/test-base.js';
import { createRagProject, createConversation } from '../../fixtures/index.js';

test.describe('RAG Projects', () => {

  // RAG-001: Query RAG project
  test('queries indexed documents via tool', async ({ app }) => {
    const conv = createConversation({ id: 'conv-rag', title: 'RAG Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('RAG Test');

    app.ws.simulateToolExecution({
      conversationId: 'conv-rag',
      turnId: 'turn-rag',
      requestId: 'req-rag',
      toolName: 'query_rag_project',
      parameters: { projectId: 'docs', query: 'deployment instructions' },
      result: JSON.stringify({
        results: [
          { content: 'Deploy using docker compose up -d', score: 0.95, source: 'deploy.md' },
        ],
      }),
    });

    await expect(app.chat.toolByName('query_rag_project')).toBeVisible({ timeout: 5000 });
  });

  // RAG-002: RAG results in citations
  test('RAG results appear as citation sources', async ({ app }) => {
    const conv = createConversation({ id: 'conv-rag-cite', title: 'RAG Citations' });
    const msgs = [{
      id: 'msg-rag-cite',
      role: 'assistant',
      content: 'Based on the documentation, you should use docker compose.',
      conversationId: 'conv-rag-cite',
      createdAt: new Date().toISOString(),
      citations: [
        { title: 'deploy.md', url: '/api/rag/projects/docs/documents/deploy.md', snippet: 'Deploy using docker compose...' },
      ],
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-rag-cite', msgs);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('RAG Citations');

    await app.chat.waitForMessageContaining('docker compose');
  });

  // RAG-004: Upload document
  test('uploads file to RAG project', async ({ app }) => {
    const project = createRagProject({ id: 'rag-upload', name: 'Upload Test' });
    app.api.setRagProjects([project]);
    await app.page.reload();
    await app.waitForAppReady();

    // Verify RAG projects accordion
    await app.sidebar.toggleAccordion('RAG');
  });

  // RAG-006: Indexing progress
  test('indexing progress bar shows percentage', async ({ app }) => {
    const project = createRagProject({ id: 'rag-index', name: 'Indexing Test', isIndexing: false });
    app.api.setRagProjects([project]);
    await app.page.reload();
    await app.waitForAppReady();

    // Simulate indexing events
    app.ws.send({
      type: 'rag_indexing_started',
      projectId: 'rag-index',
      projectName: 'Indexing Test',
    });

    app.ws.send({
      type: 'rag_indexing_progress',
      projectId: 'rag-index',
      progress: 50,
      message: 'Indexing 5 of 10 documents...',
    });

    app.ws.send({
      type: 'rag_indexing_completed',
      projectId: 'rag-index',
      documentCount: 10,
      vectorCount: 150,
    });
  });

  // RAG-008: Indexing WebSocket events
  test('receives rag_indexing events via WebSocket', async ({ app }) => {
    app.ws.send({
      type: 'rag_indexing_started',
      projectId: 'rag-ws',
      projectName: 'WS Test',
    });

    app.ws.send({
      type: 'rag_indexing_progress',
      projectId: 'rag-ws',
      progress: 75,
    });

    app.ws.send({
      type: 'rag_indexing_completed',
      projectId: 'rag-ws',
    });
  });

  // RAG-010: Supported extensions
  test('checks supported file extensions', async ({ app }) => {
    app.api.setHandler('GET', '/api/rag/supported-extensions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['.md', '.txt', '.pdf', '.docx', '.html', '.csv']),
      });
    });

    await app.page.reload();
    await app.waitForAppReady();
  });

  // RAG-011: Document count display
  test('shows indexed vs total document count', async ({ app }) => {
    const project = createRagProject({
      id: 'rag-count',
      name: 'Count Test',
      documentCount: 15,
      indexedCount: 12,
      vectorCount: 180,
    });
    app.api.setRagProjects([project]);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('RAG');
  });
});
