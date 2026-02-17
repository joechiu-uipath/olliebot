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
import { ServerHarness } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('WebSocket Communication', () => {
  // ---------------------------------------------------------------------------
  // Core connection & streaming
  // ---------------------------------------------------------------------------

  // WS-001 — Connection established
  it('client can connect to the WebSocket server', async () => {
    const ws = harness.ws();
    await ws.connect();

    // The server sends a 'connected' event on connection
    const event = await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
    expect(event.type).toBe('connected');

    await ws.close();
  });

  // WS-009 — Connected event
  it('server sends connected event with client info', async () => {
    const ws = harness.ws();
    await ws.connect();

    const event = await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
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
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

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
    const start = await ws.waitForEvent('stream_start', TIMEOUTS.LLM_STREAM);
    expect(start.type).toBe('stream_start');

    const chunk = await ws.waitForEvent('stream_chunk', TIMEOUTS.LLM_STREAM);
    expect(chunk.type).toBe('stream_chunk');
    // Real supervisor streams actual content from the LLM simulator
    expect(typeof chunk.chunk).toBe('string');
    expect((chunk.chunk as string).length).toBeGreaterThan(0);

    const end = await ws.waitForEvent('stream_end', TIMEOUTS.LLM_STREAM);
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
    await ws1.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
    await ws2.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

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
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
    await ws.close();

    // Server should still be healthy after client disconnects
    const api = harness.api();
    const { status } = await api.getJson('/health');
    expect(status).toBe(HTTP_STATUS.OK);
  });

  // ---------------------------------------------------------------------------
  // Stream resume
  // ---------------------------------------------------------------------------

  it('get-active-stream returns active:false when no stream is running', async () => {
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    // Ask for active stream on a conversation with no activity
    ws.send({
      type: 'get-active-stream',
      conversationId: 'no-such-conversation',
    });

    const resume = await ws.waitForEvent('stream_resume', 3000);
    expect(resume.type).toBe('stream_resume');
    expect(resume.active).toBe(false);
    expect(resume.conversationId).toBe('no-such-conversation');

    await ws.close();
  });

  it('stream events include conversationId for routing', async () => {
    const api = harness.api();
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    // Create a conversation
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'Stream Routing Test' },
    );

    // Send message with conversationId
    ws.send({
      type: 'message',
      content: 'Hello with routing',
      conversationId: conv.id,
    });

    // The stub supervisor includes conversationId in stream events
    const start = await ws.waitForEvent('stream_start', 5000);
    expect(start.conversationId).toBe(conv.id);

    const end = await ws.waitForEvent('stream_end', 5000);
    expect(end.conversationId).toBe(conv.id);

    await ws.close();
  });

  // ---------------------------------------------------------------------------
  // Client lifecycle
  // ---------------------------------------------------------------------------

  it('client count increments on connect and decrements on disconnect', async () => {
    const api = harness.api();

    // Initially 0
    const { body: before } = await api.getJson<{ count: number }>('/api/clients');
    expect(before.count).toBe(0);

    // Connect two clients
    const ws1 = harness.ws();
    const ws2 = harness.ws();
    await ws1.connect();
    await ws2.connect();
    await ws1.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
    await ws2.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    const { body: during } = await api.getJson<{ count: number }>('/api/clients');
    expect(during.count).toBe(2);

    // Disconnect one
    await ws1.close();

    // Allow the server a moment to process the disconnect
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.BRIEF));

    const { body: after } = await api.getJson<{ count: number }>('/api/clients');
    expect(after.count).toBe(1);

    await ws2.close();
  });

  it('each client receives its own unique clientId', async () => {
    const ws1 = harness.ws();
    const ws2 = harness.ws();
    await ws1.connect();
    await ws2.connect();

    const event1 = await ws1.waitForEvent('connected', TIMEOUTS.WS_CONNECT);
    const event2 = await ws2.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    expect(event1.clientId).toBeTruthy();
    expect(event2.clientId).toBeTruthy();
    expect(event1.clientId).not.toBe(event2.clientId);

    await ws1.close();
    await ws2.close();
  });

  // ---------------------------------------------------------------------------
  // Message handling edge cases
  // ---------------------------------------------------------------------------

  it('message without content is ignored (no crash)', async () => {
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    // Send message with no content — should be silently ignored
    ws.send({ type: 'message' });

    // Server should still be healthy
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SHORT));
    const api = harness.api();
    const { status } = await api.getJson('/health');
    expect(status).toBe(HTTP_STATUS.OK);

    await ws.close();
  });

  it('unknown message type is silently ignored', async () => {
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', TIMEOUTS.WS_CONNECT);

    // Send unknown message type
    ws.send({ type: 'totally-unknown-type', data: 'test' });

    // Server should still be healthy
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SHORT));
    const api = harness.api();
    const { status } = await api.getJson('/health');
    expect(status).toBe(HTTP_STATUS.OK);

    await ws.close();
  });
});
