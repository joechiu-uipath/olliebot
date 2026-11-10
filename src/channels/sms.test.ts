import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, type TwilioWebhookPayload } from './sms.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('SMSChannel', () => {
  let channel: SMSChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new SMSChannel('sms-test', {
      accountSid: 'AC-test-sid',
      authToken: 'test-auth-token',
      phoneNumber: '+15559876543',
    });
  });

  afterEach(async () => {
    await channel.close();
  });

  describe('init', () => {
    it('should initialize', async () => {
      await channel.init();
      expect(channel.isConnected()).toBe(true);
    });
  });

  describe('handleWebhook', () => {
    it('should process incoming SMS', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM-test-123',
        From: '+15551234567',
        To: '+15559876543',
        Body: 'Hello from SMS',
      };

      const response = await channel.handleWebhook(payload);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'SM-test-123',
        role: 'user',
        content: 'Hello from SMS',
        metadata: expect.objectContaining({
          platform: 'sms',
          fromNumber: '+15551234567',
          toNumber: '+15559876543',
          conversationId: 'sms:+15551234567',
        }),
      }));

      // Should return empty TwiML
      expect(response).toContain('<Response></Response>');
    });

    it('should trim whitespace from body', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        MessageSid: 'SM-123',
        From: '+15551234567',
        To: '+15559876543',
        Body: '  hello  ',
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        content: 'hello',
      }));
    });

    it('should skip empty messages', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        MessageSid: 'SM-123',
        From: '+15551234567',
        To: '+15559876543',
        Body: '',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should detect MMS media', async () => {
      const handler = vi.fn();
      channel.onMessage(handler);
      await channel.init();

      await channel.handleWebhook({
        MessageSid: 'SM-123',
        From: '+15551234567',
        To: '+15559876543',
        Body: 'Check this out',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/image.jpg',
        MediaContentType0: 'image/jpeg',
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          hasMedia: true,
          mediaUrl: 'https://api.twilio.com/media/image.jpg',
          mediaType: 'image/jpeg',
        }),
      }));
    });
  });

  describe('send', () => {
    it('should send SMS via Twilio API', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('Hello!', { conversationId: 'sms:+15551234567' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('AC-test-sid/Messages.json'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic '),
          }),
        }),
      );

      const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
      expect(body.get('To')).toBe('+15551234567');
      expect(body.get('From')).toBe('+15559876543');
      expect(body.get('Body')).toBe('Hello!');
    });

    it('should strip markdown formatting', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.send('**bold** and `code` and [link](http://example.com)', {
        conversationId: 'sms:+15551234567',
      });

      const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
      expect(body.get('Body')).toBe('bold and code and link (http://example.com)');
    });

    it('should truncate long messages', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();

      const longText = 'x'.repeat(2000);
      await channel.send(longText, { conversationId: 'sms:+15551234567' });

      const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
      expect(body.get('Body')!.length).toBeLessThanOrEqual(1530);
      expect(body.get('Body')!.endsWith('...')).toBe(true);
    });

    it('should warn when no conversationId provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await channel.init();
      await channel.send('Hello');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
      warnSpy.mockRestore();
    });
  });

  describe('sendError', () => {
    it('should send plain text error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await channel.init();
      await channel.sendError('Something failed', 'details here', 'sms:+15551234567');

      const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
      expect(body.get('Body')).toContain('Error: Something failed');
      expect(body.get('Body')).toContain('details here');
    });
  });

  describe('estimateSegments', () => {
    it('should estimate 1 segment for short GSM-7 text', () => {
      const result = SMSChannel.estimateSegments('Hello world');
      expect(result).toEqual({ segments: 1, encoding: 'GSM-7' });
    });

    it('should estimate multiple segments for long GSM-7 text', () => {
      const text = 'a'.repeat(200);
      const result = SMSChannel.estimateSegments(text);
      expect(result).toEqual({ segments: 2, encoding: 'GSM-7' });
    });

    it('should detect UCS-2 for emoji', () => {
      const result = SMSChannel.estimateSegments('Hello 😊');
      expect(result.encoding).toBe('UCS-2');
    });

    it('should estimate more segments for UCS-2', () => {
      const text = 'Hello 😊' + 'a'.repeat(100);
      const result = SMSChannel.estimateSegments(text);
      expect(result.encoding).toBe('UCS-2');
      expect(result.segments).toBeGreaterThan(1);
    });

    it('should detect UCS-2 for smart quotes', () => {
      const result = SMSChannel.estimateSegments('She said \u201Chello\u201D');
      expect(result.encoding).toBe('UCS-2');
    });
  });

  describe('readonly properties', () => {
    it('should have correct id and name', () => {
      expect(channel.id).toBe('sms-test');
      expect(channel.name).toBe('sms');
    });
  });
});
