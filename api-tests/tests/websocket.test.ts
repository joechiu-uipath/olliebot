/**
 * API Tests — WebSocket Communication
 *
 * Covers:
 *   WS-001   Connect
 *   WS-002   Send message
 *   WS-003   Receive stream
 *   WS-004   Event types (stream_start, stream_chunk, stream_end)
 *   WS-006   Multiple clients receive broadcasts
 *   WS-009   Connected event on connection
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';
import { WsClient } from '../harness/ws-client.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('WebSocket Communication', () => {
  // WS-001 — Connection established
  it('client can connect to the WebSocket server', async () => {
    const ws = harness.ws();
    await ws.connect();

    // The server sends a 'connected' event on connection
    const event = await ws.waitForEvent('connected', 3000);
    expect(event.type).toBe('connected');

    await ws.close();
  });

  // WS-009 — Connected event
  it('server sends connected event with client info', async () => {
    const ws = harness.ws();
    await ws.connect();

    const event = await ws.waitForEvent('connected', 3000);
    expect(event.type).toBe('connected');
    // The connected event should include a clientId
    expect(event.clientId).toBeTruthy();

    await ws.close();
  });

  // WS-002 + WS-003 + WS-004 — Send message, receive stream events
  it('sending a message triggers streaming response', async () => {
    const api = harness.api();
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', 3000);

    // Create a conversation to send the message to
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'WS Stream Test' },
    );

    // Send a message via WebSocket
    ws.send({
      type: 'message',
      id: `msg-ws-${Date.now()}`,
      role: 'user',
      content: 'Hello via WebSocket',
      metadata: { conversationId: conv.id },
    });

    // The real supervisor streams back the LLM response
    const start = await ws.waitForEvent('stream_start', 15_000);
    expect(start.type).toBe('stream_start');

    const chunk = await ws.waitForEvent('stream_chunk', 15_000);
    expect(chunk.type).toBe('stream_chunk');
    // Real supervisor streams actual content from the LLM simulator
    expect(typeof chunk.chunk).toBe('string');
    expect((chunk.chunk as string).length).toBeGreaterThan(0);

    const end = await ws.waitForEvent('stream_end', 15_000);
    expect(end.type).toBe('stream_end');

    await ws.close();
  });

  // WS-006 — Multiple clients
  it('broadcasts reach all connected clients', async () => {
    const api = harness.api();
    const ws1 = harness.ws();
    const ws2 = harness.ws();

    await ws1.connect();
    await ws2.connect();
    await ws1.waitForEvent('connected', 3000);
    await ws2.waitForEvent('connected', 3000);

    // Create a conversation
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'Multi Client Test' },
    );

    // Send a message from ws1
    ws1.send({
      type: 'message',
      id: `msg-multi-${Date.now()}`,
      role: 'user',
      content: 'Broadcast test',
      metadata: { conversationId: conv.id },
    });

    // Both clients should receive the streaming events
    await ws1.waitForEvent('stream_start', 5000);
    await ws2.waitForEvent('stream_start', 5000);

    await ws1.close();
    await ws2.close();
  });

  // Edge: connect & disconnect cleanly
  it('handles client disconnect without errors', async () => {
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', 3000);
    await ws.close();

    // Server should still be healthy after client disconnects
    const api = harness.api();
    const { status } = await api.getJson('/health');
    expect(status).toBe(200);
  });
});
