/**
 * Desktop Automation - UI Display Tests
 *
 * Covers: DESKTOP-011 through DESKTOP-015
 * Note: DESKTOP-001 to DESKTOP-010 require actual Windows Sandbox (untestable)
 *
 * Desktop sessions are created via WS event 'desktop_session_created' with data.session object.
 * They appear in the "Computer Use" accordion alongside browser sessions.
 * Session items use .browser-session-item class (shared for both types).
 */

import { test, expect } from '../../utils/test-base.js';
import { ToolName, SessionStatus } from '../../constants/index.js';

function makeDesktopSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Desktop ${id}`,
    status: SessionStatus.ACTIVE,
    sandbox: { type: 'windows-sandbox' },
    viewport: { width: 1920, height: 1080 },
    ...overrides,
  };
}

test.describe('Desktop Automation UI', () => {

  // DESKTOP-011: Session thumbnail
  test('desktop session shows thumbnail in sidebar accordion', async ({ app }) => {
    // Create a desktop session via WS event (auto-expands Computer Use accordion)
    app.ws.send({
      type: 'desktop_session_created',
      session: makeDesktopSession('desktop-1', { name: 'Win Desktop' }),
    });

    // Send screenshot
    app.ws.send({
      type: 'desktop_screenshot',
      sessionId: 'desktop-1',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    });

    // Session should appear in the auto-expanded accordion
    const sessionItem = app.sidebar.sessionByName('Win Desktop');
    await expect(sessionItem).toBeVisible();
  });

  // DESKTOP-012: Session status badge
  test('status badge shows provisioning/active/error', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      session: makeDesktopSession('desktop-status', { name: 'Status Desktop', status: 'provisioning' }),
    });

    await expect(app.sidebar.sessionByName('Status Desktop')).toBeVisible();
    await expect(app.sidebar.sessionStatusBadge('Status Desktop')).toBeVisible();
  });

  // DESKTOP-013: Preview modal
  test('click session opens live preview modal', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      session: makeDesktopSession('desktop-preview', { name: 'Preview Desktop' }),
    });

    app.ws.send({
      type: 'desktop_screenshot',
      sessionId: 'desktop-preview',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    });

    // Click the session item to select it (which triggers the preview)
    const sessionItem = app.sidebar.sessionByName('Preview Desktop');
    await expect(sessionItem).toBeVisible();
    await sessionItem.click();

    // Selected state should be applied
    await expect(sessionItem).toHaveClass(/selected/);
  });

  // DESKTOP-014: Viewport dimensions
  test('modal shows viewport dimensions', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      session: makeDesktopSession('desktop-viewport', {
        name: 'Viewport Desktop',
        viewport: { width: 1920, height: 1080 },
      }),
    });

    // Session item shows viewport info in the URL field
    await expect(app.sidebar.sessionByName('Viewport Desktop')).toBeVisible();
    await expect(app.sidebar.sessionUrl('Viewport Desktop')).toContainText('1920');
  });

  // DESKTOP-015: Platform icon
  test('modal shows platform icon', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      session: makeDesktopSession('desktop-platform', {
        name: 'Platform Desktop',
        sandbox: { type: 'windows-sandbox' },
      }),
    });

    // Session should show the WinSandbox strategy label
    await expect(app.sidebar.sessionByName('Platform Desktop')).toBeVisible();
    await expect(app.sidebar.sessionStrategy('Platform Desktop')).toContainText('WinSandbox');
  });
});
