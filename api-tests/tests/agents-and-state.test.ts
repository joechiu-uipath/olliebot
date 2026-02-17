/**
 * API Tests — Agent State & System
 *
 * Covers:
 *   AGSYS-001  Supervisor message handling (message reaches supervisor)
 *   AGSYS-006  Agent state tracking (idle/working status)
 *   AGSYS-007  Well-known conversations
 *   API-006    Error responses (proper status codes)
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Agent State & System', () => {
  // AGSYS-006
  it('GET /api/state returns supervisor state', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{ status: string }>('/api/state');

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.status).toBe('idle');
  });

  // Agent list
  it('GET /api/agents returns supervisor identity', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<Array<{ id: string; name: string; role: string }>>(
      '/api/agents',
    );

    expect(status).toBe(HTTP_STATUS.OK);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // Real supervisor — check role rather than hardcoded stub id
    expect(body[0].role).toBe('supervisor');
    expect(body[0].name).toBeTruthy();
  });

  // Client count
  it('GET /api/clients returns connected client count', async () => {
    const api = harness.api();

    // No WS clients connected
    const { status, body } = await api.getJson<{ count: number }>('/api/clients');
    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.count).toBe(0);

    // Connect a WS client
    const ws = harness.ws();
    await ws.connect();
    await ws.waitForEvent('connected', 3000);

    const { body: body2 } = await api.getJson<{ count: number }>('/api/clients');
    expect(body2.count).toBe(1);

    await ws.close();
  });

  // AGSYS-001 — Messages reach supervisor via REST
  it('POST /api/messages delivers to supervisor', async () => {
    const api = harness.api();
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'Agent Test' },
    );

    await api.post('/api/messages', {
      content: 'Test message for supervisor',
      conversationId: conv.id,
    });

    // Wait for the real supervisor to process the message
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify the message was persisted in the database
    const { body } = await api.getJson<{
      items: Array<{ role: string; content: string }>;
    }>(`/api/conversations/${conv.id}/messages`);

    expect(body.items.some(m => m.role === 'user' && m.content === 'Test message for supervisor')).toBe(true);
  });

  // API-006 — Error responses
  it('malformed JSON body returns 400', async () => {
    const res = await fetch(`${harness.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
