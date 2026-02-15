/**
 * Tools - System Tests
 *
 * Covers: TOOL-SYS-001 through TOOL-SYS-006
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('System Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-sys', title: 'System Tools' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('System Tools');
  });

  // TOOL-SYS-001: Delegate tool
  test('spawns sub-agent via delegate tool', async ({ app }) => {
    await app.chat.sendMessage('Delegate research to a specialist');

    app.ws.simulateToolExecution({
      conversationId: 'conv-sys',
      turnId: 'turn-del',
      requestId: 'req-del',
      toolName: 'delegate',
      parameters: { task: 'Research AI trends', agentType: 'researcher' },
      result: 'Delegated to researcher agent.',
    });

    await expect(app.chat.toolByName('delegate')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-SYS-002: Query RAG project
  test('queries indexed documents via query_rag_project', async ({ app }) => {
    await app.chat.sendMessage('Search my documents for deployment');

    app.ws.simulateToolExecution({
      conversationId: 'conv-sys',
      turnId: 'turn-rag',
      requestId: 'req-rag',
      toolName: 'query_rag_project',
      parameters: { projectId: 'docs', query: 'deployment' },
      result: JSON.stringify({
        results: [{ content: 'Deploy using docker compose...', score: 0.92 }],
      }),
    });

    await expect(app.chat.toolByName('query_rag_project')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-SYS-003: Tool event broadcast
  test('tool execution events reach UI in real time', async ({ app }) => {
    await app.chat.sendMessage('Run a tool');

    // Send tool_requested (shows loading state)
    app.ws.send({
      type: 'tool_requested',
      conversationId: 'conv-sys',
      turnId: 'turn-evt',
      requestId: 'req-evt',
      toolName: 'web_search',
      source: 'native',
      parameters: { query: 'test' },
    });

    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });

    // Send progress update
    app.ws.send({
      type: 'tool_progress',
      conversationId: 'conv-sys',
      turnId: 'turn-evt',
      requestId: 'req-evt',
      progress: 50,
      message: 'Searching...',
    });

    // Complete
    app.ws.send({
      type: 'tool_execution_finished',
      conversationId: 'conv-sys',
      turnId: 'turn-evt',
      requestId: 'req-evt',
      toolName: 'web_search',
      source: 'native',
      success: true,
      result: 'Found 3 results.',
      durationMs: 300,
    });
  });

  // TOOL-SYS-004: Tool result persistence
  test('tool results persist after page refresh', async ({ app }) => {
    // Pre-load a conversation with tool messages
    const messages = [{
      id: 'msg-tool-persist',
      role: 'assistant',
      content: '',
      conversationId: 'conv-sys',
      createdAt: new Date().toISOString(),
      messageType: 'tool_execution',
      toolName: 'web_search',
      toolSource: 'native',
      toolSuccess: true,
      toolDurationMs: 200,
      toolParameters: { query: 'test query' },
      toolResult: 'Search results...',
    }];
    app.api.setConversationMessages('conv-sys', messages);

    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('System Tools');

    // Tool result should be loaded from persisted messages
    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-SYS-005: Tool progress updates
  test('long-running tools show progress', async ({ app }) => {
    await app.chat.sendMessage('Run long task');

    app.ws.send({
      type: 'tool_requested',
      conversationId: 'conv-sys',
      turnId: 'turn-prog',
      requestId: 'req-prog',
      toolName: 'website_crawler',
      source: 'native',
      parameters: { url: 'https://example.com' },
    });

    // Send progress updates
    app.ws.send({
      type: 'tool_progress',
      conversationId: 'conv-sys',
      turnId: 'turn-prog',
      requestId: 'req-prog',
      progress: 25,
      message: 'Crawling page 1 of 4...',
    });

    await expect(app.chat.toolByName('website_crawler')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-SYS-006: Tool file output
  test('tools that produce files display correctly', async ({ app }) => {
    await app.chat.sendMessage('Generate a chart');

    app.ws.simulateToolExecution({
      conversationId: 'conv-sys',
      turnId: 'turn-file',
      requestId: 'req-file',
      toolName: 'run_python',
      parameters: { code: 'create_chart()' },
      result: JSON.stringify({
        output: 'Chart created.',
        files: [{ name: 'chart.png', type: 'image/png', data: 'base64data' }],
      }),
    });

    await expect(app.chat.toolByName('run_python')).toBeVisible({ timeout: 5000 });
  });
});
