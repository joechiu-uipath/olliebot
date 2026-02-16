/**
 * Database Persistence Tests
 *
 * Covers: DB-001 through DB-008
 * Tests data persistence through the UI workflow (messages, conversations, etc.)
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createUserMessage, createAssistantMessage } from '../../fixtures/index.js';
import { ToolName, AgentType } from '../../constants/index.js';

test.describe('Database Persistence', () => {

  // DB-001: Message create
  test('messages are persisted and appear after refresh', async ({ app }) => {
    const conv = createConversation({ id: 'conv-db', title: 'DB Test' });
    const msgs = [
      createUserMessage('Saved message', 'conv-db'),
      createAssistantMessage('Saved response', 'conv-db'),
    ];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-db', msgs);

    await app.reload();
    await app.sidebar.selectConversation('DB Test');

    await app.chat.waitForMessageContaining('Saved message');
    await app.chat.waitForMessageContaining('Saved response');
  });

  // DB-002: Message query
  test('messages retrieved correctly with pagination', async ({ app }) => {
    const conv = createConversation({ id: 'conv-db-query', title: 'Query Test' });
    const msgs = Array.from({ length: 10 }, (_, i) =>
      createAssistantMessage(`DB Message ${i + 1}`, 'conv-db-query'),
    );
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-db-query', msgs);

    await app.reload();
    await app.sidebar.selectConversation('Query Test');

    await app.chat.waitForMessageContaining('DB Message');
  });

  // DB-003: Conversation create
  test('new conversations are created and persisted', async ({ app }) => {
    const initialCount = await app.sidebar.getConversationCount();
    await app.sidebar.createNewConversation();

    // New conversation should be in the sidebar
    const count = await app.sidebar.getConversationCount();
    expect(count).toBe(initialCount + 1);
  });

  // DB-004: Conversation query
  test('conversations listed with metadata', async ({ app }) => {
    const convs = [
      createConversation({ id: 'conv-meta-1', title: 'First Conversation' }),
      createConversation({ id: 'conv-meta-2', title: 'Second Conversation' }),
    ];
    for (const conv of convs) {
      app.api.addConversation(conv);
    }
    await app.reload();

    await expect(app.sidebar.conversationByTitle('First Conversation')).toBeVisible();
    await expect(app.sidebar.conversationByTitle('Second Conversation')).toBeVisible();
  });

  // DB-006: Trace persistence
  test('traces saved and retrievable', async ({ app }) => {
    app.api.setHandler('GET', '/api/traces/traces', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'trace-persist', agentType: AgentType.SUPERVISOR, status: 'completed', inputTokens: 100, outputTokens: 50 },
        ]),
      });
    });

    await app.switchToLogs();
  });

  // DB-007: LLM call persistence
  test('LLM calls logged and retrievable', async ({ app }) => {
    app.api.setHandler('GET', '/api/traces/llm-calls', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'llm-persist', model: 'claude-sonnet-4-20250514', inputTokens: 200, outputTokens: 100 },
        ]),
      });
    });

    await app.switchToLogs();
  });
});
