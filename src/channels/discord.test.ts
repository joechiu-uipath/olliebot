import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock discord.js before import
const mockLogin = vi.fn().mockResolvedValue('token');
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const mockChannelsFetch = vi.fn();
const mockEventHandlers = new Map<string, Function>();

vi.mock('discord.js', () => {
  const GatewayIntentBits = {
    Guilds: 1,
    GuildMessages: 2,
    DirectMessages: 4,
    MessageContent: 8,
  };
  const Partials = {
    Channel: 0,
    Message: 1,
  };
  class MockClient {
    login = mockLogin;
    destroy = mockDestroy;
    user = { id: 'bot-user-id', tag: 'TestBot#1234' };
    channels = { fetch: mockChannelsFetch };
    on = vi.fn((event: string, handler: Function) => {
      mockEventHandlers.set(event, handler);
    });
  }
  return {
    Client: MockClient,
    GatewayIntentBits,
    Partials,
  };
});

import { DiscordChannel } from './discord.js';

describe('DiscordChannel', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventHandlers.clear();
    channel = new DiscordChannel('discord-test', {
      botToken: 'test-bot-token',
    });
  });

  describe('init', () => {
    it('should connect via Gateway', async () => {
      await channel.init();
      expect(mockLogin).toHaveBeenCalledWith('test-bot-token');
    });

    it('should register event handlers', async () => {
      await channel.init();
      expect(mockEventHandlers.has('ready')).toBe(true);
      expect(mockEventHandlers.has('messageCreate')).toBe(true);
      expect(mockEventHandlers.has('interactionCreate')).toBe(true);
    });

    it('should set connected on ready event', async () => {
      await channel.init();
      const readyHandler = mockEventHandlers.get('ready');
      readyHandler!();
      expect(channel.isConnected()).toBe(true);
    });
  });

  describe('message handling', () => {
    it('should handle DM messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('messageCreate');
      await messageHandler!({
        id: 'msg-123',
        content: 'Hello in DM',
        author: { id: 'user-456', bot: false },
        guild: null,
        channel: { id: 'dm-channel-789', isThread: () => false },
        mentions: { users: { has: () => false } },
        createdAt: new Date('2026-01-15T10:00:00Z'),
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'msg-123',
        content: 'Hello in DM',
        metadata: expect.objectContaining({
          platform: 'discord',
          discordUserId: 'user-456',
          isDM: true,
        }),
      }));
    });

    it('should handle @mention in guild', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('messageCreate');
      await messageHandler!({
        id: 'msg-456',
        content: '<@bot-user-id> what is the weather?',
        author: { id: 'user-789', bot: false },
        guild: { id: 'guild-123' },
        channel: { id: 'channel-456', isThread: () => false },
        mentions: { users: { has: (id: string) => id === 'bot-user-id' } },
        createdAt: new Date('2026-01-15T10:00:00Z'),
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'what is the weather?',
        metadata: expect.objectContaining({
          discordGuildId: 'guild-123',
          isDM: false,
        }),
      }));
    });

    it('should ignore non-mention guild messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('messageCreate');
      await messageHandler!({
        id: 'msg-789',
        content: 'random chatter',
        author: { id: 'user-111', bot: false },
        guild: { id: 'guild-123' },
        channel: { id: 'channel-456', isThread: () => false },
        mentions: { users: { has: () => false } },
        createdAt: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore bot messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('messageCreate');
      await messageHandler!({
        id: 'msg-bot',
        content: 'bot message',
        author: { id: 'other-bot', bot: true },
        guild: null,
        channel: { id: 'dm-channel', isThread: () => false },
        mentions: { users: { has: () => false } },
        createdAt: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore own messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const messageHandler = mockEventHandlers.get('messageCreate');
      await messageHandler!({
        id: 'msg-self',
        content: 'my own message',
        author: { id: 'bot-user-id', bot: false },
        guild: null,
        channel: { id: 'dm-channel', isThread: () => false },
        mentions: { users: { has: () => false } },
        createdAt: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send messages to a channel', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      mockChannelsFetch.mockResolvedValue({ send: mockSend });
      await channel.init();

      await channel.send('Hello!', { conversationId: 'discord:channel-123' });

      expect(mockChannelsFetch).toHaveBeenCalledWith('channel-123');
      expect(mockSend).toHaveBeenCalledWith({ content: 'Hello!' });
    });

    it('should split long messages', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      mockChannelsFetch.mockResolvedValue({ send: mockSend });
      await channel.init();

      const longText = 'a'.repeat(2500);
      await channel.send(longText, { conversationId: 'discord:channel-123' });

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should not split messages under 2000 chars', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      mockChannelsFetch.mockResolvedValue({ send: mockSend });
      await channel.init();

      await channel.send('Short message', { conversationId: 'discord:channel-123' });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should warn when no conversationId', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await channel.init();
      await channel.send('Hello');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no channelId'));
      warnSpy.mockRestore();
    });
  });

  describe('close', () => {
    it('should destroy the client', async () => {
      await channel.init();
      await channel.close();
      expect(mockDestroy).toHaveBeenCalled();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('readonly properties', () => {
    it('should have correct id and name', () => {
      expect(channel.id).toBe('discord-test');
      expect(channel.name).toBe('discord');
    });
  });
});
