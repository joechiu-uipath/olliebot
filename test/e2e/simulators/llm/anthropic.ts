/**
 * Anthropic API Simulator
 *
 * Simulates the Anthropic Messages API (v1/messages) for Claude models.
 * Supports both streaming and non-streaming responses.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface MessageFixture {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: { input_tokens: number; output_tokens: number };
  thinking?: string;
}

export class AnthropicSimulator extends BaseSimulator {
  readonly prefix = 'anthropic';
  readonly name = 'Anthropic API';

  private nextResponse: MessageFixture | null = null;
  private responseQueue: MessageFixture[] = [];
  private defaultResponse: MessageFixture = {
    content: 'Hello! I\'m a simulated Claude response for E2E testing.',
    stopReason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 25 },
  };

  constructor() {
    super();
    this.route('POST', '/v1/messages', (req) => this.handleMessages(req));
  }

  /**
   * Set the next response to return (one-shot).
   */
  setNextResponse(fixture: MessageFixture): void {
    this.nextResponse = fixture;
  }

  /**
   * Queue multiple responses (consumed in order).
   */
  queueResponses(...fixtures: MessageFixture[]): void {
    this.responseQueue.push(...fixtures);
  }

  /**
   * Set the default response used when no fixture is queued.
   */
  setDefaultResponse(fixture: MessageFixture): void {
    this.defaultResponse = fixture;
  }

  private getNextFixture(): MessageFixture {
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

  private handleMessages(req: SimulatorRequest): SimulatorResponse {
    const body = req.body as Record<string, unknown>;
    const stream = body?.stream === true;
    const fixture = this.getNextFixture();

    if (stream) {
      return this.buildStreamResponse(fixture);
    }
    return this.buildSyncResponse(fixture);
  }

  private buildSyncResponse(fixture: MessageFixture): SimulatorResponse {
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (fixture.thinking) {
      contentBlocks.push({ type: 'thinking', text: fixture.thinking });
    }

    if (fixture.content) {
      contentBlocks.push({ type: 'text', text: fixture.content });
    }

    if (fixture.toolCalls) {
      for (const tc of fixture.toolCalls) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
    }

    return {
      status: 200,
      body: {
        id: `msg_sim_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: contentBlocks,
        model: 'claude-sonnet-4-20250514',
        stop_reason: fixture.stopReason || 'end_turn',
        usage: fixture.usage || { input_tokens: 50, output_tokens: 25 },
      },
    };
  }

  private buildStreamResponse(fixture: MessageFixture): SimulatorResponse {
    const events: string[] = [];
    const msgId = `msg_sim_${Date.now()}`;

    // message_start
    events.push(this.sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: fixture.usage?.input_tokens || 50, output_tokens: 0 },
      },
    }));

    let blockIndex = 0;

    // Thinking block
    if (fixture.thinking) {
      events.push(this.sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'thinking', text: '' },
      }));
      events.push(this.sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', text: fixture.thinking },
      }));
      events.push(this.sseEvent('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex,
      }));
      blockIndex++;
    }

    // Text content
    if (fixture.content) {
      events.push(this.sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      }));

      // Stream text in chunks
      const words = fixture.content.split(' ');
      for (const word of words) {
        events.push(this.sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: word + ' ' },
        }));
      }

      events.push(this.sseEvent('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex,
      }));
      blockIndex++;
    }

    // Tool use blocks
    if (fixture.toolCalls) {
      for (const tc of fixture.toolCalls) {
        events.push(this.sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} },
        }));
        events.push(this.sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(tc.input) },
        }));
        events.push(this.sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: blockIndex,
        }));
        blockIndex++;
      }
    }

    // message_delta + message_stop
    events.push(this.sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: fixture.stopReason || 'end_turn' },
      usage: { output_tokens: fixture.usage?.output_tokens || 25 },
    }));
    events.push(this.sseEvent('message_stop', { type: 'message_stop' }));

    return {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: events.join('\n'),
    };
  }

  private sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n`;
  }
}
