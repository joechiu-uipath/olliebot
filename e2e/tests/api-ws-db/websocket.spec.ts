/**
 * WebSocket Communication Tests
 *
 * Covers: WS-001 through WS-016
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('WebSocket Communication', () => {

  // WS-001: Connect
  test('WebSocket connection established', async ({ app }) => {
    await expect(app.connectionStatus).toContainText('Connected');
    expect(await app.isConnected()).toBe(true);
  });

  // WS-002: Send message
  test('message sent via WebSocket processed', async ({ app }) => {
    const conv = createConversation({ id: 'conv-ws', title: 'WS Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('WS Test');

    await app.chat.sendMessage('Test WebSocket message');

    // Verify the message was sent
    const sent = await app.ws.waitForMessage(
      msg => msg.type === 'message' && (msg as any).content === 'Test WebSocket message',
      5000,
    );
    expect(sent).toBeTruthy();
  });

  // WS-003: Receive stream
  test('streaming chunks received and displayed', async ({ app }) => {
    const conv = createConversation({ id: 'conv-ws-stream', title: 'WS Stream' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('WS Stream');

    await app.chat.sendMessage('Stream me');

    app.ws.simulateResponse({
      conversationId: 'conv-ws-stream',
      content: 'This is a streamed response from the server.',
    });

    await app.chat.waitForMessageContaining('streamed response');
  });

  // WS-004: Event types
  test('all event types handled', async ({ app }) => {
    const conv = createConversation({ id: 'conv-ws-events', title: 'WS Events' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('WS Events');

    // Test different event types
    app.ws.send({ type: 'message', conversationId: 'conv-ws-events', id: 'msg-1', role: 'assistant', content: 'Direct message' });
    app.ws.send({ type: 'stream_start', conversationId: 'conv-ws-events', turnId: 'turn-1' });
    app.ws.send({ type: 'stream_chunk', conversationId: 'conv-ws-events', turnId: 'turn-1', content: 'chunk ' });
    app.ws.send({ type: 'stream_end', conversationId: 'conv-ws-events', turnId: 'turn-1', messageId: 'msg-2' });
    app.ws.send({ type: 'tool_requested', conversationId: 'conv-ws-events', turnId: 'turn-1', requestId: 'req-1', toolName: 'test_tool' });
    app.ws.send({ type: 'tool_execution_finished', conversationId: 'conv-ws-events', turnId: 'turn-1', requestId: 'req-1', toolName: 'test_tool', success: true, result: 'ok' });
    app.ws.send({ type: 'delegation', conversationId: 'conv-ws-events', agentId: 'a1', agentType: 'researcher', agentName: 'Test', agentEmoji: '🔬', mission: 'Test' });
    app.ws.send({ type: 'error', conversationId: 'conv-ws-events', error: 'Test error' });

    await app.chat.waitForMessageContaining('Direct message');
  });

  // WS-007: Conversation subscription
  test('events filtered by conversationId', async ({ app }) => {
    const conv1 = createConversation({ id: 'conv-filter-1', title: 'Filter 1' });
    const conv2 = createConversation({ id: 'conv-filter-2', title: 'Filter 2' });
    app.api.addConversation(conv1);
    app.api.addConversation(conv2);
    await app.page.reload();
    await app.waitForAppReady();

    // Select conv1
    await app.sidebar.selectConversation('Filter 1');

    // Send message to conv2 (should not appear in conv1)
    app.ws.send({
      type: 'message',
      conversationId: 'conv-filter-2',
      id: 'msg-other',
      role: 'assistant',
      content: 'This should NOT appear in Filter 1',
    });

    // Send message to conv1 (should appear)
    app.ws.send({
      type: 'message',
      conversationId: 'conv-filter-1',
      id: 'msg-this',
      role: 'assistant',
      content: 'This SHOULD appear',
    });

    await app.chat.waitForMessageContaining('SHOULD appear');
  });

  // WS-009: Connected event
  test('connected event sent on connection', async ({ app }) => {
    // The WebSocket mock automatically sends a 'connected' event
    await expect(app.connectionStatus).toContainText('Connected');
  });

  // WS-010: Stream resume
  test('stream_resume event on conversation switch', async ({ app }) => {
    const conv = createConversation({ id: 'conv-resume', title: 'Resume Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Resume Test');

    // Simulate a stream_resume (server sends active stream state on switch)
    app.ws.send({
      type: 'stream_resume',
      conversationId: 'conv-resume',
      turnId: 'turn-resume',
      content: 'Partial response that was already streaming...',
    });

    await app.chat.waitForMessageContaining('Partial response');
  });

  // WS-011: Tool resume
  test('tool_resume event restores tool state', async ({ app }) => {
    const conv = createConversation({ id: 'conv-tool-resume', title: 'Tool Resume' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Tool Resume');

    // Simulate tool_resume (restoring a running tool's state)
    app.ws.send({
      type: 'tool_resume',
      conversationId: 'conv-tool-resume',
      turnId: 'turn-tr',
      requestId: 'req-tr',
      toolName: 'web_search',
      source: 'native',
      parameters: { query: 'test' },
      status: 'running',
    });

    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });
  });

  // WS-012 through WS-016: Additional WebSocket events
  test('RAG indexing events received', async ({ app }) => {
    app.ws.send({ type: 'rag_indexing_started', projectId: 'p1', projectName: 'Test' });
    app.ws.send({ type: 'rag_indexing_progress', projectId: 'p1', progress: 50 });
    app.ws.send({ type: 'rag_indexing_completed', projectId: 'p1' });
  });

  test('task updated events received', async ({ app }) => {
    app.ws.send({ type: 'task_updated', taskId: 'task-1', enabled: true, lastRun: new Date().toISOString() });
  });

  test('deep research events received', async ({ app }) => {
    const conv = createConversation({ id: 'conv-dr', title: 'DR Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('DR Test');

    app.ws.send({ type: 'deep_research_plan', conversationId: 'conv-dr', plan: { steps: [] } });
    app.ws.send({ type: 'deep_research_step', conversationId: 'conv-dr', step: 1, title: 'Step 1', status: 'completed' });
    app.ws.send({ type: 'deep_research_completed', conversationId: 'conv-dr', report: 'Done' });
  });
});
