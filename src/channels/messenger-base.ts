/**
 * Abstract base class for external messenger channel implementations.
 *
 * Provides common patterns shared across all messenger integrations:
 * - Handler registration (onMessage, onAction, onInteraction)
 * - Stream accumulation (startStream, sendStreamChunk)
 * - No-op broadcast (messenger channels don't have multi-client push)
 */

import type {
  Channel,
  Message,
  SendOptions,
  StreamStartOptions,
  StreamEndOptions,
} from './types.js';

/**
 * Tracks an active LLM response stream.
 * Messenger channels accumulate chunks and send the final result on endStream,
 * since most platforms don't support real-time message editing efficiently.
 */
export interface ActiveStream {
  streamId: string;
  content: string;
  conversationId?: string;
  /** Platform-specific message ID if an initial "thinking" message was posted */
  platformMessageId?: string;
}

export abstract class MessengerChannel implements Channel {
  abstract readonly id: string;
  abstract readonly name: string;

  protected messageHandler: ((message: Message) => Promise<void>) | null = null;
  protected actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  protected interactionHandler: ((requestId: string, response: unknown, conversationId?: string) => Promise<void>) | null = null;
  protected activeStreams: Map<string, ActiveStream> = new Map();
  protected connected = false;

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  onInteraction(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void {
    this.interactionHandler = handler;
  }

  startStream(streamId: string, options?: StreamStartOptions): void {
    this.activeStreams.set(streamId, {
      streamId,
      content: '',
      conversationId: options?.conversationId,
    });
  }

  sendStreamChunk(streamId: string, chunk: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.content += chunk;
    }
  }

  /**
   * End stream: send accumulated content as a single message.
   * Subclasses may override to update an existing message instead.
   */
  async endStream(streamId: string, options?: StreamEndOptions): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (stream && stream.content) {
      await this.send(stream.content, {
        markdown: true,
        conversationId: options?.conversationId ?? stream.conversationId,
      });
    }
    this.activeStreams.delete(streamId);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * No-op for messenger channels.
   * broadcast() is for web UI system events (tool_requested, conversation_updated, etc.)
   * which are not relevant for external messenger clients.
   */
  broadcast(_data: unknown): void {
    // No-op
  }

  abstract init(): Promise<void>;
  abstract send(content: string, options?: SendOptions): Promise<void>;
  abstract sendError(error: string, details?: string, conversationId?: string): Promise<void>;
  abstract close(): Promise<void>;
}
