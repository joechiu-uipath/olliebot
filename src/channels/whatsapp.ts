/**
 * WhatsApp channel implementation using the official Cloud API.
 *
 * Uses Meta's WhatsApp Cloud API for sending/receiving messages.
 * Requires a registered webhook endpoint for incoming messages.
 *
 * Env vars:
 *   WHATSAPP_PHONE_NUMBER_ID  - Business phone number ID
 *   WHATSAPP_ACCESS_TOKEN     - Permanent System User access token
 *   WHATSAPP_VERIFY_TOKEN     - Webhook verification token (you choose this)
 *   WHATSAPP_WABA_ID          - WhatsApp Business Account ID
 */

import { v4 as uuid } from 'uuid';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v21.0';

export interface WhatsAppChannelConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

/**
 * Incoming webhook payload structure from Meta.
 */
export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<WhatsAppIncomingMessage>;
        statuses?: Array<unknown>;
      };
      field: string;
    }>;
  }>;
}

interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export class WhatsAppChannel extends MessengerChannel {
  readonly id: string;
  readonly name = 'whatsapp';

  private config: WhatsAppChannelConfig;

  constructor(id: string, config: WhatsAppChannelConfig) {
    super();
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // WhatsApp Cloud API is webhook-based; no persistent connection.
    this.connected = true;
    console.log('[WhatsAppChannel] Initialized (webhook mode)');
  }

  /**
   * Handle webhook verification (GET request from Meta).
   * Returns the challenge string if the verify token matches.
   */
  handleVerification(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Handle incoming webhook POST from Meta.
   */
  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const { messages, contacts } = change.value;
        if (!messages) continue;

        for (const msg of messages) {
          await this.processIncomingMessage(msg, contacts);
        }
      }
    }
  }

  private async processIncomingMessage(
    msg: WhatsAppIncomingMessage,
    contacts?: Array<{ profile: { name: string }; wa_id: string }>,
  ): Promise<void> {
    // Handle text messages
    if (msg.type === 'text' && msg.text?.body) {
      if (!this.messageHandler) return;

      const contactName = contacts?.find(c => c.wa_id === msg.from)?.profile?.name;

      const message: Message = {
        id: msg.id,
        role: 'user',
        content: msg.text.body,
        metadata: {
          platform: 'whatsapp',
          waId: msg.from,
          contactName,
          conversationId: `whatsapp:${msg.from}`,
        },
        createdAt: new Date(parseInt(msg.timestamp, 10) * 1000),
      };

      await this.messageHandler(message);
      return;
    }

    // Handle interactive replies (button taps, list selections)
    if (msg.type === 'interactive' && msg.interactive) {
      const reply = msg.interactive.button_reply ?? msg.interactive.list_reply;
      if (!reply) return;

      // Check if it's an interaction response (requestId pattern)
      let parsedId: Record<string, unknown> | undefined;
      try {
        parsedId = JSON.parse(reply.id);
      } catch {
        // Not JSON
      }

      if (parsedId?.requestId && this.interactionHandler) {
        await this.interactionHandler(
          parsedId.requestId as string,
          { ...parsedId, title: reply.title },
          `whatsapp:${msg.from}`,
        );
      } else if (this.actionHandler) {
        await this.actionHandler(reply.id, {
          title: reply.title,
          waId: msg.from,
          conversationId: `whatsapp:${msg.from}`,
        });
      }
      return;
    }

    // Handle image messages with caption as text
    if (msg.type === 'image' && msg.image?.caption) {
      if (!this.messageHandler) return;

      const message: Message = {
        id: msg.id,
        role: 'user',
        content: msg.image.caption,
        metadata: {
          platform: 'whatsapp',
          waId: msg.from,
          imageId: msg.image.id,
          conversationId: `whatsapp:${msg.from}`,
        },
        createdAt: new Date(parseInt(msg.timestamp, 10) * 1000),
      };

      await this.messageHandler(message);
    }
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    const { waId } = this.parseConversationId(options?.conversationId);
    if (!waId) {
      console.warn('[WhatsAppChannel] Cannot send: no waId in conversationId');
      return;
    }

    // Convert markdown to WhatsApp formatting
    const text = options?.markdown !== false ? this.convertMarkdownToWhatsApp(content) : content;

    // If buttons are provided, send as interactive message
    if (options?.buttons?.length) {
      await this.sendInteractiveMessage(waId, text, options.buttons);
      return;
    }

    // Plain text message
    await this.sendApiRequest({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'text',
      text: { body: text },
    });
  }

  private async sendInteractiveMessage(
    waId: string,
    bodyText: string,
    buttons: Array<{ id: string; label: string; action: string; data?: Record<string, unknown> }>,
  ): Promise<void> {
    // WhatsApp allows max 3 reply buttons
    const replyButtons = buttons.slice(0, 3).map(btn => ({
      type: 'reply' as const,
      reply: {
        id: JSON.stringify({ action: btn.action, requestId: btn.id, ...btn.data }),
        title: btn.label.substring(0, 20), // WhatsApp max 20 chars for button title
      },
    }));

    await this.sendApiRequest({
      messaging_product: 'whatsapp',
      to: waId,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText.substring(0, 1024) }, // Max 1024 chars for body
        action: { buttons: replyButtons },
      },
    });
  }

  private async sendApiRequest(body: Record<string, unknown>): Promise<void> {
    const url = `${WHATSAPP_API_BASE}/${this.config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[WhatsAppChannel] API error (${response.status}):`, errorBody);
      }
    } catch (error) {
      console.error('[WhatsAppChannel] Failed to send message:', error);
    }
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    const text = details ? `*Error:* ${error}\n\`\`\`${details}\`\`\`` : `*Error:* ${error}`;
    await this.send(text, { conversationId, markdown: false });
  }

  async endStream(streamId: string, options?: StreamEndOptions): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (stream && stream.content) {
      const convId = options?.conversationId ?? stream.conversationId;
      await this.send(stream.content, { markdown: true, conversationId: convId });
    }
    this.activeStreams.delete(streamId);
  }

  async close(): Promise<void> {
    this.connected = false;
    console.log('[WhatsAppChannel] Closed');
  }

  private parseConversationId(conversationId?: string): { waId?: string } {
    if (!conversationId) return {};
    if (conversationId.startsWith('whatsapp:')) {
      return { waId: conversationId.substring('whatsapp:'.length) };
    }
    return {};
  }

  /**
   * Convert standard Markdown to WhatsApp's formatting.
   * WhatsApp uses: *bold*, _italic_, ~strikethrough~, ```monospace```
   */
  private convertMarkdownToWhatsApp(text: string): string {
    return text
      // Convert bold: **text** -> *text*
      .replace(/\*\*(.*?)\*\*/g, '*$1*')
      // Headers -> bold text
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      // Strikethrough: ~~text~~ -> ~text~
      .replace(/~~(.*?)~~/g, '~$1~')
      // Links: [text](url) -> text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      // Remove images: ![alt](url) -> (image: alt)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '($1)');
  }
}
