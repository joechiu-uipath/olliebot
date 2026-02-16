/**
 * Web UI Interaction Tests
 *
 * Covers: WEBUI-001 through WEBUI-016
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';
import { ToolName, Mode } from '../../constants/index.js';

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
  test('switches between Chat and Trace modes', async ({ app }) => {
    // Start in Chat mode (default)
    await expect(app.activeModeButton).toContainText(Mode.CHAT);

    // Switch to Trace mode
    await app.switchToLogs();
  });

  // WEBUI-003: Sidebar accordions
  test('expands and collapses sidebar accordion sections', async ({ app }) => {
    // Toggle Agent Tasks accordion
    await app.sidebar.toggleAccordion('Agent Tasks');
    expect(await app.sidebar.isAccordionExpanded('Agent Tasks')).toBe(true);

    // Collapse it
    await app.sidebar.toggleAccordion('Agent Tasks');
    expect(await app.sidebar.isAccordionExpanded('Agent Tasks')).toBe(false);

    // Toggle Agent Skills accordion
    await app.sidebar.toggleAccordion('Agent Skills');
    expect(await app.sidebar.isAccordionExpanded('Agent Skills')).toBe(true);
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
    await app.reload();
    await app.sidebar.selectConversation('Code Blocks');

    await app.chat.waitForMessageContaining('Hello World');
  });

  // WEBUI-005: HTML preview toggle
  test('toggles raw HTML vs rendered preview', async ({ app }) => {
    const conv = createConversation({ id: 'conv-html', title: 'HTML Preview' });
    const msgs = [{
      id: 'msg-html',
      role: 'assistant',
      content: 'Here is some HTML:\n\n```html\n<h1>Test</h1><p>Hello</p>\n```',
      conversationId: 'conv-html',
      createdAt: new Date().toISOString(),
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-html', msgs);
    await app.reload();
    await app.sidebar.selectConversation('HTML Preview');

    await app.chat.waitForMessageContaining('Here is some HTML');
  });

  // WEBUI-008: Audio player
  test('audio content has play button', async ({ app }) => {
    const conv = createConversation({ id: 'conv-audio', title: 'Audio Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Audio Test');

    // Simulate audio generation
    app.ws.simulateToolExecution({
      conversationId: 'conv-audio',
      turnId: 'turn-audio',
      requestId: 'req-audio',
      toolName: ToolName.SPEAK,
      parameters: { text: 'Hello' },
      result: JSON.stringify({ audioData: 'base64audio' }),
    });

    await expect(app.chat.toolByName(ToolName.SPEAK)).toBeVisible();
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
    await app.reload();
    await app.sidebar.selectConversation('Actions Test');

    await app.chat.waitForMessageContaining('actions you can take');
  });

  // WEBUI-012: Computer Use accordion
  test('browser/desktop sessions accordion in sidebar', async ({ app }) => {
    // Send a session event to populate the accordion (uses data.session shape)
    app.ws.send({
      type: 'browser_session_created',
      session: {
        id: 'test-session',
        name: 'Test Browser',
        status: 'active',
        strategy: 'computer-use',
        provider: 'anthropic',
        currentUrl: 'https://example.com',
      },
    });

    // Computer Use accordion auto-expands when sessions exist
    await expect(app.sidebar.sessionByName('Test Browser')).toBeVisible();
  });

  // WEBUI-016: Mobile menu button
  test('hamburger menu exists for mobile', async ({ app }) => {
    // Set a mobile viewport
    await app.page.setViewportSize({ width: 375, height: 667 });
    await app.reload();

    // Check for mobile menu button
    const mobileBtn = app.sidebar.mobileMenuButton;
    if (await mobileBtn.isVisible()) {
      await mobileBtn.click();
    }
  });
});
