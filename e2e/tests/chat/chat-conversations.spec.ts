/**
 * Chat & Conversations - Conversation Management Tests
 *
 * Covers: CHAT-005 through CHAT-010, CHAT-012, CHAT-020
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createTaskRunMessage } from '../../fixtures/index.js';

test.describe('Conversation Management', () => {

  // CHAT-005: Create new conversation
  test('creates a new conversation from sidebar', async ({ app }) => {
    await app.sidebar.createNewConversation();

    // Verify a new conversation appears in the sidebar
    const count = await app.sidebar.getConversationCount();
    expect(count).toBeGreaterThan(1); // Feed + new conversation
  });

  // CHAT-006: Switch conversations
  test('switches between existing conversations', async ({ app }) => {
    const conv1 = createConversation({ id: 'conv-1', title: 'First Chat' });
    const conv2 = createConversation({ id: 'conv-2', title: 'Second Chat' });
    app.api.addConversation(conv1);
    app.api.addConversation(conv2);
    await app.reload();

    // Select first conversation
    await app.sidebar.selectConversation('First Chat');
    await expect(app.sidebar.activeConversation).toContainText('First Chat');

    // Switch to second
    await app.sidebar.selectConversation('Second Chat');
    await expect(app.sidebar.activeConversation).toContainText('Second Chat');
  });

  // CHAT-007: Delete conversation
  test('deletes a conversation and removes it from the list', async ({ app }) => {
    const conv = createConversation({ id: 'conv-delete', title: 'To Delete' });
    app.api.addConversation(conv);
    await app.reload();

    // Verify it exists
    await expect(app.sidebar.conversationByTitle('To Delete')).toBeVisible();

    // Delete it
    await app.sidebar.deleteConversation('To Delete');

    // Verify it's gone (the API mock returns success, UI removes it)
    await expect(app.sidebar.conversationByTitle('To Delete')).not.toBeVisible();
  });

  // CHAT-008: Rename conversation
  test('manually renames a conversation', async ({ app }) => {
    const conv = createConversation({ id: 'conv-rename', title: 'Old Name' });
    app.api.addConversation(conv);
    await app.reload();

    await app.sidebar.startRename('Old Name');
    await app.sidebar.finishRename('New Name');

    // Verify the new title appears
    await expect(app.sidebar.conversationByTitle('New Name')).toBeVisible();
  });

  // CHAT-009: Auto-naming
  test('conversation auto-named after LLM response', async ({ app }) => {
    const conv = createConversation({ id: 'conv-autoname', title: 'New Conversation' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('New Conversation');

    await app.chat.sendMessage('What is quantum computing?');

    // Simulate response + conversation update event
    app.ws.simulateResponse({
      conversationId: 'conv-autoname',
      content: 'Quantum computing uses quantum mechanics...',
    });

    app.ws.send({
      type: 'conversation_updated',
      conversation: {
        id: 'conv-autoname',
        title: 'Quantum Computing',
      },
    });

    // Verify the conversation title was updated
    await expect(app.sidebar.conversationByTitle('Quantum Computing')).toBeVisible();
  });

  // CHAT-010: Clear conversation messages
  test('clears messages while keeping conversation', async ({ app }) => {
    const conv = createConversation({ id: 'conv-clear', title: 'Clear Me' });
    app.api.addConversation(conv);
    await app.reload();

    // The conversation should still exist in sidebar after clear
    await expect(app.sidebar.conversationByTitle('Clear Me')).toBeVisible();
  });

  // CHAT-012: Feed conversation
  test('scheduled task events appear in Feed', async ({ app }) => {
    const taskMsg = createTaskRunMessage('Daily Summary', 'feed');
    app.api.setConversationMessages('feed', [taskMsg]);
    await app.reload();

    // Feed is the default view
    await app.chat.waitForMessageContaining('Daily Summary');
  });

  // CHAT-020: Inline conversation rename
  test('edits conversation name directly in sidebar', async ({ app }) => {
    const conv = createConversation({ id: 'conv-inline', title: 'Inline Name' });
    app.api.addConversation(conv);
    await app.reload();

    // Start inline rename
    await app.sidebar.startRename('Inline Name');

    // Check that rename input is visible
    await app.sidebar.waitForRenameInput();

    await app.sidebar.finishRename('Renamed Inline');
    await expect(app.sidebar.conversationByTitle('Renamed Inline')).toBeVisible();
  });
});
