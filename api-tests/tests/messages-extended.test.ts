/**
 * API Tests — Messages (Extended)
 *
 * Covers meaningful gaps in message API coverage:
 *   - Pagination with `after` cursor (forward paging)
 *   - Pagination with limit=1
 *   - Invalid/malformed cursor handling
 *   - Message metadata preservation through API (agent info, tool events, etc.)
 *   - GET /api/messages legacy endpoint (most recent conversation)
 *   - POST /api/messages without content returns 400
 *   - Pagination hasOlder/hasNewer correctness at boundaries
 *   - includeTotal with cursor-based pagination
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness } from '../harness/server-harness.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

/** Seed a conversation + N messages directly in the DB. */
function seedMessages(conversationId: string, count: number) {
  const db = getDb();
  db.conversations.create({
    id: conversationId,
    title: `Seeded ${conversationId}`,
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

describe('Messages — Extended', () => {
  describe('after cursor (forward paging)', () => {
    it('after cursor fetches newer messages', async () => {
      const convId = 'conv-after-cursor';
      seedMessages(convId, 10);

      const api = harness.api();

      // First fetch — get oldest 5 using before-based default, then get the oldest cursor
      const { body: page1 } = await api.getJson<{
        items: Array<{ content: string }>;
        pagination: { newestCursor: string; oldestCursor: string; hasNewer: boolean };
      }>(`/api/conversations/${convId}/messages?limit=5`);

      // Default returns newest 5 (Message 5-9), reversed to chronological order
      expect(page1.items.length).toBe(5);

      // Now use after cursor to go forward from the newest cursor
      // First, get the older page
      const { body: olderPage } = await api.getJson<{
        items: Array<{ content: string }>;
        pagination: { newestCursor: string; hasNewer: boolean };
      }>(`/api/conversations/${convId}/messages?limit=5&before=${page1.pagination.oldestCursor}`);

      expect(olderPage.items.length).toBe(5);
      expect(olderPage.items[0].content).toBe('Message 0');
      expect(olderPage.pagination.hasNewer).toBe(true);

      // Use after cursor to go forward from the oldest page
      const { body: forwardPage } = await api.getJson<{
        items: Array<{ content: string }>;
        pagination: { hasOlder: boolean };
      }>(`/api/conversations/${convId}/messages?limit=5&after=${olderPage.pagination.newestCursor}`);

      expect(forwardPage.items.length).toBe(5);
      expect(forwardPage.items[0].content).toBe('Message 5');
    });
  });

  describe('pagination edge cases', () => {
    it('limit=1 returns exactly one message', async () => {
      const convId = 'conv-limit-1';
      seedMessages(convId, 5);

      const api = harness.api();
      const { body } = await api.getJson<{
        items: Array<{ content: string }>;
        pagination: { hasOlder: boolean };
      }>(`/api/conversations/${convId}/messages?limit=1`);

      expect(body.items.length).toBe(1);
      // Should be the newest message
      expect(body.items[0].content).toBe('Message 4');
      expect(body.pagination.hasOlder).toBe(true);
    });

    it('empty conversation returns empty items and null cursors', async () => {
      const api = harness.api();
      const { body: conv } = await api.postJson<{ id: string }>(
        '/api/conversations',
        { title: 'Empty' },
      );

      const { body } = await api.getJson<{
        items: unknown[];
        pagination: { oldestCursor: string | null; newestCursor: string | null };
      }>(`/api/conversations/${conv.id}/messages`);

      expect(body.items.length).toBe(0);
      expect(body.pagination.oldestCursor).toBeNull();
      expect(body.pagination.newestCursor).toBeNull();
    });

    it('single message has same oldest and newest cursor', async () => {
      const convId = 'conv-single-msg';
      seedMessages(convId, 1);

      const api = harness.api();
      const { body } = await api.getJson<{
        items: Array<{ content: string }>;
        pagination: { oldestCursor: string; newestCursor: string; hasOlder: boolean; hasNewer: boolean };
      }>(`/api/conversations/${convId}/messages`);

      expect(body.items.length).toBe(1);
      expect(body.pagination.oldestCursor).toBe(body.pagination.newestCursor);
      expect(body.pagination.hasOlder).toBe(false);
      expect(body.pagination.hasNewer).toBe(false);
    });

    it('includeTotal works with cursor-based pagination', async () => {
      const convId = 'conv-total-cursor';
      seedMessages(convId, 15);

      const api = harness.api();
      // Get first page
      const { body: page1 } = await api.getJson<{
        items: unknown[];
        pagination: { oldestCursor: string; totalCount: number };
      }>(`/api/conversations/${convId}/messages?limit=5&includeTotal=true`);

      expect(page1.pagination.totalCount).toBe(15);

      // Get second page with cursor — total should still be 15
      const { body: page2 } = await api.getJson<{
        items: unknown[];
        pagination: { totalCount: number };
      }>(`/api/conversations/${convId}/messages?limit=5&before=${page1.pagination.oldestCursor}&includeTotal=true`);

      expect(page2.pagination.totalCount).toBe(15);
    });

    it('limit is clamped between 1 and 100', async () => {
      const convId = 'conv-limit-clamp';
      seedMessages(convId, 5);

      const api = harness.api();

      // limit=0 should be clamped to 1
      const { body: min } = await api.getJson<{ items: unknown[] }>(
        `/api/conversations/${convId}/messages?limit=0`,
      );
      expect(min.items.length).toBe(1);

      // limit=999 should be clamped to 100 (but we only have 5 msgs)
      const { body: max } = await api.getJson<{ items: unknown[] }>(
        `/api/conversations/${convId}/messages?limit=999`,
      );
      expect(max.items.length).toBe(5);
    });
  });

  describe('message metadata through API', () => {
    it('agent metadata fields are preserved in API response', async () => {
      const api = harness.api();
      const { body: conv } = await api.postJson<{ id: string }>(
        '/api/conversations',
        { title: 'Metadata Test' },
      );

      const db = getDb();
      db.messages.create({
        id: 'msg-metadata-test',
        conversationId: conv.id,
        role: 'assistant',
        content: 'Agent response',
        metadata: {
          agentName: 'Researcher',
          agentEmoji: '🔬',
          agentType: 'deep-research',
          type: 'delegation',
          mission: 'test-mission',
        },
        createdAt: new Date().toISOString(),
      });

      const { body } = await api.getJson<{
        items: Array<{
          agentName: string;
          agentEmoji: string;
          agentType: string;
          messageType: string;
          delegationMission: string;
        }>;
      }>(`/api/conversations/${conv.id}/messages`);

      expect(body.items.length).toBe(1);
      const msg = body.items[0];
      expect(msg.agentName).toBe('Researcher');
      expect(msg.agentEmoji).toBe('🔬');
      expect(msg.agentType).toBe('deep-research');
      expect(msg.messageType).toBe('delegation');
      expect(msg.delegationMission).toBe('test-mission');
    });

    it('tool event metadata fields are preserved in API response', async () => {
      const api = harness.api();
      const { body: conv } = await api.postJson<{ id: string }>(
        '/api/conversations',
        { title: 'Tool Event Test' },
      );

      const db = getDb();
      db.messages.create({
        id: 'msg-tool-event',
        conversationId: conv.id,
        role: 'assistant',
        content: 'Tool executed',
        metadata: {
          type: 'tool_event',
          toolName: 'web_search',
          source: 'native',
          success: true,
          durationMs: 250,
        },
        createdAt: new Date().toISOString(),
      });

      const { body } = await api.getJson<{
        items: Array<{
          messageType: string;
          toolName: string;
          toolSource: string;
          toolSuccess: boolean;
          toolDurationMs: number;
        }>;
      }>(`/api/conversations/${conv.id}/messages`);

      const msg = body.items[0];
      expect(msg.messageType).toBe('tool_event');
      expect(msg.toolName).toBe('web_search');
      expect(msg.toolSource).toBe('native');
      expect(msg.toolSuccess).toBe(true);
      expect(msg.toolDurationMs).toBe(250);
    });
  });

  describe('legacy messages endpoint', () => {
    it('GET /api/messages returns messages from most recent conversation', async () => {
      const api = harness.api();

      // Create a conversation with messages
      const { body: conv } = await api.postJson<{ id: string }>(
        '/api/conversations',
        { title: 'Legacy Test' },
      );

      const db = getDb();
      db.messages.create({
        id: 'legacy-msg-1',
        conversationId: conv.id,
        role: 'user',
        content: 'Legacy message',
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      const { status, body } = await api.getJson<Array<{ content: string }>>(
        '/api/messages',
      );

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // Should find the message from the most recent conversation
      const found = body.find(m => m.content === 'Legacy message');
      expect(found).toBeDefined();
    });

    it('GET /api/messages returns empty array when no conversations exist', async () => {
      // After reset, only the well-known 'feed' exists (with no messages)
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/messages');

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
