/**
 * Tools - Media & Output Tests
 *
 * Covers: TOOL-MEDIA-001 through TOOL-MEDIA-010
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';
import { ToolName } from '../../constants/index.js';

// Sample base64 PNG (1x1 transparent pixel) for testing
const SAMPLE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE_IMAGE_DATA_URL = `data:image/png;base64,${SAMPLE_IMAGE_BASE64}`;

// Sample base64 audio for testing (needs to be >100 chars for UI to detect)
// This is a minimal but valid-length audio sample for detection purposes
const SAMPLE_AUDIO_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SAMPLE_AUDIO_DATA_URL = `data:audio/wav;base64,${SAMPLE_AUDIO_BASE64}`;

test.describe('Media & Output Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-media', title: 'Media Tools' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Media Tools');
  });

  // TOOL-MEDIA-001: Create image
  test('generates image via create_image tool', async ({ app }) => {
    await app.chat.sendMessage('Create an image of a sunset');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-img',
      requestId: 'req-img',
      toolName: ToolName.CREATE_IMAGE,
      parameters: { prompt: 'A beautiful sunset over mountains' },
      result: JSON.stringify({ url: SAMPLE_IMAGE_DATA_URL, revisedPrompt: 'Sunset over mountains' }),
    });

    app.ws.simulateResponse({
      conversationId: 'conv-media',
      content: 'Here is the generated image of a sunset over mountains.',
      turnId: 'turn-img',
    });

    await expect(app.chat.toolByName(ToolName.CREATE_IMAGE)).toBeVisible();
  });

  // TOOL-MEDIA-002: Speak (TTS)
  test('generates speech audio via speak tool', async ({ app }) => {
    await app.chat.sendMessage('Say hello in audio');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-tts',
      requestId: 'req-tts',
      toolName: ToolName.SPEAK,
      parameters: { text: 'Hello, world!' },
      result: JSON.stringify({ audio: SAMPLE_AUDIO_BASE64, mimeType: 'audio/wav' }),
    });

    await expect(app.chat.toolByName(ToolName.SPEAK)).toBeVisible();
  });

  // TOOL-MEDIA-003: Take screenshot
  test('captures screen via take_screenshot', async ({ app }) => {
    await app.chat.sendMessage('Take a screenshot');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-ss',
      requestId: 'req-ss',
      toolName: ToolName.TAKE_SCREENSHOT,
      parameters: {},
      result: JSON.stringify({ screenshot: SAMPLE_IMAGE_DATA_URL }),
    });

    await expect(app.chat.toolByName(ToolName.TAKE_SCREENSHOT)).toBeVisible();
  });

  // TOOL-MEDIA-004: Image preview in create_image tool result
  test('displays inline image preview in create_image tool result', async ({ app }) => {
    await app.chat.sendMessage('Generate an image');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-img-preview',
      requestId: 'req-img-preview',
      toolName: ToolName.CREATE_IMAGE,
      parameters: { prompt: 'A mountain landscape' },
      result: JSON.stringify({ url: SAMPLE_IMAGE_DATA_URL, revisedPrompt: 'Mountain landscape' }),
    });

    await expect(app.chat.toolByName(ToolName.CREATE_IMAGE)).toBeVisible();

    // Expand tool details to see the image preview
    await app.chat.expandTool(ToolName.CREATE_IMAGE);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify image preview is displayed with data URL
    await expect(app.chat.toolResultImages.first()).toBeVisible();
    const imgSrc = await app.chat.getToolResultImageSrc();
    expect(imgSrc).toMatch(/^data:image\//);
  });

  // TOOL-MEDIA-005: Image preview in take_screenshot tool result
  test('displays inline image preview in take_screenshot tool result', async ({ app }) => {
    await app.chat.sendMessage('Screenshot please');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-ss-preview',
      requestId: 'req-ss-preview',
      toolName: ToolName.TAKE_SCREENSHOT,
      parameters: {},
      result: JSON.stringify({ screenshot: SAMPLE_IMAGE_DATA_URL }),
    });

    await expect(app.chat.toolByName(ToolName.TAKE_SCREENSHOT)).toBeVisible();

    // Expand tool details to see the image preview
    await app.chat.expandTool(ToolName.TAKE_SCREENSHOT);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify image preview is displayed
    await expect(app.chat.toolResultImages.first()).toBeVisible();
    const imgSrc = await app.chat.getToolResultImageSrc();
    expect(imgSrc).toMatch(/^data:image\//);
  });

  // TOOL-MEDIA-006: Audio player in speak tool result
  test('displays audio player in speak tool result', async ({ app }) => {
    await app.chat.sendMessage('Say something');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-audio-preview',
      requestId: 'req-audio-preview',
      toolName: ToolName.SPEAK,
      parameters: { text: 'Hello world' },
      result: JSON.stringify({ audio: SAMPLE_AUDIO_BASE64, mimeType: 'audio/wav' }),
    });

    await expect(app.chat.toolByName(ToolName.SPEAK)).toBeVisible();

    // Expand tool details to see the audio player
    await app.chat.expandTool(ToolName.SPEAK);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify audio player is displayed
    await expect(app.chat.audioPlayButton).toBeVisible();
    const buttonText = await app.chat.getAudioPlayButtonText();
    expect(buttonText).toContain('Play');
  });

  // TOOL-MEDIA-007: Image preview with files array format (run_python style)
  test('displays image preview from files array in tool result', async ({ app }) => {
    await app.chat.sendMessage('Generate a chart with Python');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-py-img',
      requestId: 'req-py-img',
      toolName: ToolName.RUN_PYTHON,
      parameters: { code: 'import matplotlib...' },
      result: JSON.stringify({
        output: 'Chart generated',
        files: [
          { name: 'chart.png', dataUrl: SAMPLE_IMAGE_DATA_URL, mediaType: 'image/png' },
        ],
      }),
    });

    await expect(app.chat.toolByName(ToolName.RUN_PYTHON)).toBeVisible();

    // Expand tool details to see the image preview
    await app.chat.expandTool(ToolName.RUN_PYTHON);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify image preview from files array is displayed
    await expect(app.chat.toolResultImages.first()).toBeVisible();
  });

  // TOOL-MEDIA-008: Audio player with files array format
  test('displays audio player from files array in tool result', async ({ app }) => {
    await app.chat.sendMessage('Generate audio with Python');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-py-audio',
      requestId: 'req-py-audio',
      toolName: ToolName.RUN_PYTHON,
      parameters: { code: 'import soundfile...' },
      result: JSON.stringify({
        output: 'Audio generated',
        files: [
          { name: 'output.wav', dataUrl: SAMPLE_AUDIO_DATA_URL, mediaType: 'audio/wav' },
        ],
      }),
    });

    await expect(app.chat.toolByName(ToolName.RUN_PYTHON)).toBeVisible();

    // Expand tool details to see the audio player
    await app.chat.expandTool(ToolName.RUN_PYTHON);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify audio player from files array is displayed
    await expect(app.chat.audioPlayButton).toBeVisible();
  });

  // TOOL-MEDIA-009: Multiple images in tool result
  test('displays multiple images in tool result', async ({ app }) => {
    await app.chat.sendMessage('Generate multiple charts');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-multi-img',
      requestId: 'req-multi-img',
      toolName: ToolName.RUN_PYTHON,
      parameters: { code: 'generate_charts()' },
      result: JSON.stringify({
        output: 'Generated 2 charts',
        files: [
          { name: 'chart1.png', dataUrl: SAMPLE_IMAGE_DATA_URL, mediaType: 'image/png' },
          { name: 'chart2.png', dataUrl: SAMPLE_IMAGE_DATA_URL, mediaType: 'image/png' },
        ],
      }),
    });

    await expect(app.chat.toolByName(ToolName.RUN_PYTHON)).toBeVisible();

    // Expand tool details
    await app.chat.expandTool(ToolName.RUN_PYTHON);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify both images are displayed
    await expect(app.chat.toolResultImages).toHaveCount(2);
  });

  // TOOL-MEDIA-010: Direct data URL string as result
  test('displays image preview when result is direct data URL string', async ({ app }) => {
    await app.chat.sendMessage('Get image data');

    app.ws.simulateToolExecution({
      conversationId: 'conv-media',
      turnId: 'turn-direct-url',
      requestId: 'req-direct-url',
      toolName: ToolName.HTTP_CLIENT,
      parameters: { url: 'https://example.com/image.png' },
      result: SAMPLE_IMAGE_DATA_URL, // Direct data URL without JSON wrapper
    });

    await expect(app.chat.toolByName(ToolName.HTTP_CLIENT)).toBeVisible();

    // Expand tool details
    await app.chat.expandTool(ToolName.HTTP_CLIENT);
    await expect(app.chat.toolDetails).toBeVisible();

    // Verify image preview is displayed
    await expect(app.chat.toolResultImages.first()).toBeVisible();
    const imgSrc = await app.chat.getToolResultImageSrc();
    expect(imgSrc).toMatch(/^data:image\//);
  });
});
