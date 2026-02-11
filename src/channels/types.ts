// Communication channel abstraction types

export interface MessageAttachment {
  name: string;
  type: string;
  size: number;
  data: string; // base64 encoded
}

export interface Message {
  id: string;
  channel: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Agent metadata for message attribution
 */
export interface AgentMetadata {
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
}

/**
 * Options for starting a stream
 */
export interface StreamStartOptions {
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentType?: string;
  conversationId?: string;
}

/**
 * Options for ending a stream
 */
export interface StreamEndOptions {
  conversationId?: string;
  citations?: { sources: unknown[]; references: unknown[] };
}

export interface SendOptions {
  markdown?: boolean;
  html?: boolean;
  buttons?: ActionButton[];
  agent?: AgentMetadata;
}

export interface ActionButton {
  id: string;
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface ChannelEvent {
  type: 'message' | 'action' | 'typing' | 'presence';
  channelId: string;
  data: unknown;
}

/**
 * Channel is communication channel, example: web, console, 3rd party chat apps like Microsoft Teams, Slack, etc.
 */
export interface Channel {
  readonly id: string;
  readonly name: string;

  // Initialize the channel
  init(): Promise<void>;

  // Send a message to the user
  send(content: string, options?: SendOptions): Promise<void>;

  // Send an error message to the user
  sendError(error: string, details?: string): Promise<void>;

  // Streaming support (required)
  startStream(streamId: string, options?: StreamStartOptions): void;
  sendStreamChunk(streamId: string, chunk: string, conversationId?: string): void;
  endStream(streamId: string, options?: StreamEndOptions): void;

  // Register message handler
  onMessage(handler: (message: Message) => Promise<void>): void;

  // Register action handler (for buttons, etc.)
  onAction(handler: (action: string, data: unknown) => Promise<void>): void;

  // Check if channel is connected/active
  isConnected(): boolean;

  // Close the channel
  close(): Promise<void>;

  // Optional handlers for specific channel features
  onNewConversation?(handler: () => void): void;
  onInteraction?(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void;

  // Broadcast data to all connected clients (no-op for non-networked channels)
  broadcast(data: unknown): void;
}

export interface ChannelFactory {
  create(config: ChannelConfig): Channel;
}

export interface ChannelConfig {
  type: 'web' | 'console';
  id: string;
  options?: Record<string, unknown>;
}
