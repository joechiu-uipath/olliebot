/**
 * OpenAI API Simulator
 *
 * Simulates the OpenAI Chat Completions API for GPT models.
 * Supports streaming (SSE) and non-streaming responses.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface ChatFixture {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason?: 'stop' | 'tool_calls' | 'length';
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class OpenAISimulator extends BaseSimulator {
  readonly prefix = 'openai';
  readonly name = 'OpenAI API';

  private nextResponse: ChatFixture | null = null;
  private responseQueue: ChatFixture[] = [];
  private defaultResponse: ChatFixture = {
    content: 'Hello! I\'m a simulated GPT response for E2E testing.',
    finishReason: 'stop',
    usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
  };

  constructor() {
    super();
    this.route('POST', '/v1/chat/completions', (req) => this.handleChatCompletions(req));
    this.route('GET', '/v1/models', () => this.handleListModels());
  }

  setNextResponse(fixture: ChatFixture): void {
    this.nextResponse = fixture;
  }

  queueResponses(...fixtures: ChatFixture[]): void {
    this.responseQueue.push(...fixtures);
  }

  setDefaultResponse(fixture: ChatFixture): void {
    this.defaultResponse = fixture;
  }

  private getNextFixture(): ChatFixture {
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

  private handleChatCompletions(req: SimulatorRequest): SimulatorResponse {
    const body = req.body as Record<string, unknown>;
    const stream = body?.stream === true;
    const fixture = this.getNextFixture();

    if (stream) {
      return this.buildStreamResponse(fixture);
    }
    return this.buildSyncResponse(fixture);
  }

  private handleListModels(): SimulatorResponse {
    return {
      status: 200,
      body: {
        data: [
          { id: 'gpt-4.1', object: 'model' },
          { id: 'gpt-4.1-mini', object: 'model' },
        ],
      },
    };
  }

  private buildSyncResponse(fixture: ChatFixture): SimulatorResponse {
    const message: Record<string, unknown> = {
      role: 'assistant',
      content: fixture.content || null,
    };

    if (fixture.toolCalls) {
      message.tool_calls = fixture.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }

    return {
      status: 200,
      body: {
        id: `chatcmpl-sim-${Date.now()}`,
        object: 'chat.completion',
        model: 'gpt-4.1',
        choices: [{
          index: 0,
          message,
          finish_reason: fixture.finishReason || 'stop',
        }],
        usage: fixture.usage || { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
      },
    };
  }

  private buildStreamResponse(fixture: ChatFixture): SimulatorResponse {
    const events: string[] = [];
    const id = `chatcmpl-sim-${Date.now()}`;

    // role chunk
    events.push(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', model: 'gpt-4.1',
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })}\n`);

    // content chunks
    if (fixture.content) {
      const words = fixture.content.split(' ');
      for (const word of words) {
        events.push(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', model: 'gpt-4.1',
          choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }],
        })}\n`);
      }
    }

    // tool call chunks
    if (fixture.toolCalls) {
      for (const tc of fixture.toolCalls) {
        events.push(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', model: 'gpt-4.1',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              }],
            },
            finish_reason: null,
          }],
        })}\n`);
      }
    }

    // finish chunk
    events.push(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', model: 'gpt-4.1',
      choices: [{ index: 0, delta: {}, finish_reason: fixture.finishReason || 'stop' }],
    })}\n`);

    events.push('data: [DONE]\n');

    return {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: events.join('\n'),
    };
  }
}
