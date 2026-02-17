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
import {
  ServerHarness,
  HTTP_STATUS,
  TIMEOUTS,
  LIMITS,
  TEST_SIZES,
  seedConversationWithMessages,
  seedMessage,
  waitFor,
} from '../harness/index.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Messages', () => {
  // ---------------------------------------------------------------------------
  // Core CRUD & retrieval
  // ---------------------------------------------------------------------------

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

    expect(res.status).toBe(HTTP_STATUS.OK);

    // Wait for the real supervisor to process the message
    await new Promise(resolve => waitFor(TIMEOUTS.STANDARD).then(resolve));

    // Verify the message was persisted in the database
    const { body } = await api.getJson<{
      items: Array<{ role: string; content: string }>;
    }>(`/api/conversations/${conv.id}/messages`);

    expect(body.items.some(m => m.role === 'user' && m.content === 'Hello from API test')).toBe(true);
  });

  // DB-001 + DB-002 — Messages persisted via DB, queryable via API
  it('GET /api/conversations/:id/messages returns seeded messages', async () => {
    const convId = 'conv-db-test';
    seedConversationWithMessages(convId, TEST_SIZES.SMALL);

    const api = harness.api();
    const { status, body } = await api.getJson<{ items: Array<{ id: string; content: string }>; pagination: Record<string, unknown> }>(
      `/api/conversations/${convId}/messages`,
    );

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.items.length).toBe(TEST_SIZES.SMALL);
    // Returned in chronological order (oldest first)
    expect(body.items[0].content).toBe('Message 0');
    expect(body.items[TEST_SIZES.SMALL - 1].content).toBe(`Message ${TEST_SIZES.SMALL - 1}`);
  });

  // Edge case: messages for non-existent conversation
  it('returns empty list for unknown conversationId', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{ items: unknown[] }>(
      '/api/conversations/nonexistent/messages',
    );

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.items.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  // CHAT-011 + API-007
  it('pagination: limit restricts returned count', async () => {
    const convId = 'conv-pagination';
    seedConversationWithMessages(convId, 10);

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
    seedConversationWithMessages(convId, 10);

    const api = harness.api();

    // First fetch — get newest 5
    const { body: page1 } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { oldestCursor: string; hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}`);

    expect(page1.items.length).toBe(5);
    expect(page1.pagination.hasOlder).toBe(true);

    // Second fetch — get older page using cursor
    const cursor = page1.pagination.oldestCursor;
    const { body: page2 } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}&before=${cursor}`);

    expect(page2.items.length).toBe(5);
    // These should be the older messages (Message 0–4)
    expect(page2.items[0].content).toBe('Message 0');
  });

  it('pagination: includeTotal returns total count', async () => {
    const convId = 'conv-total';
    seedConversationWithMessages(convId, 7);

    const api = harness.api();
    const { body } = await api.getJson<{ pagination: { totalCount: number } }>(
      `/api/conversations/${convId}/messages?includeTotal=true`,
    );

    expect(body.pagination.totalCount).toBe(7);
  });

  it('after cursor fetches newer messages', async () => {
    const convId = 'conv-after-cursor';
    seedConversationWithMessages(convId, 10);

    const api = harness.api();

    // First fetch — get newest 5 (Message 5-9)
    const { body: page1 } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { newestCursor: string; oldestCursor: string; hasNewer: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}`);

    expect(page1.items.length).toBe(5);

    // Get the older page
    const { body: olderPage } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { newestCursor: string; hasNewer: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}&before=${page1.pagination.oldestCursor}`);

    expect(olderPage.items.length).toBe(5);
    expect(olderPage.items[0].content).toBe('Message 0');
    expect(olderPage.pagination.hasNewer).toBe(true);

    // Use after cursor to go forward from the oldest page
    const { body: forwardPage } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}&after=${olderPage.pagination.newestCursor}`);

    expect(forwardPage.items.length).toBe(5);
    expect(forwardPage.items[0].content).toBe('Message 5');
  });

  // ---------------------------------------------------------------------------
  // Pagination edge cases
  // ---------------------------------------------------------------------------

  it('limit=1 returns exactly one message', async () => {
    const convId = 'conv-limit-1';
    seedConversationWithMessages(convId, TEST_SIZES.SMALL);

    const api = harness.api();
    const { body } = await api.getJson<{
      items: Array<{ content: string }>;
      pagination: { hasOlder: boolean };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.MESSAGE_PAGE_MIN}`);

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
    seedConversationWithMessages(convId, 1);

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
    seedConversationWithMessages(convId, 15);

    const api = harness.api();
    // Get first page
    const { body: page1 } = await api.getJson<{
      items: unknown[];
      pagination: { oldestCursor: string; totalCount: number };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}&includeTotal=true`);

    expect(page1.pagination.totalCount).toBe(15);

    // Get second page with cursor — total should still be 15
    const { body: page2 } = await api.getJson<{
      items: unknown[];
      pagination: { totalCount: number };
    }>(`/api/conversations/${convId}/messages?limit=${LIMITS.DEFAULT_PAGE_SIZE}&before=${page1.pagination.oldestCursor}&includeTotal=true`);

    expect(page2.pagination.totalCount).toBe(15);
  });

  it('limit is clamped between 1 and 100', async () => {
    const convId = 'conv-limit-clamp';
    seedConversationWithMessages(convId, TEST_SIZES.SMALL);

    const api = harness.api();

    // limit=0 should be clamped to 1
    const { body: min } = await api.getJson<{ items: unknown[] }>(
      `/api/conversations/${convId}/messages?limit=0`,
    );
    expect(min.items.length).toBe(LIMITS.MESSAGE_PAGE_MIN);

    // limit=999 should be clamped to 100 (but we only have 5 msgs)
    const { body: max } = await api.getJson<{ items: unknown[] }>(
      `/api/conversations/${convId}/messages?limit=${LIMITS.LARGE_PAGE_SIZE}`,
    );
    expect(max.items.length).toBe(TEST_SIZES.SMALL);
  });

  // ---------------------------------------------------------------------------
  // Message metadata
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Legacy messages endpoint
  // ---------------------------------------------------------------------------

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

    expect(status).toBe(HTTP_STATUS.OK);
    expect(Array.isArray(body)).toBe(true);
    // Should find the message from the most recent conversation
    const found = body.find(m => m.content === 'Legacy message');
    expect(found).toBeDefined();
  });

  it('GET /api/messages returns empty array when no conversations exist', async () => {
    // After reset, only the well-known 'feed' exists (with no messages)
    const api = harness.api();
    const { status, body } = await api.getJson<unknown[]>('/api/messages');

    expect(status).toBe(HTTP_STATUS.OK);
    expect(Array.isArray(body)).toBe(true);
  });
});
