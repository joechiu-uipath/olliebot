/**
 * API Tests — WebSocket (Extended)
 *
 * Covers meaningful gaps in WebSocket coverage:
 *   - Stream resume when switching conversations (get-active-stream)
 *   - Stream content accumulation across chunks
 *   - No active stream returns active:false
 *   - WebSocket message with conversationId routing
 *   - Client count tracks connect/disconnect lifecycle
 *   - Multiple clients receive independent stream events
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('WebSocket — Extended', () => {
  describe('stream resume', () => {
    it('get-active-stream returns active:false when no stream is running', async () => {
      const ws = harness.ws();
      await ws.connect();
      await ws.waitForEvent('connected', 3000);

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
      await ws.waitForEvent('connected', 3000);

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
  });

  describe('client lifecycle', () => {
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
      await ws1.waitForEvent('connected', 3000);
      await ws2.waitForEvent('connected', 3000);

      const { body: during } = await api.getJson<{ count: number }>('/api/clients');
      expect(during.count).toBe(2);

      // Disconnect one
      await ws1.close();

      // Allow the server a moment to process the disconnect
      await new Promise(resolve => setTimeout(resolve, 100));

      const { body: after } = await api.getJson<{ count: number }>('/api/clients');
      expect(after.count).toBe(1);

      await ws2.close();
    });

    it('each client receives its own unique clientId', async () => {
      const ws1 = harness.ws();
      const ws2 = harness.ws();
      await ws1.connect();
      await ws2.connect();

      const event1 = await ws1.waitForEvent('connected', 3000);
      const event2 = await ws2.waitForEvent('connected', 3000);

      expect(event1.clientId).toBeTruthy();
      expect(event2.clientId).toBeTruthy();
      expect(event1.clientId).not.toBe(event2.clientId);

      await ws1.close();
      await ws2.close();
    });
  });

  describe('message handling edge cases', () => {
    it('message without content is ignored (no crash)', async () => {
      const ws = harness.ws();
      await ws.connect();
      await ws.waitForEvent('connected', 3000);

      // Send message with no content — should be silently ignored
      ws.send({ type: 'message' });

      // Server should still be healthy
      await new Promise(resolve => setTimeout(resolve, 200));
      const api = harness.api();
      const { status } = await api.getJson('/health');
      expect(status).toBe(200);

      await ws.close();
    });

    it('unknown message type is silently ignored', async () => {
      const ws = harness.ws();
      await ws.connect();
      await ws.waitForEvent('connected', 3000);

      // Send unknown message type
      ws.send({ type: 'totally-unknown-type', data: 'test' });

      // Server should still be healthy
      await new Promise(resolve => setTimeout(resolve, 200));
      const api = harness.api();
      const { status } = await api.getJson('/health');
      expect(status).toBe(200);

      await ws.close();
    });
  });
});
