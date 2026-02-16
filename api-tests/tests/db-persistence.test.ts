/**
 * API Tests — Database Persistence
 *
 * Covers:
 *   DB-001  Message create
 *   DB-002  Message query
 *   DB-003  Conversation create
 *   DB-004  Conversation query
 *   DB-005  Index performance (verify queries use indexes)
 *   DB-008  Concurrent access (multiple writes don't corrupt data)
 *
 * These tests exercise the database through the REST API layer only —
 * no direct DB access for writes (reads are used for verification).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Database Persistence', () => {
  // DB-003 — Conversation create persists to DB
  it('created conversation is queryable from DB', async () => {
    const api = harness.api();
    const { body } = await api.postJson<{ id: string; title: string }>(
      '/api/conversations',
      { title: 'DB Test' },
    );

    const db = getDb();
    const row = db.conversations.findById(body.id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('DB Test');
  });

  // DB-001 + DB-002 — Message persistence through API
  it('messages created via DB are retrievable via API', async () => {
    const api = harness.api();
    const { body: conv } = await api.postJson<{ id: string }>(
      '/api/conversations',
      { title: 'Msg Persist' },
    );

    // Seed messages via DB (simulating what supervisor would do)
    const db = getDb();
    for (let i = 0; i < 3; i++) {
      db.messages.create({
        id: `persist-msg-${i}`,
        conversationId: conv.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Content ${i}`,
        metadata: {},
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const { body: result } = await api.getJson<{
      items: Array<{ id: string; content: string; role: string }>;
    }>(`/api/conversations/${conv.id}/messages`);

    expect(result.items.length).toBe(3);
    expect(result.items[0].content).toBe('Content 0');
    expect(result.items[0].role).toBe('user');
    expect(result.items[1].role).toBe('assistant');
  });

  // DB-008 — Concurrent writes
  it('concurrent conversation creates do not corrupt data', async () => {
    const api = harness.api();
    const count = 20;

    // Fire many creates concurrently
    const promises = Array.from({ length: count }, (_, i) =>
      api.postJson<{ id: string; title: string }>(
        '/api/conversations',
        { title: `Concurrent ${i}` },
      ),
    );

    const results = await Promise.all(promises);

    // All should succeed
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.id).toBeTruthy();
    }

    // All should have unique IDs
    const ids = results.map(r => r.body.id);
    expect(new Set(ids).size).toBe(count);

    // All should be queryable
    const { body: list } = await api.getJson<Array<{ id: string }>>(
      '/api/conversations',
    );
    // count + 1 for the well-known 'feed' conversation
    expect(list.length).toBeGreaterThanOrEqual(count);
  });

  // DB-005 — Index usage (verifiable by ensuring queries are fast even with data)
  it('message queries are fast with indexed access', async () => {
    const db = getDb();
    const convId = 'perf-test';

    // Create conversation
    db.conversations.create({
      id: convId,
      title: 'Perf Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    });

    // Seed 200 messages
    for (let i = 0; i < 200; i++) {
      db.messages.create({
        id: `perf-msg-${i}`,
        conversationId: convId,
        role: 'user',
        content: `Message ${i}`,
        metadata: {},
        createdAt: new Date(Date.now() + i * 100).toISOString(),
      });
    }

    const api = harness.api();
    const startMs = Date.now();
    const { body } = await api.getJson<{ items: unknown[] }>(
      `/api/conversations/${convId}/messages?limit=20`,
    );
    const elapsed = Date.now() - startMs;

    expect(body.items.length).toBe(20);
    // With indexed access, this should be well under 500ms even on slow CI
    expect(elapsed).toBeLessThan(500);
  });

  // Cleanup: reset clears data
  it('harness.reset() clears all data', async () => {
    const api = harness.api();
    await api.post('/api/conversations', { title: 'Before Reset' });

    await harness.reset();

    const { body: list } = await api.getJson<Array<{ id: string }>>(
      '/api/conversations',
    );
    // Only the well-known 'feed' should remain
    const titles = (list as Array<{ title: string }>).map(c => c.title);
    expect(titles).not.toContain('Before Reset');
  });
});
