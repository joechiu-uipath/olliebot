/**
 * Azure Bot Service channel using M365 Agents SDK.
 *
 * Handles Teams, Facebook Messenger, and LINE through a single Azure Bot Service
 * endpoint. Azure Bot Service normalizes messages from all platforms into the
 * Bot Framework Activity schema.
 *
 * Requires a public HTTPS endpoint for Azure Bot Service to POST activities to.
 *
 * Env vars:
 *   AZURE_BOT_APP_ID       - Entra ID application ID
 *   AZURE_BOT_APP_PASSWORD - Entra ID application secret
 *   AZURE_BOT_TENANT_ID    - Azure tenant ID
 */

import { v4 as uuid } from 'uuid';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

/**
 * Activity object from Azure Bot Service (simplified).
 * The full schema is defined by the Bot Framework protocol.
 */
export interface BotActivity {
  type: string;
  id?: string;
  timestamp?: string;
  serviceUrl: string;
  channelId: string; // 'msteams', 'facebook', 'line', etc.
  from: { id: string; name?: string };
  conversation: { id: string; tenantId?: string };
  recipient: { id: string; name?: string };
  text?: string;
  value?: unknown; // Adaptive Card Action.Submit payloads
  entities?: Array<{ type: string; mentioned?: { id: string; name?: string } }>;
  attachments?: Array<{ contentType: string; content: unknown }>;
  channelData?: Record<string, unknown>;
}

/**
 * Conversation reference for proactive messaging.
 */
interface ConversationReference {
  serviceUrl: string;
  channelId: string;
  conversationId: string;
  userId: string;
  botId: string;
  tenantId?: string;
}

export interface AzureBotChannelConfig {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

export class AzureBotChannel extends MessengerChannel {
  readonly id: string;
  readonly name = 'azure-bot';

  private config: AzureBotChannelConfig;
  /** Store conversation references for sending replies */
  private conversationRefs: Map<string, ConversationReference> = new Map();
  /** Cache for OAuth tokens */
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(id: string, config: AzureBotChannelConfig) {
    super();
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // Azure Bot Channel is initialized when the webhook route is registered.
    // No persistent connection needed -- Azure Bot Service pushes to us.
    this.connected = true;
    console.log('[AzureBotChannel] Initialized (webhook mode)');
  }

  /**
   * Handle incoming webhook POST from Azure Bot Service.
   * This should be called from the Hono route handler.
   */
  async handleWebhook(activity: BotActivity, authHeader?: string): Promise<BotActivity | null> {
    // TODO: Validate JWT Bearer token from Azure Bot Service in production
    // For now, trust the activity (development mode)

    // Store conversation reference for replies
    const convRef: ConversationReference = {
      serviceUrl: activity.serviceUrl,
      channelId: activity.channelId,
      conversationId: activity.conversation.id,
      userId: activity.from.id,
      botId: activity.recipient.id,
      tenantId: activity.conversation.tenantId,
    };
    this.conversationRefs.set(activity.conversation.id, convRef);

    if (activity.type === 'message' && activity.text) {
      return this.handleMessage(activity);
    }

    if (activity.type === 'invoke' || (activity.type === 'message' && activity.value)) {
      return this.handleAction(activity);
    }

    // Return empty response for other activity types (conversationUpdate, etc.)
    return null;
  }

  private async handleMessage(activity: BotActivity): Promise<null> {
    if (!this.messageHandler) return null;

    let text = activity.text ?? '';

    // Strip @mentions for Teams channel messages
    if (activity.channelId === 'msteams' && activity.entities) {
      for (const entity of activity.entities) {
        if (entity.type === 'mention' && entity.mentioned?.name) {
          text = text.replace(new RegExp(`<at>${entity.mentioned.name}</at>`, 'gi'), '').trim();
        }
      }
    }

    if (!text) return null;

    const olliebotConvId = `azure-bot:${activity.channelId}:${activity.conversation.id}`;

    const message: Message = {
      id: activity.id ?? uuid(),
      role: 'user',
      content: text,
      metadata: {
        platform: activity.channelId, // 'msteams', 'facebook', 'line'
        azureConversationId: activity.conversation.id,
        azureServiceUrl: activity.serviceUrl,
        userId: activity.from.id,
        userName: activity.from.name,
        tenantId: activity.conversation.tenantId,
        conversationId: olliebotConvId,
      },
      createdAt: activity.timestamp ? new Date(activity.timestamp) : new Date(),
    };

    await this.messageHandler(message);
    return null;
  }

