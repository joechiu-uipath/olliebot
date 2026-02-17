/**
 * API Tests — Messages & Persistence
 *
 * Covers:
 *   CHAT-001   Send simple message (via REST)
 *   CHAT-011   Message history pagination
 *   DB-001     Message create
 *   DB-002     Message query
 *   API-007    Pagination
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

/** Seed a conversation + N messages directly in the DB for pagination tests. */
function seedMessages(conversationId: string, count: number) {
  const db = getDb();
  db.conversations.create({
    id: conversationId,
    title: 'Paginated',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  });

  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.now() + i * 1000).toISOString();
    db.messages.create({
      id: `msg-${conversationId}-${i}`,
      conversationId,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      metadata: {},
      createdAt: ts,
    });
  }
}

describe('Messages', () => {
  // CHAT-001 — Send a message via REST
  it('POST /api/messages sends a message to supervisor', async () => {
    const api = harness.api();

    // Create a conversation first
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'Msg Test' },
    );

    const res = await api.post('/api/messages', {
      content: 'Hello from API test',
      conversationId: conv.id,
    });

    expect(res.status).toBe(200);

    // Wait for the real supervisor to process the message
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify the message was persisted in the database
    const { body } = await api.getJson<{
      items: Array<{ role: string; content: string }>;
    }>(`/api/conversations/${conv.id}/messages`);

    expect(body.items.some(m => m.role === 'user' && m.content === 'Hello from API test')).toBe(true);
  });

  // DB-001 + DB-002 — Messages persisted via DB, queryable via API
  it('GET /api/conversations/:id/messages returns seeded messages', async () => {
    const convId = 'conv-db-test';
    seedMessages(convId, 5);

    const api = harness.api();
    const { status, body } = await api.getJson<{ items: Array<{ id: string; content: string }>; pagination: Record<string, unknown> }>(
      `/api/conversations/${convId}/messages`,
    );

    expect(status).toBe(200);
    expect(body.items.length).toBe(5);
    // Returned in chronological order (oldest first)
    expect(body.items[0].content).toBe('Message 0');
    expect(body.items[4].content).toBe('Message 4');
  });

  // CHAT-011 + API-007 — Pagination
  it('pagination: limit restricts returned count', async () => {
    const convId = 'conv-pagination';
    seedMessages(convId, 10);

    const api = harness.api();
    const { body } = await api.getJson<{ items: unknown[]; pagination: { hasOlder: boolean; hasNewer: boolean } }>(
      `/api/conversations/${convId}/messages?limit=3`,
    );

    // Default fetch returns the most recent 3, reversed to chronological order
    expect(body.items.length).toBe(3);
    expect(body.pagination.hasOlder).toBe(true);
    expect(body.pagination.hasNewer).toBe(false);
  });

  it('pagination: before cursor fetches older messages', async () => {
    const convId = 'conv-cursor';
    seedMessages(convId, 10);

    const api = harness.api();

    // First fetch — get newest 5
    const { body: page1 } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { oldestCursor: string; hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=5`);

    expect(page1.items.length).toBe(5);
    expect(page1.pagination.hasOlder).toBe(true);

    // Second fetch — get older page using cursor
    const cursor = page1.pagination.oldestCursor;
    const { body: page2 } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=5&before=${cursor}`);

    expect(page2.items.length).toBe(5);
    // These should be the older messages (Message 0–4)
    expect(page2.items[0].content).toBe('Message 0');
  });

  it('pagination: includeTotal returns total count', async () => {
    const convId = 'conv-total';
    seedMessages(convId, 7);

    const api = harness.api();
    const { body } = await api.getJson<{ pagination: { totalCount: number } }>(
      `/api/conversations/${convId}/messages?includeTotal=true`,
    );

    expect(body.pagination.totalCount).toBe(7);
  });

  // Edge case: messages for non-existent conversation
  it('returns empty list for unknown conversationId', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{ items: unknown[] }>(
      '/api/conversations/nonexistent/messages',
    );

    expect(status).toBe(200);
    expect(body.items.length).toBe(0);
  });
});
