import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppChannel, type WhatsAppWebhookPayload } from './whatsapp.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('WhatsAppChannel', () => {
  let channel: WhatsAppChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new WhatsAppChannel('whatsapp-test', {
      phoneNumberId: 'phone-123',
      accessToken: 'test-access-token',
      verifyToken: 'test-verify-token',
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

  describe('handleVerification', () => {
    it('should return challenge when token matches', () => {
      const result = channel.handleVerification('subscribe', 'test-verify-token', 'challenge-123');
      expect(result).toBe('challenge-123');
    });

    it('should return null when token does not match', () => {
      const result = channel.handleVerification('subscribe', 'wrong-token', 'challenge-123');
      expect(result).toBeNull();
    });

    it('should return null when mode is not subscribe', () => {
      const result = channel.handleVerification('unsubscribe', 'test-verify-token', 'challenge-123');
      expect(result).toBeNull();
    });
  });

  describe('handleWebhook', () => {
    it('should handle text messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001234', phone_number_id: 'phone-123' },
              contacts: [{ profile: { name: 'John Doe' }, wa_id: '15551234567' }],
              messages: [{
                from: '15551234567',
                id: 'wamid.HBgLMTU',
                timestamp: '1678901234',
                type: 'text',
                text: { body: 'Hello!' },
              }],
            },
            field: 'messages',
          }],
        }],
      };

      await channel.handleWebhook(payload);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'wamid.HBgLMTU',
        role: 'user',
        content: 'Hello!',
        metadata: expect.objectContaining({
          platform: 'whatsapp',
          waId: '15551234567',
          contactName: 'John Doe',
          conversationId: 'whatsapp:15551234567',
        }),
      }));
    });

    it('should handle interactive button replies', async () => {
      const actionHandler = vi.fn();
      channel.onAction(actionHandler);
      await channel.init();

      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001234', phone_number_id: 'phone-123' },
              messages: [{
                from: '15551234567',
                id: 'wamid.interactive',
                timestamp: '1678901234',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: { id: 'option-a', title: 'Option A' },
                },
              }],
            },
            field: 'messages',
          }],
        }],
      };

      await channel.handleWebhook(payload);

      expect(actionHandler).toHaveBeenCalledWith('option-a', expect.objectContaining({
        title: 'Option A',
        waId: '15551234567',
      }));
    });

    it('should route interaction responses with requestId', async () => {
      const interactionHandler = vi.fn();
      channel.onInteraction(interactionHandler);
      await channel.init();

      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001234', phone_number_id: 'phone-123' },
              messages: [{
                from: '15551234567',
                id: 'wamid.interaction',
                timestamp: '1678901234',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: JSON.stringify({ requestId: 'req-456', action: 'confirm' }),
                    title: 'Confirm',
                  },
                },
              }],
            },
            field: 'messages',
          }],
        }],
      };

      await channel.handleWebhook(payload);

      expect(interactionHandler).toHaveBeenCalledWith(
        'req-456',
        expect.objectContaining({ requestId: 'req-456', action: 'confirm' }),
        'whatsapp:15551234567',
      );
    });

    it('should ignore non-whatsapp payloads', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        object: 'instagram',
        entry: [],
      } as unknown as WhatsAppWebhookPayload);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore status updates', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001234', phone_number_id: 'phone-123' },
              statuses: [{ id: 'status-1' }],
            },
            field: 'messages',
          }],
        }],
      };

      await channel.handleWebhook(payload);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send text messages via Cloud API', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('Hello!', { conversationId: 'whatsapp:15551234567' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('phone-123/messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.to).toBe('15551234567');
      expect(body.type).toBe('text');
      expect(body.text.body).toBe('Hello!');
    });

    it('should convert markdown to WhatsApp formatting', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('**bold** and ~~strike~~', {
        conversationId: 'whatsapp:15551234567',
        markdown: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text.body).toBe('*bold* and ~strike~');
    });

    it('should send interactive buttons when buttons provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('Choose:', {
        conversationId: 'whatsapp:15551234567',
        buttons: [
          { id: 'btn-1', label: 'Yes', action: 'confirm' },
          { id: 'btn-2', label: 'No', action: 'reject' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('interactive');
      expect(body.interactive.type).toBe('button');
      expect(body.interactive.action.buttons).toHaveLength(2);
    });

    it('should truncate button labels to 20 chars', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('Choose:', {
        conversationId: 'whatsapp:15551234567',
        buttons: [
          { id: 'btn-1', label: 'A very long button label that exceeds limit', action: 'test' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    });

    it('should warn when no conversationId provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await channel.init();
      await channel.send('Hello');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no waId'));
      warnSpy.mockRestore();
    });
  });

  describe('readonly properties', () => {
    it('should have correct id and name', () => {
      expect(channel.id).toBe('whatsapp-test');
      expect(channel.name).toBe('whatsapp');
    });
  });
});
