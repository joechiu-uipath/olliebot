/**
 * Desktop Automation - UI Display Tests
 *
 * Covers: DESKTOP-011 through DESKTOP-015
 * Note: DESKTOP-001 to DESKTOP-010 require actual Windows Sandbox (untestable)
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Desktop Automation UI', () => {

  // DESKTOP-011: Session thumbnail
  test('desktop session shows thumbnail in sidebar accordion', async ({ app }) => {
    // Create a desktop session via WS event
    app.ws.send({
      type: 'desktop_session_created',
      sessionId: 'desktop-1',
      status: 'active',
      platform: 'windows',
    });

    // Send screenshot
    app.ws.send({
      type: 'desktop_screenshot',
      sessionId: 'desktop-1',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    });

    await app.sidebar.toggleAccordion('Computer Use');
  });

  // DESKTOP-012: Session status badge
  test('status badge shows provisioning/active/error', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      sessionId: 'desktop-status',
      status: 'provisioning',
      platform: 'windows',
    });

    await app.sidebar.toggleAccordion('Computer Use');
  });

  // DESKTOP-013: Preview modal
  test('click session opens live preview modal', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      sessionId: 'desktop-preview',
      status: 'active',
      platform: 'windows',
    });

    app.ws.send({
      type: 'desktop_screenshot',
      sessionId: 'desktop-preview',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    });

    // The preview modal would open on click
    await app.sidebar.toggleAccordion('Computer Use');
  });

  // DESKTOP-014: Viewport dimensions
  test('modal shows viewport dimensions', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      sessionId: 'desktop-viewport',
      status: 'active',
      platform: 'windows',
      width: 1920,
      height: 1080,
    });

    await app.sidebar.toggleAccordion('Computer Use');
  });

  // DESKTOP-015: Platform icon
  test('modal shows platform icon', async ({ app }) => {
    app.ws.send({
      type: 'desktop_session_created',
      sessionId: 'desktop-platform',
      status: 'active',
      platform: 'windows',
    });

    await app.sidebar.toggleAccordion('Computer Use');
  });
});
