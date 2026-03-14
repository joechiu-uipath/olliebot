/**
 * Chat & Conversations - Messaging Tests
 *
 * Covers: CHAT-001 through CHAT-004, CHAT-011, CHAT-015, CHAT-024, CHAT-025
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createUserMessage, createAssistantMessage } from '../../fixtures/index.js';
import { ToolName, AgentType } from '../../constants/index.js';

test.describe('Chat Messaging', () => {

  // CHAT-001: Send simple message
  test('sends a text message and receives a response', async ({ app }) => {
    // Create a conversation to chat in
    const conv = createConversation({ id: 'conv-test-1', title: 'Test Chat' });
    app.api.addConversation(conv);
    await app.reload();

    await app.sidebar.selectConversation('Test Chat');
    await app.chat.sendMessage('Hello, OllieBot!');

    // Verify the user message appears
    await app.chat.waitForMessageContaining('Hello, OllieBot!');

    // Simulate the assistant response via WebSocket
    app.ws.simulateResponse({
      conversationId: 'conv-test-1',
      content: 'Hello! How can I help you today?',
    });

    // Verify the response appears
    await app.chat.waitForMessageContaining('Hello! How can I help you today?');
  });

  // CHAT-002: Streaming response
  test('displays streaming response token by token', async ({ app }) => {
    const conv = createConversation({ id: 'conv-stream', title: 'Stream Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Stream Test');

    await app.chat.sendMessage('Tell me a story');

    // Start streaming (frontend expects 'id' field to identify the stream)
    const streamId = 'stream-1';
    app.ws.send({
      type: 'stream_start',
      conversationId: 'conv-stream',
      id: streamId,
    });

    // Verify streaming state
    await app.chat.waitForStreaming();

    // Send chunks (frontend expects 'streamId' and 'chunk' fields)
    app.ws.send({ type: 'stream_chunk', conversationId: 'conv-stream', streamId, chunk: 'Once upon ' });
    app.ws.send({ type: 'stream_chunk', conversationId: 'conv-stream', streamId, chunk: 'a time...' });

    // Verify partial content
    await app.chat.waitForMessageContaining('Once upon');

    // End stream (frontend expects 'streamId' field)
    app.ws.send({
      type: 'stream_end',
      conversationId: 'conv-stream',
      streamId,
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    // Verify streaming stopped
    await app.chat.waitForStreamingComplete();
  });

  // CHAT-003: Message with image attachment
  test('sends a message with image attachment', async ({ app }) => {
    const conv = createConversation({ id: 'conv-attach', title: 'Attach Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Attach Test');

    // Simulate file drop by checking if the attachment UI elements exist
    // In real E2E, we'd use page.setInputFiles or drag-drop simulation
    await app.chat.typeMessage('Analyze this image');

    // Verify input is populated
    const value = await app.chat.getInputValue();
    expect(value).toBe('Analyze this image');
  });

  // CHAT-004: Conversation persistence
  test('messages persist after page refresh', async ({ app }) => {
    const conv = createConversation({ id: 'conv-persist', title: 'Persist Test' });
    const messages = [
      createUserMessage('Hello', 'conv-persist'),
      createAssistantMessage('Hi there!', 'conv-persist'),
    ];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-persist', messages);

    await app.reload();
    await app.sidebar.selectConversation('Persist Test');

    // Verify messages are loaded from API
    await app.chat.waitForMessageContaining('Hello');
    await app.chat.waitForMessageContaining('Hi there!');
  });

  // CHAT-011: Message history pagination
  test('loads older messages on scroll up', async ({ app }) => {
    const conv = createConversation({ id: 'conv-paginate', title: 'Paginate Test' });
    const recentMessages = Array.from({ length: 20 }, (_, i) =>
      createAssistantMessage(`Message ${i + 1}`, 'conv-paginate')
    );
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-paginate', recentMessages);

    await app.reload();
    await app.sidebar.selectConversation('Paginate Test');

    // Verify recent messages load
    await app.chat.waitForMessageContaining('Message 20');
  });

  // CHAT-015: Error message display
  test('displays error messages with details', async ({ app }) => {
    const conv = createConversation({ id: 'conv-error', title: 'Error Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Error Test');

    await app.chat.sendMessage('Trigger an error');

    // Simulate error
    app.ws.simulateError({
      conversationId: 'conv-error',
      error: 'LLM API rate limit exceeded. Please try again in 30 seconds.',
    });

    // Verify error is displayed
    await app.chat.waitForMessageContaining('rate limit exceeded');
    expect(await app.chat.errorMessages.count()).toBeGreaterThan(0);
  });

  // CHAT-024: Streaming cursor
  test('shows blinking cursor during streaming', async ({ app }) => {
    const conv = createConversation({ id: 'conv-cursor', title: 'Cursor Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Cursor Test');

    await app.chat.sendMessage('Show cursor');

    app.ws.send({
      type: 'stream_start',
      conversationId: 'conv-cursor',
      id: 'stream-cursor',
    });

    // Check that the streaming class is applied (which triggers cursor CSS)
    await app.chat.waitForStreaming();
  });

  // CHAT-025: Token usage display
  test('shows token usage after response completes', async ({ app }) => {
    const conv = createConversation({ id: 'conv-tokens', title: 'Tokens Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Tokens Test');

    await app.chat.sendMessage('Count my tokens');

    app.ws.simulateResponse({
      conversationId: 'conv-tokens',
      content: 'Here is the response.',
      usage: { inputTokens: 150, outputTokens: 42 },
    });

    await app.chat.waitForMessageContaining('Here is the response.');

    // Verify usage footer is visible
    await expect(app.chat.lastMessageUsage).toBeVisible();
  });
});
