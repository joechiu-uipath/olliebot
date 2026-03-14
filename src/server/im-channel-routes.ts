/**
 * Webhook routes for external instant messenger channels.
 *
 * Registers routes under /api/im-channels/<messenger>/webhook for:
 * - Azure Bot Service (Teams, FB Messenger, LINE)
 * - WhatsApp (Cloud API)
 * - SMS (Twilio)
 *
 * Slack and Discord use outbound connections (Socket Mode / Gateway)
 * and don't need webhook routes.
 */

import type { Hono } from 'hono';
import type { AzureBotChannel } from '../channels/azure-bot.js';
import type { WhatsAppChannel } from '../channels/whatsapp.js';
import type { SMSChannel } from '../channels/sms.js';
import type { TwilioWebhookPayload } from '../channels/sms.js';
import type { BotActivity } from '../channels/azure-bot.js';
import type { WhatsAppWebhookPayload } from '../channels/whatsapp.js';

export interface IMChannelRouteOptions {
  azureBotChannel?: AzureBotChannel;
  whatsappChannel?: WhatsAppChannel;
  smsChannel?: SMSChannel;
}

export function setupIMChannelRoutes(app: Hono, options: IMChannelRouteOptions): void {
  const { azureBotChannel, whatsappChannel, smsChannel } = options;

  // --- Azure Bot Service (Teams + FB Messenger + LINE) ---
  if (azureBotChannel) {
    app.post('/api/im-channels/azure-bot/webhook', async (c) => {
      try {
        const activity = await c.req.json<BotActivity>();
        console.log(`[IMRoutes] Azure Bot incoming: type=${activity.type}, channelId=${activity.channelId}, from=${activity.from?.name ?? activity.from?.id}, text=${activity.text?.substring(0, 80) ?? '(none)'}`);
        const authHeader = c.req.header('Authorization');
        const response = await azureBotChannel.handleWebhook(activity, authHeader);

        if (response) {
          return c.json(response);
        }
        return c.json({}, 200);
      } catch (error) {
        console.error('[IMRoutes] Azure Bot webhook error:', error);
        return c.json({ error: 'Internal server error' }, 500);
      }
    });

    console.log('[IMRoutes] Azure Bot webhook registered at /api/im-channels/azure-bot/webhook');
  }

  // --- WhatsApp Cloud API ---
  if (whatsappChannel) {
    // Webhook verification (GET)
    app.get('/api/im-channels/whatsapp/webhook', (c) => {
      const mode = c.req.query('hub.mode') ?? '';
      const token = c.req.query('hub.verify_token') ?? '';
      const challenge = c.req.query('hub.challenge') ?? '';

      const result = whatsappChannel.handleVerification(mode, token, challenge);
      if (result) {
        return c.text(result, 200);
      }
      return c.text('Forbidden', 403);
    });

    // Webhook events (POST)
    app.post('/api/im-channels/whatsapp/webhook', async (c) => {
      try {
        const payload = await c.req.json<WhatsAppWebhookPayload>();

        // Process asynchronously -- Meta requires 200 response within 5 seconds
        whatsappChannel.handleWebhook(payload).catch(error => {
          console.error('[IMRoutes] WhatsApp webhook processing error:', error);
        });

        return c.json({}, 200);
      } catch (error) {
        console.error('[IMRoutes] WhatsApp webhook parse error:', error);
        return c.json({ error: 'Bad request' }, 400);
      }
    });

    console.log('[IMRoutes] WhatsApp webhook registered at /api/im-channels/whatsapp/webhook');
  }

  // --- SMS (Twilio) ---
  if (smsChannel) {
    app.post('/api/im-channels/sms/webhook', async (c) => {
      try {
        // Twilio sends URL-encoded form data
        const formData = await c.req.parseBody();
        const payload = formData as unknown as TwilioWebhookPayload;

        const twiml = await smsChannel.handleWebhook(payload);

        return c.text(twiml, 200, {
          'Content-Type': 'application/xml',
        });
      } catch (error) {
        console.error('[IMRoutes] SMS webhook error:', error);
        return c.text(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
          500,
          { 'Content-Type': 'application/xml' },
        );
      }
    });

    console.log('[IMRoutes] SMS webhook registered at /api/im-channels/sms/webhook');
  }
}
