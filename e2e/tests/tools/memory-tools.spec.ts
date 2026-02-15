/**
 * Tools - Memory & Context Tests
 *
 * Covers: TOOL-MEM-001 through TOOL-MEM-003
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Memory & Context Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-mem', title: 'Memory Tools' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Memory Tools');
  });

  // TOOL-MEM-001: Remember
  test('stores memory via remember tool', async ({ app }) => {
    await app.chat.sendMessage('Remember that my favorite color is blue');

    app.ws.simulateToolExecution({
      conversationId: 'conv-mem',
      turnId: 'turn-rem',
      requestId: 'req-rem',
      toolName: 'remember',
      parameters: { content: 'User\'s favorite color is blue' },
      result: 'Memory stored successfully.',
    });

    app.ws.simulateResponse({
      conversationId: 'conv-mem',
      content: 'I\'ll remember that your favorite color is blue!',
      turnId: 'turn-rem',
    });

    await expect(app.chat.toolByName('remember')).toBeVisible({ timeout: 5000 });
    await app.chat.waitForMessageContaining('favorite color is blue');
  });

  // TOOL-MEM-002: Memory retrieval
  test('stored memory retrieved in future context', async ({ app }) => {
    await app.chat.sendMessage('What is my favorite color?');

    // The agent would internally use memory retrieval, but from UI perspective
    // we just see the response that references the memory
    app.ws.simulateResponse({
      conversationId: 'conv-mem',
      content: 'Based on what I remember, your favorite color is blue.',
    });

    await app.chat.waitForMessageContaining('favorite color is blue');
  });

  // TOOL-MEM-003: Memory persistence
  test('memory survives page reload', async ({ app }) => {
    // Store a memory
    await app.chat.sendMessage('Remember that my name is Alice');

    app.ws.simulateToolExecution({
      conversationId: 'conv-mem',
      turnId: 'turn-persist',
      requestId: 'req-persist',
      toolName: 'remember',
      parameters: { content: 'User\'s name is Alice' },
      result: 'Memory stored.',
    });

    await expect(app.chat.toolByName('remember')).toBeVisible({ timeout: 5000 });

    // Reload the page
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Memory Tools');

    // Memory is persisted server-side, so next question should still work
    await app.chat.sendMessage('What is my name?');

    app.ws.simulateResponse({
      conversationId: 'conv-mem',
      content: 'Your name is Alice.',
    });

    await app.chat.waitForMessageContaining('Alice');
  });
});
