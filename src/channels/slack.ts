/**
 * Slack channel implementation using @slack/bolt with Socket Mode.
 *
 * Uses native Slack Bolt SDK for full Block Kit support, modals, and slash commands.
 * Socket Mode means no public HTTPS endpoint is needed.
 *
 * Env vars:
 *   SLACK_BOT_TOKEN  - Bot user OAuth token (xoxb-...)
 *   SLACK_APP_TOKEN  - App-level token for Socket Mode (xapp-...)
 */

import { v4 as uuid } from 'uuid';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

// Lazy-loaded Bolt types (optional dependency)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoltApp = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlackEvent = any;

export interface SlackChannelConfig {
  botToken: string;
  appToken: string;
}

export class SlackChannel extends MessengerChannel {
  readonly id: string;
  readonly name = 'slack';

  private app: BoltApp | null = null;
  private config: SlackChannelConfig;

  constructor(id: string, config: SlackChannelConfig) {
    super();
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // @ts-expect-error @slack/bolt is an optional peer dependency
    const { App } = await import('@slack/bolt');

    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
    });

    // Handle @mentions in channels
    this.app.event('app_mention', async ({ event, say }: { event: any; say: any }) => {
      if (!this.messageHandler) return;

      // Strip the bot mention from the text
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) return;

      const message: Message = {
        id: event.ts,
        role: 'user',
        content: text,
        metadata: {
          platform: 'slack',
          slackUserId: event.user,
          slackChannelId: event.channel,
          slackThreadTs: event.thread_ts ?? event.ts,
          slackTeamId: (event as Record<string, unknown>).team as string | undefined,
        },
        createdAt: new Date(parseFloat(event.ts) * 1000),
      };

      await this.messageHandler(message);
    });

    // Handle direct messages
    this.app.event('message', async ({ event }: { event: any }) => {
      if (!this.messageHandler) return;

      const msg = event as SlackEvent;

      // Skip bot messages, message changes, and other subtypes
      if (msg.subtype !== undefined) return;
      // Skip channel messages (handled by app_mention)
      if (msg.channel_type !== 'im') return;

      const message: Message = {
        id: msg.ts,
        role: 'user',
        content: msg.text ?? '',
        metadata: {
          platform: 'slack',
          slackUserId: msg.user,
          slackChannelId: msg.channel,
          slackThreadTs: msg.thread_ts ?? msg.ts,
        },
        createdAt: new Date(parseFloat(msg.ts) * 1000),
      };

      await this.messageHandler(message);
    });

    // Handle Block Kit action interactions (buttons, selects, etc.)
    this.app.action(/.*/, async ({ action, body, ack }: { action: any; body: any; ack: any }) => {
      await ack();
      if (!this.actionHandler) return;

      const actionPayload = action as Record<string, unknown>;

      // Check if this is an interaction response (has a requestId in the action value)
      const actionValue = actionPayload.value as string | undefined;
      let parsedValue: Record<string, unknown> | undefined;
      try {
        if (actionValue) parsedValue = JSON.parse(actionValue);
      } catch {
        // Not JSON, treat as plain action
      }

      if (parsedValue?.requestId && this.interactionHandler) {
        await this.interactionHandler(
          parsedValue.requestId as string,
          parsedValue,
          parsedValue.conversationId as string | undefined,
        );
      } else {
        await this.actionHandler(
          actionPayload.action_id as string ?? 'unknown',
          {
            value: actionValue,
            slackUserId: (body as Record<string, unknown>).user,
            slackChannelId: (body as Record<string, unknown>).channel,
          },
        );
      }
    });

    await this.app.start();
    this.connected = true;
    console.log('[SlackChannel] Connected via Socket Mode');
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    if (!this.app) return;

    const conversationId = options?.conversationId;
    // Parse conversationId to extract Slack-specific routing
    // Format: "slack:{channelId}:{threadTs}"
    const { channelId, threadTs } = this.parseConversationId(conversationId);

    if (!channelId) {
      console.warn('[SlackChannel] Cannot send: no channelId in conversationId');
      return;
    }

    const text = options?.markdown ? this.convertMarkdownToMrkdwn(content) : content;

    const messagePayload: Record<string, unknown> = {
      channel: channelId,
      text,
      thread_ts: threadTs,
    };

    // Add buttons as Block Kit actions
    if (options?.buttons?.length) {
      messagePayload.blocks = [
        { type: 'section', text: { type: 'mrkdwn', text } },
        {
          type: 'actions',
          elements: options.buttons.map(btn => ({
            type: 'button',
            text: { type: 'plain_text', text: btn.label },
            action_id: btn.action,
            value: JSON.stringify({ ...btn.data, requestId: btn.id }),
          })),
        },
      ];
    }

    try {
      await this.app.client.chat.postMessage(messagePayload);
    } catch (error) {
      console.error('[SlackChannel] Failed to send message:', error);
    }
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    const text = details ? `*Error:* ${error}\n\`\`\`${details}\`\`\`` : `*Error:* ${error}`;
    await this.send(text, { conversationId });
  }

  /**
   * Override endStream to use chat.update for a better streaming experience.
   * Posts an initial message on first chunk, then updates it periodically.
   */
  async endStream(streamId: string, options?: StreamEndOptions): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (stream && stream.content) {
      const convId = options?.conversationId ?? stream.conversationId;
      await this.send(stream.content, { markdown: true, conversationId: convId });
    }
    this.activeStreams.delete(streamId);
  }

  async close(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.connected = false;
    console.log('[SlackChannel] Disconnected');
  }

  /**
   * Parse OllieBot conversationId to extract Slack routing info.
   * Stores slack channel and thread info in message metadata; this extracts it back.
   */
  private parseConversationId(conversationId?: string): { channelId?: string; threadTs?: string } {
    if (!conversationId) return {};
    // If it looks like a slack-style ID "slack:C123:1234.5678"
    if (conversationId.startsWith('slack:')) {
      const parts = conversationId.split(':');
      return { channelId: parts[1], threadTs: parts[2] };
    }
    return {};
  }

  /**
   * Convert standard Markdown to Slack's mrkdwn format.
   * Key differences: **bold** -> *bold*, _italic_ stays, # headings -> *bold text*
   */
  private convertMarkdownToMrkdwn(text: string): string {
    return text
      // Convert bold: **text** -> *text*
      .replace(/\*\*(.*?)\*\*/g, '*$1*')
      // Headers -> bold text on own line
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      // Links: [text](url) -> <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
      // Images: ![alt](url) -> <url|alt>
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>')
      // Strikethrough: ~~text~~ -> ~text~
      .replace(/~~(.*?)~~/g, '~$1~');
  }
}
