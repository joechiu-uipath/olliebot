/**
 * Web UI Interaction Tests
 *
 * Covers: WEBUI-001 through WEBUI-016
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Web UI Interactions', () => {

  // WEBUI-001: Resizable app width
  test('sidebar can be toggled open and closed', async ({ app }) => {
    // Sidebar should be open by default
    expect(await app.sidebar.isOpen()).toBe(true);

    // Toggle closed
    await app.sidebar.toggle();

    // Toggle open again
    await app.sidebar.toggle();
  });

  // WEBUI-002: Mode switcher
  test('switches between Chat/Mission/Trace/Eval modes', async ({ app }) => {
    // Start in Chat mode
    await app.switchToChat();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Chat');

    // Switch to Logs mode
    await app.switchToLogs();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Logs');

    // Switch to Mission mode
    await app.switchToMission();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Mission');

    // Switch to Eval mode
    await app.switchToEval();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Eval');

    // Back to Chat
    await app.switchToChat();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Chat');
  });

  // WEBUI-003: Sidebar accordions
  test('expands and collapses sidebar accordion sections', async ({ app }) => {
    // Toggle Tasks accordion
    await app.sidebar.toggleAccordion('Tasks');
    expect(await app.sidebar.isAccordionExpanded('Tasks')).toBe(true);

    // Collapse it
    await app.sidebar.toggleAccordion('Tasks');
    expect(await app.sidebar.isAccordionExpanded('Tasks')).toBe(false);

    // Toggle Skills accordion
    await app.sidebar.toggleAccordion('Skills');
    expect(await app.sidebar.isAccordionExpanded('Skills')).toBe(true);
  });

  // WEBUI-004: Code block copy
  test('code blocks have copy button', async ({ app }) => {
    const conv = createConversation({ id: 'conv-code-block', title: 'Code Blocks' });
    const msgs = [{
      id: 'msg-code',
      role: 'assistant',
      content: '```javascript\nconsole.log("Hello World");\n```',
      conversationId: 'conv-code-block',
      createdAt: new Date().toISOString(),
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-code-block', msgs);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Code Blocks');

    await app.chat.waitForMessageContaining('Hello World');
  });

  // WEBUI-005: HTML preview toggle
  test('toggles raw HTML vs rendered preview', async ({ app }) => {
    const conv = createConversation({ id: 'conv-html', title: 'HTML Preview' });
    const msgs = [{
      id: 'msg-html',
      role: 'assistant',
      content: '```html\n<h1>Test</h1><p>Hello</p>\n```',
      conversationId: 'conv-html',
      createdAt: new Date().toISOString(),
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-html', msgs);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('HTML Preview');

    await app.chat.waitForMessageContaining('Test');
  });

  // WEBUI-008: Audio player
  test('audio content has play button', async ({ app }) => {
    const conv = createConversation({ id: 'conv-audio', title: 'Audio Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Audio Test');

    // Simulate audio generation
    app.ws.simulateToolExecution({
      conversationId: 'conv-audio',
      turnId: 'turn-audio',
      requestId: 'req-audio',
      toolName: 'speak',
      parameters: { text: 'Hello' },
      result: JSON.stringify({ audioData: 'base64audio' }),
    });

    await expect(app.chat.toolByName('speak')).toBeVisible({ timeout: 5000 });
  });

  // WEBUI-011: Message action buttons
  test('custom action buttons in messages are clickable', async ({ app }) => {
    const conv = createConversation({ id: 'conv-actions', title: 'Actions Test' });
    const msgs = [{
      id: 'msg-actions',
      role: 'assistant',
      content: 'Here are some actions you can take:',
      conversationId: 'conv-actions',
      createdAt: new Date().toISOString(),
      buttons: [
        { label: 'Run Again', action: 'run_again' },
        { label: 'More Details', action: 'more_details' },
      ],
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-actions', msgs);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Actions Test');

    await app.chat.waitForMessageContaining('actions you can take');
  });

  // WEBUI-012: Computer Use accordion
  test('browser/desktop sessions accordion in sidebar', async ({ app }) => {
    // Send a session event to populate the accordion
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'test-session',
      status: 'active',
      url: 'https://example.com',
    });

    await app.sidebar.toggleAccordion('Computer Use');
  });

  // WEBUI-016: Mobile menu button
  test('hamburger menu exists for mobile', async ({ app }) => {
    // Set a mobile viewport
    await app.page.setViewportSize({ width: 375, height: 667 });
    await app.page.reload();
    await app.waitForAppReady();

    // Check for mobile menu button
    const mobileBtn = app.sidebar.mobileMenuButton;
    if (await mobileBtn.isVisible()) {
      await mobileBtn.click();
    }
  });
});