  private async handleAction(activity: BotActivity): Promise<BotActivity | null> {
    const value = activity.value as Record<string, unknown> | undefined;
    if (!value) return null;

    // Check for interaction response pattern (requestId)
    if (value.requestId && this.interactionHandler) {
      const convId = `azure-bot:${activity.channelId}:${activity.conversation.id}`;
      await this.interactionHandler(
        value.requestId as string,
        value,
        convId,
      );
    } else if (this.actionHandler) {
      const actionName = (value.action as string) ?? activity.type;
      await this.actionHandler(actionName, {
        ...value,
        userId: activity.from.id,
        channelId: activity.channelId,
        conversationId: activity.conversation.id,
      });
    }

    // For invoke activities, return a 200 response
    if (activity.type === 'invoke') {
      return { type: 'invokeResponse', status: 200 } as unknown as BotActivity;
    }

    return null;
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    const { azureChannelId, azureConversationId } = this.parseConversationId(options?.conversationId);
    const convRef = azureConversationId ? this.conversationRefs.get(azureConversationId) : undefined;

    if (!convRef) {
      console.warn('[AzureBotChannel] Cannot send: no conversation reference for', options?.conversationId);
      return;
    }

    const activity: Record<string, unknown> = {
      type: 'message',
      text: content,
      textFormat: 'markdown',
    };

    // Add buttons as Adaptive Card for Teams, or as suggested actions for other channels
    if (options?.buttons?.length) {
      if (convRef.channelId === 'msteams') {
        // Use Adaptive Card for Teams
        activity.attachments = [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [{ type: 'TextBlock', text: content, wrap: true }],
            actions: options.buttons.map(btn => ({
              type: 'Action.Submit',
              title: btn.label,
              data: { action: btn.action, requestId: btn.id, ...btn.data },
            })),
          },
        }];
        // Don't duplicate text in card + message
        activity.text = '';
      } else {
        // Hero card for FB Messenger, LINE, etc.
        activity.attachments = [{
          contentType: 'application/vnd.microsoft.card.hero',
          content: {
            text: content,
            buttons: options.buttons.map(btn => ({
              type: 'imBack',
              title: btn.label,
              value: btn.action,
            })),
          },
        }];
        activity.text = '';
      }
    }

    try {
      const token = await this.getAccessToken();
      const url = `${convRef.serviceUrl}v3/conversations/${convRef.conversationId}/activities`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(activity),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[AzureBotChannel] Send failed (${response.status}):`, body);
      }
    } catch (error) {
      console.error('[AzureBotChannel] Failed to send message:', error);
    }
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    const text = details ? `**Error:** ${error}\n\`\`\`\n${details}\n\`\`\`` : `**Error:** ${error}`;
    await this.send(text, { conversationId });
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
    this.conversationRefs.clear();
    this.accessToken = null;
    this.connected = false;
    console.log('[AzureBotChannel] Closed');
  }

  private parseConversationId(conversationId?: string): {
    azureChannelId?: string;
    azureConversationId?: string;
  } {
    if (!conversationId) return {};
    if (conversationId.startsWith('azure-bot:')) {
      const parts = conversationId.split(':');
      // azure-bot:{channelId}:{conversationId}
      return {
        azureChannelId: parts[1],
        azureConversationId: parts.slice(2).join(':'),
      };
    }
    return {};
  }

  /**
   * Get an OAuth access token for the Bot Connector API.
   * Caches the token until near expiry.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const tokenUrl = this.config.tenantId
      ? `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`
      : 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.appId,
      client_secret: this.config.appPassword,
      scope: 'https://api.botframework.com/.default',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }
}
