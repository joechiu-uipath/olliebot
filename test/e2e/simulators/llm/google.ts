/**
 * Google Gemini API Simulator
 *
 * Simulates the Google Generative Language API for Gemini models.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface GeminiFixture {
  content: string;
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  finishReason?: string;
  usage?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

export class GoogleSimulator extends BaseSimulator {
  readonly prefix = 'google';
  readonly name = 'Google Gemini API';

  private nextResponse: GeminiFixture | null = null;
  private responseQueue: GeminiFixture[] = [];
  private defaultResponse: GeminiFixture = {
    content: 'Hello! I\'m a simulated Gemini response for E2E testing.',
    finishReason: 'STOP',
    usage: { promptTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 75 },
  };

  constructor() {
    super();
    // Match both generateContent and streamGenerateContent
    this.route('POST', /^\/v1beta\/models\/[^/]+:generateContent$/, (req) => this.handleGenerate(req));
    this.route('POST', /^\/v1beta\/models\/[^/]+:streamGenerateContent$/, (req) => this.handleStreamGenerate(req));
  }

  setNextResponse(fixture: GeminiFixture): void {
    this.nextResponse = fixture;
  }

  queueResponses(...fixtures: GeminiFixture[]): void {
    this.responseQueue.push(...fixtures);
  }

  setDefaultResponse(fixture: GeminiFixture): void {
    this.defaultResponse = fixture;
  }

  private getNextFixture(): GeminiFixture {
    if (this.nextResponse) {
      const resp = this.nextResponse;
      this.nextResponse = null;
      return resp;
    }
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }
    return this.defaultResponse;
  }

  private handleGenerate(_req: SimulatorRequest): SimulatorResponse {
    const fixture = this.getNextFixture();
    const parts: Array<Record<string, unknown>> = [];

    if (fixture.content) {
      parts.push({ text: fixture.content });
    }
    if (fixture.functionCalls) {
      for (const fc of fixture.functionCalls) {
        parts.push({ functionCall: { name: fc.name, args: fc.args } });
      }
    }

    return {
      status: 200,
      body: {
        candidates: [{
          content: { parts, role: 'model' },
          finishReason: fixture.finishReason || 'STOP',
        }],
        usageMetadata: fixture.usage || {
          promptTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 75,
        },
      },
    };
  }

  private handleStreamGenerate(_req: SimulatorRequest): SimulatorResponse {
    const fixture = this.getNextFixture();

    // For streaming, Google returns an array of response objects
    const chunks: Array<Record<string, unknown>> = [];

    if (fixture.content) {
      const words = fixture.content.split(' ');
      for (let i = 0; i < words.length; i++) {
        chunks.push({
          candidates: [{
            content: { parts: [{ text: words[i] + ' ' }], role: 'model' },
            ...(i === words.length - 1 ? { finishReason: fixture.finishReason || 'STOP' } : {}),
          }],
          usageMetadata: i === words.length - 1
            ? (fixture.usage || { promptTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 75 })
            : undefined,
        });
      }
    }

    return {
      status: 200,
      body: chunks,
    };
  }
}
