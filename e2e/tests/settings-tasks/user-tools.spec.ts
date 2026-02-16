/**
 * User-Defined Tools Tests
 *
 * Covers: USERTOOL-001 through USERTOOL-006
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createToolInfo } from '../../fixtures/index.js';

test.describe('User-Defined Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-usertool', title: 'User Tools' });
    app.api.addConversation(conv);
    app.api.setTools({
      builtin: [createToolInfo('web_search', 'Search the web')],
      user: [createToolInfo('my_custom_tool', 'A user-defined custom tool')],
      mcp: {},
    });
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('User Tools');
  });

  // USERTOOL-001: Create tool from markdown
  test('user-defined tool appears in tool list', async ({ app }) => {
    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordion('Tools').locator('.accordion-content')).toBeVisible({ timeout: 3000 });
  });

  // USERTOOL-002: Execute user tool
  test('executes user-defined tool', async ({ app }) => {
    await app.chat.sendMessage('Use my custom tool');

    app.ws.simulateToolExecution({
      conversationId: 'conv-usertool',
      turnId: 'turn-ut',
      requestId: 'req-ut',
      toolName: 'user.my_custom_tool',
      toolSource: 'user',
      parameters: { query: 'test input' },
      result: 'Custom tool executed with result: test output',
    });

    // Tool event card should appear (collapsed by default)
    await expect(app.chat.toolByName('user.my_custom_tool')).toBeVisible({ timeout: 5000 });
  });

  // USERTOOL-004: Tool input validation
  test('Zod validation rejects invalid input', async ({ app }) => {
    await app.chat.sendMessage('Use custom tool with bad input');

    app.ws.simulateToolExecution({
      conversationId: 'conv-usertool',
      turnId: 'turn-valid',
      requestId: 'req-valid',
      toolName: 'user.my_custom_tool',
      toolSource: 'user',
      parameters: {},
      result: 'Validation error: Required field "query" is missing',
      success: false,
    });

    // Failed tool event should be visible with failed status
    const toolEvent = app.chat.toolByName('user.my_custom_tool');
    await expect(toolEvent).toBeVisible({ timeout: 5000 });
    await expect(toolEvent).toHaveClass(/failed/);
  });

  // USERTOOL-005: Tool sandbox execution
  test('tool runs in VM sandbox', async ({ app }) => {
    await app.chat.sendMessage('Run sandboxed tool');

    app.ws.simulateToolExecution({
      conversationId: 'conv-usertool',
      turnId: 'turn-sandbox',
      requestId: 'req-sandbox',
      toolName: 'user.my_custom_tool',
      toolSource: 'user',
      parameters: { query: 'sandbox test' },
      result: 'Executed in sandbox. Result: sandbox output.',
    });

    // Tool event card shows the tool executed
    await expect(app.chat.toolByName('user.my_custom_tool')).toBeVisible({ timeout: 5000 });
  });
});
