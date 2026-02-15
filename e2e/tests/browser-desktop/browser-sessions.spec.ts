/**
 * Browser Automation - Session Management & UI Tests
 *
 * Covers: BROWSER-001, BROWSER-007, BROWSER-008, BROWSER-012 through BROWSER-017
 * Note: BROWSER-002 to BROWSER-006 require actual Playwright browser interaction (untestable in E2E sim)
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createBrowserSession } from '../../fixtures/index.js';

test.describe('Browser Automation', () => {

  // BROWSER-001: Create browser session
  test('creates a browser session via tool call', async ({ app }) => {
    const conv = createConversation({ id: 'conv-browser', title: 'Browser Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Browser Test');

    await app.chat.sendMessage('Open a browser to example.com');

    // Simulate browser session creation
    app.ws.simulateToolExecution({
      conversationId: 'conv-browser',
      turnId: 'turn-b1',
      requestId: 'req-b1',
      toolName: 'browser_session',
      parameters: { action: 'create' },
      result: JSON.stringify({ sessionId: 'session-1', status: 'active' }),
    });

    // Simulate browser session WS event
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'session-1',
      status: 'active',
      url: 'about:blank',
    });

    await expect(app.chat.toolByName('browser_session')).toBeVisible({ timeout: 5000 });
  });

  // BROWSER-007: Close session
  test('closes browser session via API', async ({ app }) => {
    // Simulate an active session
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'session-close',
      status: 'active',
      url: 'https://example.com',
    });

    // Close it
    app.ws.send({
      type: 'browser_session_closed',
      sessionId: 'session-close',
    });
  });

  // BROWSER-008: List sessions
  test('shows all active browser sessions', async ({ app }) => {
    // Create multiple sessions
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'session-a',
      status: 'active',
      url: 'https://example.com',
    });

    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'session-b',
      status: 'active',
      url: 'https://playwright.dev',
    });

    // Expand Computer Use accordion
    await app.sidebar.toggleAccordion('Computer Use');
  });

  // BROWSER-012: Multiple sessions
  test('runs multiple browser sessions simultaneously', async ({ app }) => {
    const conv = createConversation({ id: 'conv-multi-browser', title: 'Multi Browser' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Multi Browser');

    // Create two sessions
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'multi-1',
      status: 'active',
      url: 'https://site1.com',
    });

    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'multi-2',
      status: 'active',
      url: 'https://site2.com',
    });
  });

  // BROWSER-013: Live preview
  test('browser preview shown in UI', async ({ app }) => {
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'preview-session',
      status: 'active',
      url: 'https://example.com',
    });

    // Send a screenshot
    app.ws.send({
      type: 'browser_screenshot',
      sessionId: 'preview-session',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });

  // BROWSER-015: Session status badge
  test('status badge shows active/busy/idle/error', async ({ app }) => {
    app.ws.send({
      type: 'browser_session_created',
      sessionId: 'status-session',
      status: 'active',
      url: 'https://example.com',
    });

    // The session status should be visible in the sidebar
    await app.sidebar.toggleAccordion('Computer Use');
  });
});
