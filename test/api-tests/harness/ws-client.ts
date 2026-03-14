/**
 * WebSocket Test Client
 *
 * Thin wrapper around the `ws` library for sending messages and
 * collecting server events. Provides helpers for waiting on specific
 * event types with a timeout.
 */

import WebSocket from 'ws';

export interface WsEvent {
  type: string;
  [key: string]: unknown;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private _events: WsEvent[] = [];
  private _listeners: Array<(event: WsEvent) => void> = [];

  constructor(private url: string) {}

  /** All events received so far. */
  get events(): WsEvent[] { return this._events; }

  /** Connect to the server WebSocket. Resolves once the connection is open. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('message', (raw) => {
        try {
          const event = JSON.parse(raw.toString()) as WsEvent;
          this._events.push(event);
          for (const listener of this._listeners) {
            listener(event);
          }
        } catch {
          // non-JSON messages are silently ignored
        }
      });
    });
  }

  /** Send a JSON message to the server. */
  send(data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  /**
   * Wait for an event of the given `type`.
   * Checks already-received events first, then listens for new ones.
   *
   * @param type   Event type string to match (e.g. 'connected', 'stream_start')
   * @param timeoutMs  Max milliseconds to wait (default 5 000)
   */
  waitForEvent(type: string, timeoutMs = 5_000): Promise<WsEvent> {
    // Check existing events
    const existing = this._events.find(e => e.type === type);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for WS event "${type}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (event: WsEvent) => {
        if (event.type === type) {
          cleanup();
          resolve(event);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) this._listeners.splice(idx, 1);
      };

      this._listeners.push(listener);
    });
  }

  /**
   * Wait for N events of the given type.
   */
  async waitForEvents(type: string, count: number, timeoutMs = 5_000): Promise<WsEvent[]> {
    const results: WsEvent[] = [];

    // Collect already-received events
    for (const e of this._events) {
      if (e.type === type) results.push(e);
      if (results.length >= count) return results.slice(0, count);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${count} WS events "${type}" (got ${results.length}) after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (event: WsEvent) => {
        if (event.type === type) {
          results.push(event);
          if (results.length >= count) {
            cleanup();
            resolve(results.slice(0, count));
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) this._listeners.splice(idx, 1);
      };

      this._listeners.push(listener);
    });
  }

  /** Filter received events by type. */
  eventsOfType(type: string): WsEvent[] {
    return this._events.filter(e => e.type === type);
  }

  /** Clear the events buffer. */
  clearEvents(): void {
    this._events.length = 0;
  }

  /** Disconnect from the server. */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws) { resolve(); return; }
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.on('close', () => resolve());
      this.ws.close();
    });
  }
}
