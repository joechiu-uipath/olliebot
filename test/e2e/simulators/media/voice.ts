/**
 * Voice/TTS API Simulator
 *
 * Simulates speech-to-text and text-to-speech endpoints.
 */

import { BaseSimulator, type SimulatorResponse } from '../base.js';

export class VoiceSimulator extends BaseSimulator {
  readonly prefix = 'voice';
  readonly name = 'Voice API';

  constructor() {
    super();
    this.route('POST', '/v1/audio/transcriptions', () => this.handleTranscription());
    this.route('POST', '/v1/audio/speech', () => this.handleSpeech());
  }

  private handleTranscription(): SimulatorResponse {
    return {
      status: 200,
      body: { text: 'This is a simulated transcription for E2E testing.' },
    };
  }

  private handleSpeech(): SimulatorResponse {
    // Return a tiny valid WAV file header
    return {
      status: 200,
      headers: { 'Content-Type': 'audio/wav' },
      body: 'RIFF$\x00\x00\x00WAVEfmt ',
    };
  }
}
