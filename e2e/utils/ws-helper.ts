/**
 * WebSocket test helper for Playwright.
 *
 * Provides utilities for mocking WebSocket connections and simulating
 * server-push events (streaming, tool events, delegation, etc.)
 */

import type { Page } from '@playwright/test';

/** All OllieBot WebSocket event types */
export type WsEventType =
  | 'connected'
  | 'message'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'stream_resume'
  | 'error'
  | 'tool_requested'
  | 'tool_execution_finished'
  | 'tool_progress'
  | 'tool_resume'
  | 'play_audio'
  | 'delegation'
  | 'task_run'
  | 'conversation_created'
  | 'conversation_updated'
  | 'task_updated'
  | 'browser_session_created'
  | 'browser_session_closed'
  | 'browser_screenshot'
  | 'desktop_session_created'
  | 'desktop_session_closed'
  | 'desktop_screenshot'
  | 'rag_indexing_started'
  | 'rag_indexing_progress'
  | 'rag_indexing_completed'
  | 'rag_indexing_error'
  | 'rag_projects_changed'
  | 'deep_research_plan'
  | 'deep_research_step'
  | 'deep_research_source'
  | 'deep_research_draft'
  | 'deep_research_review'
  | 'deep_research_completed'
  | 'eval_progress'
  | 'eval_completed'
  | 'eval_error'
  | 'log_trace'
  | 'log_llm_call';

export interface WsEvent {
  type: WsEventType;
  [key: string]: unknown;
}

/**
 * WebSocket mock that captures client messages and allows sending server events.
 */
export class WebSocketMock {
  private serverSend: ((data: string) => void) | null = null;
  private receivedMessages: WsEvent[] = [];
  private onMessageCallbacks: Array<(msg: WsEvent) => void> = [];

  /**
   * Install the WebSocket mock on a Playwright page.
   * Call before navigating to the page.
   */
  async install(page: Page): Promise<void> {
    await page.routeWebSocket(/localhost:3000\/?$/, (ws) => {
      this.serverSend = (data: string) => ws.send(data);

      ws.onMessage((rawMsg) => {
        const data = JSON.parse(rawMsg.toString()) as WsEvent;
        this.receivedMessages.push(data);
        for (const cb of this.onMessageCallbacks) {
          cb(data);
        }
      });

      // Send initial connected event
      ws.send(JSON.stringify({
        type: 'connected',
        clientId: 'e2e-test-client',
      }));
    });
  }

  /**
   * Send a server event to the client.
   */
  send(event: WsEvent): void {
    if (!this.serverSend) throw new Error('WebSocket mock not installed');
    this.serverSend(JSON.stringify(event));
  }

  /**
   * Simulate a complete assistant response (stream_start -> chunks -> stream_end).
   */
  simulateResponse(opts: {
    conversationId: string;
    content: string;
    streamId?: string;
    agentName?: string;
    agentEmoji?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }): void {
    const streamId = opts.streamId || `stream-${Date.now()}`;

    this.send({
      type: 'stream_start',
      conversationId: opts.conversationId,
      id: streamId, // Frontend uses 'id' to create message
      agentName: opts.agentName,
      agentEmoji: opts.agentEmoji,
    });

    // Send content in word-sized chunks for realistic streaming
    const words = opts.content.split(' ');
    for (const word of words) {
      this.send({
        type: 'stream_chunk',
        conversationId: opts.conversationId,
        streamId, // Frontend matches on 'streamId'
        chunk: word + ' ', // Frontend uses 'chunk' not 'content'
      });
    }

    this.send({
      type: 'stream_end',
      conversationId: opts.conversationId,
      streamId, // Frontend matches on 'streamId'
      usage: opts.usage || { inputTokens: 50, outputTokens: 25 },
    });
  }

  /**
   * Simulate a tool execution event sequence.
   */
  simulateToolExecution(opts: {
    conversationId: string;
    turnId: string;
    requestId: string;
    toolName: string;
    toolSource?: string;
    parameters?: Record<string, unknown>;
    result?: string;
    success?: boolean;
    durationMs?: number;
  }): void {
    this.send({
      type: 'tool_requested',
      conversationId: opts.conversationId,
      turnId: opts.turnId,
      requestId: opts.requestId,
      toolName: opts.toolName,
      source: opts.toolSource || 'native',
      parameters: opts.parameters || {},
    });

    this.send({
      type: 'tool_execution_finished',
      conversationId: opts.conversationId,
      turnId: opts.turnId,
      requestId: opts.requestId,
      toolName: opts.toolName,
      source: opts.toolSource || 'native',
      success: opts.success ?? true,
      result: opts.result || 'Tool executed successfully',
      durationMs: opts.durationMs || 150,
    });
  }

  /**
   * Simulate a delegation event.
   */
  simulateDelegation(opts: {
    conversationId: string;
    agentId: string;
    agentType: string;
    agentName: string;
    agentEmoji: string;
    mission?: string;
    rationale?: string;
  }): void {
    this.send({
      type: 'delegation',
      conversationId: opts.conversationId,
      agentId: opts.agentId,
      agentType: opts.agentType,
      agentName: opts.agentName,
      agentEmoji: opts.agentEmoji,
      mission: opts.mission || 'Research task',
      rationale: opts.rationale || 'Delegating to specialist for research',
    });
  }

  /**
   * Simulate an error event.
   */
  simulateError(opts: {
    conversationId: string;
    error: string;
    messageId?: string;
  }): void {
    this.send({
      type: 'error',
      conversationId: opts.conversationId,
      error: opts.error,
      messageId: opts.messageId || `err-${Date.now()}`,
    });
  }

  /**
   * Get all messages received from the client.
   */
  getReceivedMessages(): WsEvent[] {
    return [...this.receivedMessages];
  }

  /**
   * Wait for a client message matching a predicate.
   */
  waitForMessage(predicate: (msg: WsEvent) => boolean, timeoutMs = 5000): Promise<WsEvent> {
    return new Promise((resolve, reject) => {
      // Check already received messages
      const existing = this.receivedMessages.find(predicate);
      if (existing) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs);

      const cb = (msg: WsEvent) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.onMessageCallbacks = this.onMessageCallbacks.filter(c => c !== cb);
          resolve(msg);
        }
      };
      this.onMessageCallbacks.push(cb);
    });
  }

  /**
   * Clear received messages.
   */
  clearMessages(): void {
    this.receivedMessages = [];
  }
}
