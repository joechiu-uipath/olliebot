import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

/**
 * Concrete test implementation of the abstract MessengerChannel.
 */
class TestChannel extends MessengerChannel {
  readonly id = 'test-channel-1';
  readonly name = 'test';
  public sentMessages: Array<{ content: string; options?: SendOptions }> = [];
  public sentErrors: Array<{ error: string; details?: string; conversationId?: string }> = [];

  async init(): Promise<void> {
    this.connected = true;
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    this.sentMessages.push({ content, options });
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    this.sentErrors.push({ error, details, conversationId });
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  // Expose protected members for testing
  getMessageHandler() { return this.messageHandler; }
  getActionHandler() { return this.actionHandler; }
  getInteractionHandler() { return this.interactionHandler; }
  getActiveStreams() { return this.activeStreams; }
}

describe('MessengerChannel (abstract base)', () => {
  let channel: TestChannel;

  beforeEach(() => {
    channel = new TestChannel();
  });

  describe('handler registration', () => {
    it('should register message handler', () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      expect(channel.getMessageHandler()).toBe(handler);
    });

    it('should register action handler', () => {
      const handler = vi.fn();
      channel.onAction(handler);
      expect(channel.getActionHandler()).toBe(handler);
    });

    it('should register interaction handler', () => {
      const handler = vi.fn();
      channel.onInteraction(handler);
      expect(channel.getInteractionHandler()).toBe(handler);
    });
  });

  describe('connection state', () => {
    it('should be disconnected by default', () => {
      expect(channel.isConnected()).toBe(false);
    });

    it('should be connected after init', async () => {
      await channel.init();
      expect(channel.isConnected()).toBe(true);
    });

    it('should be disconnected after close', async () => {
      await channel.init();
      await channel.close();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('streaming', () => {
    it('should accumulate stream chunks', () => {
      channel.startStream('stream-1', { conversationId: 'conv-1' });
      channel.sendStreamChunk('stream-1', 'Hello ');
      channel.sendStreamChunk('stream-1', 'world');

      const streams = channel.getActiveStreams();
      expect(streams.get('stream-1')?.content).toBe('Hello world');
    });

    it('should ignore chunks for unknown streams', () => {
      channel.sendStreamChunk('nonexistent', 'data');
      expect(channel.getActiveStreams().size).toBe(0);
    });

    it('should send accumulated content on endStream', async () => {
      await channel.init();
      channel.startStream('stream-1', { conversationId: 'conv-1' });
      channel.sendStreamChunk('stream-1', 'Hello ');
      channel.sendStreamChunk('stream-1', 'world');
      await channel.endStream('stream-1', { conversationId: 'conv-1' });

      expect(channel.sentMessages).toHaveLength(1);
      expect(channel.sentMessages[0].content).toBe('Hello world');
      expect(channel.sentMessages[0].options?.markdown).toBe(true);
    });

    it('should not send if stream has no content', async () => {
      await channel.init();
      channel.startStream('stream-1');
      await channel.endStream('stream-1');

      expect(channel.sentMessages).toHaveLength(0);
    });

    it('should clean up stream after endStream', async () => {
      await channel.init();
      channel.startStream('stream-1');
      channel.sendStreamChunk('stream-1', 'data');
      await channel.endStream('stream-1');

      expect(channel.getActiveStreams().size).toBe(0);
    });

    it('should use stream conversationId when endStream options lack it', async () => {
      await channel.init();
      channel.startStream('stream-1', { conversationId: 'conv-from-start' });
      channel.sendStreamChunk('stream-1', 'data');
      await channel.endStream('stream-1');

      expect(channel.sentMessages[0].options?.conversationId).toBe('conv-from-start');
    });

    it('should prefer endStream conversationId over stream conversationId', async () => {
      await channel.init();
      channel.startStream('stream-1', { conversationId: 'conv-from-start' });
      channel.sendStreamChunk('stream-1', 'data');
      await channel.endStream('stream-1', { conversationId: 'conv-from-end' });

      expect(channel.sentMessages[0].options?.conversationId).toBe('conv-from-end');
    });
  });

  describe('broadcast', () => {
    it('should be a no-op', () => {
      // Should not throw
      channel.broadcast({ type: 'conversation_created', conversation: { id: '1' } });
      channel.broadcast({ type: 'tool_requested', requestId: '123' });
    });
  });

  describe('readonly properties', () => {
    it('should have readonly id', () => {
      expect(channel.id).toBe('test-channel-1');
    });

    it('should have readonly name', () => {
      expect(channel.name).toBe('test');
    });
  });
});
