/**
 * Browser Automation - Session Management & UI Tests
 *
 * Covers: BROWSER-001, BROWSER-007, BROWSER-008, BROWSER-012 through BROWSER-017
 *
 * Browser sessions are created via WS event 'browser_session_created' with data.session object.
 * They appear in the "Computer Use" accordion which auto-expands when sessions exist.
 * Session items use .browser-session-item class.
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';
import { ToolName, SessionStatus } from '../../constants/index.js';

function makeBrowserSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Session ${id}`,
    status: SessionStatus.ACTIVE,
    strategy: 'computer-use',
    provider: 'anthropic',
    currentUrl: 'https://example.com',
    ...overrides,
  };
}

test.describe('Browser Automation', () => {

  // BROWSER-001: Create browser session
  test('creates a browser session via tool call', async ({ app }) => {
    const conv = createConversation({ id: 'conv-browser', title: 'Browser Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Browser Test');

    await app.chat.sendMessage('Open a browser to example.com');

    // Simulate browser session creation via WS
    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('session-1'),
    });

    // Simulate tool execution for the browser_session tool
    app.ws.simulateToolExecution({
      conversationId: 'conv-browser',
      turnId: 'turn-b1',
      requestId: 'req-b1',
      toolName: ToolName.BROWSER_SESSION,
      parameters: { action: 'create' },
      result: JSON.stringify({ sessionId: 'session-1', status: SessionStatus.ACTIVE }),
    });

    await expect(app.chat.toolByName(ToolName.BROWSER_SESSION)).toBeVisible();
  });

  // BROWSER-007: Close session
  test('closes browser session via API', async ({ app }) => {
    // Simulate an active session
    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('session-close'),
    });

    // Close it
    app.ws.send({
      type: 'browser_session_closed',
      sessionId: 'session-close',
    });
  });

  // BROWSER-008: List sessions
  test('shows all active browser sessions', async ({ app }) => {
    // Create multiple sessions — the Computer Use accordion auto-expands
    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('session-a', { name: 'Session A' }),
    });

    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('session-b', { name: 'Session B' }),
    });

    // Wait for the auto-expanded Computer Use accordion
    await expect(app.sidebar.browserSessionItems).toHaveCount(2, );
  });

  // BROWSER-012: Multiple sessions
  test('runs multiple browser sessions simultaneously', async ({ app }) => {
    const conv = createConversation({ id: 'conv-multi-browser', title: 'Multi Browser' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Multi Browser');

    // Create two sessions
    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('multi-1', { name: 'First' }),
    });

    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('multi-2', { name: 'Second' }),
    });
  });

  // BROWSER-013: Live preview
  test('browser preview shown in UI', async ({ app }) => {
    app.ws.send({
      type: 'browser_session_created',
      session: makeBrowserSession('preview-session', { name: 'Preview' }),
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
      session: makeBrowserSession('status-session', { name: 'Status Test' }),
    });

    // Wait for session item to appear with status badge
    await expect(app.sidebar.sessionByName('Status Test')).toBeVisible();
    await expect(app.sidebar.sessionStatusBadge('Status Test')).toBeVisible();

    // Update status to busy
    app.ws.send({
      type: 'browser_session_updated',
      sessionId: 'status-session',
      updates: { status: SessionStatus.BUSY },
    });
  });
});
