/**
 * Discord channel implementation using discord.js.
 *
 * Uses the Gateway (WebSocket) connection for real-time message events.
 * Supports DMs and guild channel threads for session management.
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN  - Bot token from Developer Portal
 *   DISCORD_CLIENT_ID  - Application client ID
 */

import { v4 as uuid } from 'uuid';
import { MessengerChannel } from './messenger-base.js';
import type { Message, SendOptions, StreamEndOptions } from './types.js';

// Lazy-loaded discord.js types (optional dependency)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordClient = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordMessage = any;

export interface DiscordChannelConfig {
  botToken: string;
}

/** Discord message content limit */
const DISCORD_MAX_LENGTH = 2000;

export class DiscordChannel extends MessengerChannel {
  readonly id: string;
  readonly name = 'discord';

  private client: DiscordClient | null = null;
  private config: DiscordChannelConfig;

  constructor(id: string, config: DiscordChannelConfig) {
    super();
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // @ts-expect-error discord.js is an optional peer dependency
    const { Client, GatewayIntentBits, Partials } = await import('discord.js');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Channel, // Required for DM events
        Partials.Message,
      ],
    });

    this.client.on('ready', () => {
      console.log(`[DiscordChannel] Connected as ${this.client?.user?.tag}`);
      this.connected = true;
    });

    this.client.on('messageCreate', async (msg: DiscordMessage) => {
      if (!this.messageHandler) return;
      // Ignore bot's own messages
      if (msg.author.id === this.client?.user?.id) return;
      // Ignore other bots
      if (msg.author.bot) return;

      const isDM = !msg.guild;
      const isMentioned = msg.mentions.users.has(this.client?.user?.id ?? '');

      // In guilds, only respond to @mentions. In DMs, respond to everything.
      if (!isDM && !isMentioned) return;

      // Strip bot mention from guild messages
      let content = msg.content;
      if (isMentioned && this.client?.user) {
        content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
      }

      if (!content) return;

      const message: Message = {
        id: msg.id,
        role: 'user',
        content,
        metadata: {
          platform: 'discord',
          discordUserId: msg.author.id,
          discordChannelId: msg.channel.id,
          discordGuildId: msg.guild?.id,
          discordThreadId: msg.channel.isThread() ? msg.channel.id : undefined,
          isDM,
        },
        createdAt: msg.createdAt,
      };

      await this.messageHandler(message);
    });

    // Handle button/select interactions
    this.client.on('interactionCreate', async (interaction: any) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

      // Acknowledge the interaction
      await interaction.deferUpdate().catch(() => {});

      const customId = interaction.customId;

      // Try to parse as interaction response (requestId pattern)
      let parsedData: Record<string, unknown> | undefined;
      try {
        parsedData = JSON.parse(customId);
      } catch {
        // Not JSON, treat as action
      }

      if (parsedData?.requestId && this.interactionHandler) {
        await this.interactionHandler(
          parsedData.requestId as string,
          {
            ...parsedData,
            value: interaction.isStringSelectMenu() ? interaction.values[0] : undefined,
          },
          parsedData.conversationId as string | undefined,
        );
      } else if (this.actionHandler) {
        await this.actionHandler(customId, {
          discordUserId: interaction.user.id,
          discordChannelId: interaction.channel?.id,
          value: interaction.isStringSelectMenu() ? interaction.values[0] : undefined,
        });
      }
    });

    await this.client.login(this.config.botToken);
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    if (!this.client) return;

    const { channelId } = this.parseConversationId(options?.conversationId);
    if (!channelId) {
      console.warn('[DiscordChannel] Cannot send: no channelId in conversationId');
      return;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textChannel = channel as any;

      // Split long messages at Discord's 2000 char limit
      const chunks = this.splitMessage(content);

      for (const chunk of chunks) {
        await textChannel.send({ content: chunk });
      }
    } catch (error) {
      console.error('[DiscordChannel] Failed to send message:', error);
    }
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    const text = details
      ? `**Error:** ${error}\n\`\`\`\n${details}\n\`\`\``
      : `**Error:** ${error}`;
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
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    console.log('[DiscordChannel] Disconnected');
  }

  private parseConversationId(conversationId?: string): { channelId?: string } {
    if (!conversationId) return {};
    if (conversationId.startsWith('discord:')) {
      const parts = conversationId.split(':');
      return { channelId: parts[1] };
    }
    return {};
  }

  /**
   * Split a message into chunks that fit Discord's 2000 character limit.
   * Tries to split at newlines or spaces for readability.
   */
  private splitMessage(text: string): string[] {
    if (text.length <= DISCORD_MAX_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= DISCORD_MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point
      let splitIndex = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH);
      if (splitIndex < DISCORD_MAX_LENGTH / 2) {
        splitIndex = remaining.lastIndexOf(' ', DISCORD_MAX_LENGTH);
      }
      if (splitIndex < DISCORD_MAX_LENGTH / 2) {
        splitIndex = DISCORD_MAX_LENGTH;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trimStart();
    }

    return chunks;
  }
}
