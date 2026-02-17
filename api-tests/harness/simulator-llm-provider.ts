/**
 * Simulator LLM Provider
 *
 * A lightweight LLMProvider implementation for API integration tests.
 * Calls the SimulatorServer's Anthropic endpoint directly via fetch,
 * avoiding any need to modify the real AnthropicProvider or install SDK
 * base URL overrides.
 *
 * Supports both sync and streaming responses, plus tool use — matching
 * the full Anthropic simulator fixture capabilities.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMResponseWithTools,
  LLMToolUse,
  StreamCallbacks,
} from '../../src/llm/types.js';

export class SimulatorLLMProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model = 'claude-simulator';

  constructor(private baseUrl: string) {}

  private get messagesUrl(): string {
    return `${this.baseUrl}/anthropic/v1/messages`;
  }

  private buildRequestBody(messages: LLMMessage[], options?: LLMOptions, stream = false) {
    return {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt,
      messages: messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content })),
      tools: options?.tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      stream,
    };
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const res = await fetch(this.messagesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildRequestBody(messages, options, false)),
    });

    const body = await res.json() as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textBlock = body.content.find(c => c.type === 'text');
    return {
      content: textBlock?.text ?? '',
      model: body.model,
      finishReason: body.stop_reason,
      usage: {
        inputTokens: body.usage.input_tokens,
        outputTokens: body.usage.output_tokens,
      },
    };
  }

  async completeWithTools(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponseWithTools> {
    const res = await fetch(this.messagesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildRequestBody(messages, options, false)),
    });

    const body = await res.json() as {
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textBlock = body.content.find(c => c.type === 'text');
    const toolUseBlocks = body.content.filter(c => c.type === 'tool_use');
    const toolUse: LLMToolUse[] = toolUseBlocks.map(t => ({
      id: t.id!,
      name: t.name!,
      input: t.input || {},
    }));

    return {
      content: textBlock?.text ?? '',
      model: body.model,
      finishReason: body.stop_reason,
      stopReason: body.stop_reason as LLMResponseWithTools['stopReason'],
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      usage: {
        inputTokens: body.usage.input_tokens,
        outputTokens: body.usage.output_tokens,
      },
    };
  }

  async stream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions,
  ): Promise<void> {
    const res = await fetch(this.messagesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildRequestBody(messages, options, true)),
    });

    const text = await res.text();
    // Parse SSE events
    let content = '';
    let model = this.model;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (data.type === 'message_start') {
          const msg = data.message as { model: string; usage?: { input_tokens: number } };
          model = msg.model;
          inputTokens = msg.usage?.input_tokens ?? 0;
        } else if (data.type === 'content_block_delta') {
          const delta = data.delta as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) {
            content += delta.text;
            callbacks.onChunk(delta.text);
          }
        } else if (data.type === 'message_delta') {
          const usage = data.usage as { output_tokens: number } | undefined;
          outputTokens = usage?.output_tokens ?? 0;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    callbacks.onComplete({
      content,
      model,
      usage: { inputTokens, outputTokens },
    });
  }
}
