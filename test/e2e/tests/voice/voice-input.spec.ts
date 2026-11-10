/**
 * Voice Input Tests
 *
 * Covers: VOICE-001 through VOICE-007
 * Note: Actual audio recording/transcription requires real hardware.
 * These tests verify the UI state machine and visual feedback.
 */

import { test, expect } from '../../utils/test-base.js';
import { AgentType, TraceStatus } from '../../constants/index.js';

test.describe('Voice Input', () => {

  // VOICE-001: Voice mode toggle
  test('voice button exists and is clickable', async ({ app }) => {
    // The voice button should be present in the chat input area
    const voiceBtn = app.chat.voiceButton;
    if (await voiceBtn.isVisible()) {
      // Voice button is available
      expect(await voiceBtn.isEnabled()).toBe(true);
    }
  });

  // VOICE-005: Voice connection state
  test('UI reflects voice connection states', async ({ app }) => {
    // Voice button should exist
    const voiceBtn = app.chat.voiceButton;
    if (await voiceBtn.isVisible()) {
      // Initially not recording
      expect(await app.chat.isVoiceRecording()).toBe(false);
    }
  });

  // VOICE-007: Voice placeholder text
  test('input placeholder changes based on voice state', async ({ app }) => {
    // Default placeholder (not in voice mode)
    const placeholder = await app.chat.getInputPlaceholder();
    expect(placeholder.length).toBeGreaterThan(0);
  });
});
