/**
 * Tools - Media & Output Tests
 *
 * Covers: TOOL-MEDIA-001 through TOOL-MEDIA-003
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Media & Output Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-media', title: 'Media Tools' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Media Tools');
  });

  // TOOL-MEDIA-001: Create image
  test('generates image via create_image tool', async ({ app }) => {
    await app.chat.sendMessage('Create an image of a sunset');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-img',
      requestId: 'req-img',
      toolName: 'create_image',
      parameters: { prompt: 'A beautiful sunset over mountains' },
      result: JSON.stringify({ url: 'data:image/png;base64,iVBORw0KGgo=', revisedPrompt: 'Sunset over mountains' }),
    });

    app.ws.simulateResponse({
      conversationId: 'conv-media',
      content: 'Here is the generated image of a sunset over mountains.',
      turnId: 'turn-img',
    });

    await expect(app.chat.toolByName('create_image')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-MEDIA-002: Speak (TTS)
  test('generates speech audio via speak tool', async ({ app }) => {
    await app.chat.sendMessage('Say hello in audio');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-tts',
      requestId: 'req-tts',
      toolName: 'speak',
      parameters: { text: 'Hello, world!' },
      result: JSON.stringify({ audioGenerated: true }),
    });

    await expect(app.chat.toolByName('speak')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-MEDIA-003: Take screenshot
  test('captures screen via take_screenshot', async ({ app }) => {
    await app.chat.sendMessage('Take a screenshot');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-ss',
      requestId: 'req-ss',
      toolName: 'take_screenshot',
      parameters: {},
      result: JSON.stringify({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' }),
    });

    await expect(app.chat.toolByName('take_screenshot')).toBeVisible({ timeout: 5000 });
  });
});
