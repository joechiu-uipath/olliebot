import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureBotChannel, type BotActivity } from './azure-bot.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AzureBotChannel', () => {
  let channel: AzureBotChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new AzureBotChannel('azure-bot-test', {
      appId: 'test-app-id',
      appPassword: 'test-app-password',
      tenantId: 'test-tenant-id',
    });
  });

  afterEach(async () => {
    await channel.close();
  });

  describe('init', () => {
    it('should initialize in webhook mode', async () => {
      await channel.init();
      expect(channel.isConnected()).toBe(true);
    });
  });

  describe('handleWebhook', () => {
    it('should handle text messages from Teams', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        id: 'activity-123',
        timestamp: '2026-01-15T10:30:00Z',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-aad-id', name: 'Test User' },
        conversation: { id: 'conv-123', tenantId: 'tenant-123' },
        recipient: { id: 'bot-id', name: 'OllieBot' },
        text: 'Hello bot',
      };

      await channel.handleWebhook(activity);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'activity-123',
        role: 'user',
        content: 'Hello bot',
        metadata: expect.objectContaining({
          platform: 'msteams',
          azureConversationId: 'conv-123',
        }),
      }));
    });

    it('should strip @mentions from Teams messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id', name: 'OllieBot' },
        text: '<at>OllieBot</at> what is the weather?',
        entities: [{ type: 'mention', mentioned: { id: 'bot-id', name: 'OllieBot' } }],
      };

      await channel.handleWebhook(activity);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'what is the weather?',
      }));
    });

    it('should handle messages from Facebook Messenger channel', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://facebook.botframework.com/',
        channelId: 'facebook',
        from: { id: 'fb-user-123', name: 'FB User' },
        conversation: { id: 'fb-conv-456' },
        recipient: { id: 'bot-id' },
        text: 'Hello from Facebook',
      };

      await channel.handleWebhook(activity);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Hello from Facebook',
        metadata: expect.objectContaining({
          platform: 'facebook',
        }),
      }));
    });

    it('should handle messages from LINE channel', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://line.botframework.com/',
        channelId: 'line',
        from: { id: 'line-user-789' },
        conversation: { id: 'line-conv-101' },
        recipient: { id: 'bot-id' },
        text: 'Hello from LINE',
      };

      await channel.handleWebhook(activity);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Hello from LINE',
        metadata: expect.objectContaining({
          platform: 'line',
        }),
      }));
    });

    it('should handle Action.Submit from Adaptive Cards', async () => {
      const actionHandler = vi.fn();
      channel.onAction(actionHandler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
        value: { action: 'approve', data: { missionId: 'mission-1' } },
      };

      await channel.handleWebhook(activity);

      expect(actionHandler).toHaveBeenCalledWith('approve', expect.objectContaining({
        action: 'approve',
        data: { missionId: 'mission-1' },
      }));
    });

    it('should route interaction responses with requestId', async () => {
      const interactionHandler = vi.fn();
      channel.onInteraction(interactionHandler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
        value: { requestId: 'req-123', approved: true },
      };

      await channel.handleWebhook(activity);

      expect(interactionHandler).toHaveBeenCalledWith(
        'req-123',
        expect.objectContaining({ approved: true }),
        'azure-bot:msteams:conv-1',
      );
    });

    it('should return null for non-message activities', async () => {
      await channel.init();

      const activity: BotActivity = {
        type: 'conversationUpdate',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
      };

      const result = await channel.handleWebhook(activity);
      expect(result).toBeNull();
    });

    it('should skip empty messages after stripping mentions', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const activity: BotActivity = {
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
        text: '<at>OllieBot</at>',
        entities: [{ type: 'mention', mentioned: { id: 'bot-id', name: 'OllieBot' } }],
      };

      await channel.handleWebhook(activity);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send messages via Bot Connector REST API', async () => {
      // Set up a conversation reference by handling a message first
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
        text: 'hi',
      });

      // Mock the token fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      });
      // Mock the message send
      mockFetch.mockResolvedValueOnce({ ok: true });

      await channel.send('Hello back', {
        conversationId: 'azure-bot:msteams:conv-1',
      });

      // Second call should be the message send
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const sendCall = mockFetch.mock.calls[1];
      expect(sendCall[0]).toContain('v3/conversations/conv-1/activities');
      expect(sendCall[1].method).toBe('POST');
    });

    it('should send Adaptive Card with buttons for Teams', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        type: 'message',
        serviceUrl: 'https://smba.trafficmanager.net/test/',
        channelId: 'msteams',
        from: { id: 'user-1' },
        conversation: { id: 'conv-1' },
        recipient: { id: 'bot-id' },
        text: 'hi',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      await channel.send('Choose an option:', {
        conversationId: 'azure-bot:msteams:conv-1',
        buttons: [
          { id: 'btn-1', label: 'Yes', action: 'confirm' },
          { id: 'btn-2', label: 'No', action: 'cancel' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.attachments).toBeDefined();
      expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    });

    it('should warn when no conversation reference exists', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await channel.init();
      await channel.send('Hello', { conversationId: 'azure-bot:msteams:unknown-conv' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no conversation reference'), expect.anything());
      warnSpy.mockRestore();
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await channel.init();
      await channel.close();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('readonly properties', () => {
    it('should have correct id and name', () => {
      expect(channel.id).toBe('azure-bot-test');
      expect(channel.name).toBe('azure-bot');
    });
  });
});
