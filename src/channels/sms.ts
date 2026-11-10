/**
 * SMS channel implementation using Twilio.
 *
 * Uses Twilio's REST API for sending SMS and webhooks for receiving.
 * Conversations are identified by phone number pairs.
 *
 * Env vars:
 *   TWILIO_ACCOUNT_SID   - Twilio Account SID
 *   TWILIO_AUTH_TOKEN     - Twilio Auth Token
 *   TWILIO_PHONE_NUMBER   - Your Twilio phone number (E.164 format, e.g. +15551234567)
 */

import { v4 as uuid } from 'uuid';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

export interface SMSChannelConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

/**
 * Incoming webhook payload from Twilio (URL-encoded form data parsed to object).
 */
export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

/** Max characters per SMS segment in GSM-7 encoding */
const GSM7_SEGMENT_LIMIT = 160;
const GSM7_MULTIPART_LIMIT = 153;
/** Max characters per SMS segment in UCS-2 encoding (triggered by emoji/unicode) */
const UCS2_SEGMENT_LIMIT = 70;
const UCS2_MULTIPART_LIMIT = 67;
/** Practical max for a single SMS (multi-segment) */
const SMS_MAX_LENGTH = 1530;

export class SMSChannel extends MessengerChannel {
  readonly id: string;
  readonly name = 'sms';

  private config: SMSChannelConfig;
  /** Basic auth header for Twilio API */
  private authHeader: string;

  constructor(id: string, config: SMSChannelConfig) {
    super();
    this.id = id;
    this.config = config;
    this.authHeader = 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  }

  async init(): Promise<void> {
    // SMS is webhook-based; no persistent connection needed.
    this.connected = true;
    console.log(`[SMSChannel] Initialized with number ${this.config.phoneNumber}`);
  }

  /**
   * Validate that the webhook request is from Twilio.
   * In production, validate the X-Twilio-Signature header.
   */
  validateWebhook(_signature: string, _url: string, _params: Record<string, string>): boolean {
    // TODO: Implement Twilio signature validation for production
    // See: https://www.twilio.com/docs/usage/security#validating-requests
    return true;
  }

  /**
   * Handle incoming webhook POST from Twilio.
   */
  async handleWebhook(payload: TwilioWebhookPayload): Promise<string> {
    if (!this.messageHandler) return this.twimlResponse();

    if (!payload.Body?.trim()) return this.twimlResponse();

    const message: Message = {
      id: payload.MessageSid,
      role: 'user',
      content: payload.Body.trim(),
      metadata: {
        platform: 'sms',
        fromNumber: payload.From,
        toNumber: payload.To,
        conversationId: `sms:${payload.From}`,
        hasMedia: parseInt(payload.NumMedia ?? '0', 10) > 0,
        mediaUrl: payload.MediaUrl0,
        mediaType: payload.MediaContentType0,
      },
      createdAt: new Date(),
    };

    await this.messageHandler(message);

    // Return empty TwiML (we send responses via the REST API, not TwiML)
    return this.twimlResponse();
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    const { phoneNumber } = this.parseConversationId(options?.conversationId);
    if (!phoneNumber) {
      console.warn('[SMSChannel] Cannot send: no phone number in conversationId');
      return;
    }

    // Strip all formatting for SMS (plain text only)
    const text = this.stripFormatting(content);

    // Truncate to SMS max length
    const truncated = text.length > SMS_MAX_LENGTH
      ? text.substring(0, SMS_MAX_LENGTH - 3) + '...'
      : text;

    await this.sendSms(phoneNumber, truncated);
  }

  private async sendSms(to: string, body: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const params = new URLSearchParams({
      To: to,
      From: this.config.phoneNumber,
      Body: body,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': this.authHeader,
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[SMSChannel] Twilio API error (${response.status}):`, errorBody);
      }
    } catch (error) {
      console.error('[SMSChannel] Failed to send SMS:', error);
    }
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    const text = details ? `Error: ${error} - ${details}` : `Error: ${error}`;
    await this.send(text, { conversationId });
  }

  async endStream(streamId: string, options?: StreamEndOptions): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (stream && stream.content) {
      const convId = options?.conversationId ?? stream.conversationId;
      await this.send(stream.content, { conversationId: convId });
    }
    this.activeStreams.delete(streamId);
  }

  async close(): Promise<void> {
    this.connected = false;
    console.log('[SMSChannel] Closed');
  }

  private parseConversationId(conversationId?: string): { phoneNumber?: string } {
    if (!conversationId) return {};
    if (conversationId.startsWith('sms:')) {
      return { phoneNumber: conversationId.substring('sms:'.length) };
    }
    return {};
  }

  /**
   * Strip all Markdown/formatting for plain-text SMS.
   */
  private stripFormatting(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
      .replace(/\*(.*?)\*/g, '$1')             // italic
      .replace(/__(.*?)__/g, '$1')             // underline
      .replace(/~~(.*?)~~/g, '$1')             // strikethrough
      .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')   // code
      .replace(/^#{1,6}\s+/gm, '')             // headers
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // links
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '') // images
      .replace(/^[>\-*]\s+/gm, '- ')          // blockquotes, lists
      .replace(/\n{3,}/g, '\n\n');             // collapse multiple newlines
  }

  /**
   * Return an empty TwiML response.
   * We respond via REST API rather than inline TwiML.
   */
  private twimlResponse(message?: string): string {
    if (message) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
    }
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  /**
   * Estimate the number of SMS segments a message will use.
   * Useful for cost estimation.
   */
  static estimateSegments(text: string): { segments: number; encoding: 'GSM-7' | 'UCS-2' } {
    // Check if text contains any non-GSM-7 characters (including emoji)
    const isUcs2 = /[^\x00-\x7F@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]/.test(text);

    if (isUcs2) {
      if (text.length <= UCS2_SEGMENT_LIMIT) return { segments: 1, encoding: 'UCS-2' };
      return { segments: Math.ceil(text.length / UCS2_MULTIPART_LIMIT), encoding: 'UCS-2' };
    }

    if (text.length <= GSM7_SEGMENT_LIMIT) return { segments: 1, encoding: 'GSM-7' };
    return { segments: Math.ceil(text.length / GSM7_MULTIPART_LIMIT), encoding: 'GSM-7' };
  }
}
