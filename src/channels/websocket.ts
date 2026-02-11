import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import type {
  Channel,
  Message,
  SendOptions,
  ActionButton,
  StreamStartOptions,
  StreamEndOptions,
} from './types.js';

interface WebSocketClient {
  ws: WebSocket;
  id: string;
  connectedAt: Date;
}

/**
 * Tracks an active stream for a conversation.
 * Used to resume streaming display when user switches back to a conversation.
 */
interface ActiveStream {
  streamId: string;
  conversationId: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentType?: string;
  accumulatedContent: string;
  startTime: Date;
}

export class WebSocketChannel implements Channel {
  readonly id: string;
  readonly name = 'web';

  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private messageHandler: ((message: Message) => Promise<void>) | null = null;
  private actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  private interactionHandler: ((requestId: string, response: unknown, conversationId?: string) => Promise<void>) | null = null;
  private connected = false;

  /**
   * Tracks active streams by conversationId.
   * Allows frontend to resume streaming display when switching back to a conversation.
   */
  private activeStreams: Map<string, ActiveStream> = new Map();

  constructor(id: string = 'web-default') {
    this.id = id;
  }

  async init(): Promise<void> {
    // WebSocket server will be attached to HTTP server externally
    this.connected = true;
  }

  attachToServer(wss: WebSocketServer): void {
    this.wss = wss;

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuid();
      const client: WebSocketClient = {
        ws,
        id: clientId,
        connectedAt: new Date(),
      };
      this.clients.set(clientId, client);

      ws.on('message', async (data: Buffer) => {
        try {
          const parsed = JSON.parse(data.toString());
          await this.handleClientMessage(clientId, parsed);
        } catch (error) {
          console.error('[WebSocketChannel] Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error(`[WebSocketChannel] Client error (${clientId}):`, error);
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private newConversationHandler: (() => void) | null = null;
  private browserActionHandler: ((action: string, sessionId: string) => Promise<void>) | null = null;
  private desktopActionHandler: ((action: string, sessionId: string) => Promise<void>) | null = null;

  private async handleClientMessage(clientId: string, data: unknown): Promise<void> {
    const msg = data as {
      type: string;
      content?: string;
      action?: string;
      data?: unknown;
      conversationId?: string;
      requestId?: string;
      sessionId?: string;
      attachments?: Array<{ name: string; type: string; size: number; data: string }>;
      reasoningEffort?: 'medium' | 'high' | 'xhigh';
      messageType?: string; // e.g., 'deep_research'
      messageId?: string; // Client-provided ID for deduplication
      agentCommand?: { command: string; icon: string }; // e.g., { command: 'Deep Research', icon: '🔬' }
    };

    if (msg.type === 'message' && (msg.content || msg.attachments?.length) && this.messageHandler) {
      const message: Message = {
        // Use client-provided messageId if available (for deduplication), otherwise generate one
        id: msg.messageId || uuid(),
        role: 'user',
        content: msg.content || '',
        attachments: msg.attachments,
        metadata: {
          clientId,
          conversationId: msg.conversationId,
          // Store as vendor-neutral 'reasoningMode' in DB (mapped from client's reasoningEffort)
          reasoningMode: msg.reasoningEffort,
          // Message type for special handling (e.g., 'deep_research')
          messageType: msg.messageType,
          // Agent command for triggering specific agent workflows
          agentCommand: msg.agentCommand,
        },
        createdAt: new Date(),
      };
      await this.messageHandler(message);
    } else if (msg.type === 'action' && msg.action && this.actionHandler) {
      // Include conversationId in the data passed to the action handler
      await this.actionHandler(msg.action, { ...msg.data as object, conversationId: msg.conversationId });
    } else if (msg.type === 'interaction-response' && this.interactionHandler) {
      await this.interactionHandler(msg.requestId!, msg.data, msg.conversationId);
    } else if (msg.type === 'new-conversation' && this.newConversationHandler) {
      this.newConversationHandler();
    } else if (msg.type === 'browser-action' && msg.action && msg.sessionId && this.browserActionHandler) {
      await this.browserActionHandler(msg.action, msg.sessionId);
    } else if (msg.type === 'desktop-action' && msg.action && msg.sessionId && this.desktopActionHandler) {
      await this.desktopActionHandler(msg.action, msg.sessionId);
    } else if (msg.type === 'get-active-stream' && msg.conversationId) {
      // Frontend is switching to a conversation and wants to resume any active stream
      this.sendActiveStreamState(clientId, msg.conversationId);
    }
  }

  onNewConversation(handler: () => void): void {
    this.newConversationHandler = handler;
  }

  /**
   * Send active stream state to a client when they switch to a conversation.
   * Allows frontend to resume displaying an in-progress stream.
   */
  private sendActiveStreamState(clientId: string, conversationId: string): void {
    const activeStream = this.activeStreams.get(conversationId);

    if (activeStream) {
      // Send stream_resume event with accumulated content
      this.sendToClient(clientId, {
        type: 'stream_resume',
        streamId: activeStream.streamId,
        conversationId: activeStream.conversationId,
        agentId: activeStream.agentId,
        agentName: activeStream.agentName,
        agentEmoji: activeStream.agentEmoji,
        agentType: activeStream.agentType,
        accumulatedContent: activeStream.accumulatedContent,
        startTime: activeStream.startTime.toISOString(),
        timestamp: new Date().toISOString(),
      });
    } else {
      // No active stream for this conversation
      this.sendToClient(clientId, {
        type: 'stream_resume',
        conversationId,
        active: false,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(data));
      } catch (error) {
        // Socket may have been closed between readyState check and send
        console.warn(`[WebSocketChannel] Failed to send to client ${clientId}:`, (error as Error).message);
        this.clients.delete(clientId);
      }
    }
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    // Warn if no conversationId - message won't be routed correctly on frontend
    if (!options?.conversationId) {
      console.warn('[WebSocketChannel] send() called without conversationId - message will only appear in Feed');
    }

    const payload: {
      type: string;
      id: string;
      content: string;
      markdown: boolean;
      html: boolean;
      buttons?: ActionButton[];
      agentId?: string;
      agentName?: string;
      agentEmoji?: string;
      conversationId?: string;
      timestamp: string;
    } = {
      type: 'message',
      id: uuid(),
      content,
      markdown: options?.markdown ?? true,
      html: options?.html ?? false,
      conversationId: options?.conversationId,
      timestamp: new Date().toISOString(),
    };

    if (options?.buttons) {
      payload.buttons = options.buttons;
    }

    // Add agent metadata if provided
    if (options?.agent) {
      payload.agentId = options.agent.agentId;
      payload.agentName = options.agent.agentName;
      payload.agentEmoji = options.agent.agentEmoji;
    }

    // Broadcast to all connected clients
    this.broadcast(payload);
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    // Warn if no conversationId - error won't be routed correctly on frontend
    if (!conversationId) {
      console.warn('[WebSocketChannel] sendError() called without conversationId - error will only appear in Feed');
    }

    const payload: {
      type: string;
      id: string;
      error: string;
      details?: string;
      conversationId?: string;
      timestamp: string;
    } = {
      type: 'error',
      id: uuid(),
      error,
      details,
      conversationId,
      timestamp: new Date().toISOString(),
    };

    // Broadcast error to all connected clients
    this.broadcast(payload);
  }

  // Streaming support
  startStream(streamId: string, options?: StreamStartOptions): void {
    const payload = {
      type: 'stream_start',
      id: streamId,
      ...options,
      timestamp: new Date().toISOString(),
    };
    this.broadcast(payload);

    // Track active stream for conversation switching
    if (options?.conversationId) {
      this.activeStreams.set(options.conversationId, {
        streamId,
        conversationId: options.conversationId,
        agentId: options.agentId,
        agentName: options.agentName,
        agentEmoji: options.agentEmoji,
        agentType: options.agentType,
        accumulatedContent: '',
        startTime: new Date(),
      });
    }
  }

  sendStreamChunk(streamId: string, chunk: string, conversationId?: string): void {
    const payload = {
      type: 'stream_chunk',
      streamId,
      chunk,
      conversationId,
    };
    this.broadcast(payload);

    // Accumulate content for stream resumption
    if (conversationId) {
      const activeStream = this.activeStreams.get(conversationId);
      if (activeStream && activeStream.streamId === streamId) {
        activeStream.accumulatedContent += chunk;
      }
    }
  }

  endStream(streamId: string, options?: StreamEndOptions): void {
    const payload: {
      type: string;
      streamId: string;
      conversationId?: string;
      citations?: { sources: unknown[]; references: unknown[] };
      timestamp: string;
    } = {
      type: 'stream_end',
      streamId,
      conversationId: options?.conversationId,
      timestamp: new Date().toISOString(),
    };

    // Include citations if provided
    if (options?.citations && options.citations.sources.length > 0) {
      payload.citations = options.citations;
    }

    this.broadcast(payload);

    // Remove stream tracking (stream is complete)
    if (options?.conversationId) {
      this.activeStreams.delete(options.conversationId);
    }
  }

  /**
   * Broadcast data to all connected clients
   */
  broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    const closedClients: string[] = [];
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          // Socket may have been closed between readyState check and send
          console.warn(`[WebSocketChannel] Failed to broadcast to client ${client.id}:`, (error as Error).message);
          closedClients.push(client.id);
        }
      }
    }
    // Clean up closed clients
    for (const clientId of closedClients) {
      this.clients.delete(clientId);
    }
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  onInteraction(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void {
    this.interactionHandler = handler;
  }

  onBrowserAction(handler: (action: string, sessionId: string) => Promise<void>): void {
    this.browserActionHandler = handler;
  }

  onDesktopAction(handler: (action: string, sessionId: string) => Promise<void>): void {
    this.desktopActionHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.activeStreams.clear();
    this.connected = false;
  }

  /**
   * Get active stream info for a conversation (if any).
   * Used for testing and debugging.
   */
  getActiveStream(conversationId: string): ActiveStream | undefined {
    return this.activeStreams.get(conversationId);
  }

  /**
   * Check if a conversation has an active stream.
   */
  hasActiveStream(conversationId: string): boolean {
    return this.activeStreams.has(conversationId);
  }
}
