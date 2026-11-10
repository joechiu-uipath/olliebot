import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @slack/bolt before import
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
const mockEventHandlers = new Map<string, (...args: any[]) => any>();
const mockActionHandler = vi.fn();

vi.mock('@slack/bolt', () => {
  class MockApp {
    start = mockStart;
    stop = mockStop;
    client = { chat: { postMessage: mockPostMessage } };
    event = vi.fn((eventName: string, handler: (...args: any[]) => any) => {
      mockEventHandlers.set(eventName, handler);
    });
    action = vi.fn((_pattern: RegExp, handler: (...args: any[]) => any) => {
      mockActionHandler.mockImplementation(handler);
    });
  }
  return { App: MockApp };
});

import { SlackChannel } from './slack.js';
import type { Message } from './types.js';

describe('SlackChannel', () => {
  let channel: SlackChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventHandlers.clear();
    channel = new SlackChannel('slack-test', {
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
    });
  });

  describe('init', () => {
    it('should initialize and connect', async () => {
      await channel.init();
      expect(channel.isConnected()).toBe(true);
      expect(mockStart).toHaveBeenCalled();
    });

    it('should register event handlers', async () => {
      await channel.init();
      expect(mockEventHandlers.has('app_mention')).toBe(true);
      expect(mockEventHandlers.has('message')).toBe(true);
    });
  });

  describe('message handling', () => {
    it('should handle app_mention events', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const mentionHandler = mockEventHandlers.get('app_mention');
      expect(mentionHandler).toBeDefined();

      await mentionHandler!({
        event: {
          ts: '1234567890.123456',
          text: '<@U12345> hello bot',
          user: 'U99999',
          channel: 'C12345',
          thread_ts: undefined,
        },
        say: vi.fn(),
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: '1234567890.123456',
        role: 'user',
        content: 'hello bot',
        metadata: expect.objectContaining({
          platform: 'slack',
          slackUserId: 'U99999',
          slackChannelId: 'C12345',
        }),
      }));
    });

    it('should handle DM messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('message');
      expect(messageHandler).toBeDefined();

      await messageHandler!({
        event: {
          ts: '1234567890.654321',
          text: 'hello in DM',
          user: 'U99999',
          channel: 'D12345',
          channel_type: 'im',
        },
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'hello in DM',
        metadata: expect.objectContaining({
          slackChannelId: 'D12345',
        }),
      }));
    });

    it('should skip non-DM channel messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('message');
      await messageHandler!({
        event: {
          ts: '1234567890.000',
          text: 'channel message',
          user: 'U99999',
          channel: 'C12345',
          channel_type: 'channel',
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip messages with subtypes (edits, deletes, etc.)', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('message');
      await messageHandler!({
        event: {
          ts: '1234567890.000',
          text: 'edited message',
          user: 'U99999',
          channel: 'D12345',
          channel_type: 'im',
          subtype: 'message_changed',
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip empty mentions', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const mentionHandler = mockEventHandlers.get('app_mention');
      await mentionHandler!({
        event: {
          ts: '1234567890.000',
          text: '<@U12345>',
          user: 'U99999',
          channel: 'C12345',
        },
        say: vi.fn(),
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send messages via chat.postMessage', async () => {
      await channel.init();
      await channel.send('Hello world', {
        conversationId: 'slack:C12345:1234.5678',
      });

      expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C12345',
        thread_ts: '1234.5678',
      }));
    });

    it('should convert markdown to mrkdwn', async () => {
      await channel.init();
      await channel.send('**bold** and [link](http://example.com)', {
        conversationId: 'slack:C12345:1234.5678',
        markdown: true,
      });

      expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: '*bold* and <http://example.com|link>',
      }));
    });

    it('should add Block Kit buttons when buttons option provided', async () => {
      await channel.init();
      await channel.send('Choose:', {
        conversationId: 'slack:C12345:1234.5678',
        buttons: [
          { id: 'btn-1', label: 'Yes', action: 'approve' },
          { id: 'btn-2', label: 'No', action: 'reject' },
        ],
      });

      const call = mockPostMessage.mock.calls[0][0];
      expect(call.blocks).toBeDefined();
      expect(call.blocks[1].type).toBe('actions');
      expect(call.blocks[1].elements).toHaveLength(2);
    });

    it('should warn when no conversationId provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await channel.init();
      await channel.send('Hello');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no channelId'));
      warnSpy.mockRestore();
    });
  });

  describe('sendError', () => {
    it('should format error with details', async () => {
      await channel.init();
      // Spy on send
      const sendSpy = vi.spyOn(channel, 'send');
      await channel.sendError('Something failed', 'stack trace here', 'slack:C12345:1234.5678');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('*Error:* Something failed'),
        expect.objectContaining({ conversationId: 'slack:C12345:1234.5678' }),
      );
    });
  });

  describe('close', () => {
    it('should stop the Bolt app', async () => {
      await channel.init();
      await channel.close();
      expect(mockStop).toHaveBeenCalled();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('readonly properties', () => {
    it('should have correct id and name', () => {
      expect(channel.id).toBe('slack-test');
      expect(channel.name).toBe('slack');
    });
  });
});
