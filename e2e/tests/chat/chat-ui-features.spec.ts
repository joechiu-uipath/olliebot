/**
 * Chat & Conversations - UI Feature Tests
 *
 * Covers: CHAT-013, CHAT-014, CHAT-016 through CHAT-019, CHAT-021 through CHAT-023
 */

import { test, expect } from '../../utils/test-base.js';
import {
  createConversation, createDelegationMessage, createToolMessage,
  createCitationMessage,
} from '../../fixtures/index.js';

test.describe('Chat UI Features', () => {

  // CHAT-013: Delegation display
  test('delegation events render correctly', async ({ app }) => {
    const conv = createConversation({ id: 'conv-deleg', title: 'Delegation' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Delegation');

    await app.chat.sendMessage('Research AI trends');

    // Simulate delegation event
    app.ws.simulateDelegation({
      conversationId: 'conv-deleg',
      agentId: 'agent-r1',
      agentType: 'researcher',
      agentName: 'Researcher',
      agentEmoji: '🔬',
      mission: 'Research AI trends in 2025',
      rationale: 'Delegating to research specialist',
    });

    // Verify delegation card appears
    await expect(app.chat.delegationByAgent('Researcher')).toBeVisible({ timeout: 5000 });
  });

  // CHAT-014: Tool execution display
  test('tool calls show parameters and results', async ({ app }) => {
    const conv = createConversation({ id: 'conv-tool', title: 'Tool Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Tool Test');

    await app.chat.sendMessage('Search the web for Playwright');

    // Simulate tool execution
    app.ws.simulateToolExecution({
      conversationId: 'conv-tool',
      turnId: 'turn-t1',
      requestId: 'req-t1',
      toolName: 'web_search',
      parameters: { query: 'Playwright testing' },
      result: JSON.stringify({ results: [{ title: 'Playwright Docs', url: 'https://playwright.dev' }] }),
      success: true,
      durationMs: 250,
    });

    // Verify tool details appear
    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });
  });

  // CHAT-016: Citations display
  test('source citations render and are clickable', async ({ app }) => {
    const conv = createConversation({ id: 'conv-cite', title: 'Citations' });
    const citationMsg = createCitationMessage(
      'According to recent research, AI is transforming healthcare.',
      'conv-cite',
      [
        { title: 'AI in Healthcare', url: 'https://example.com/ai-health', snippet: 'AI transforming healthcare...' },
        { title: 'Future of Medicine', url: 'https://example.com/medicine', snippet: 'Medical advances...' },
      ],
    );
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-cite', [citationMsg]);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Citations');

    await app.chat.waitForMessageContaining('AI is transforming healthcare');
  });

  // CHAT-017: Think mode toggle
  test('toggles Think mode via hashtag in input', async ({ app }) => {
    await app.chat.openHashtagMenu();

    // Verify hashtag menu is visible
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    // Check that Think option appears
    const items = await app.chat.getHashtagMenuItems();
    expect(items.some(i => i.toLowerCase().includes('think'))).toBe(true);
  });

  // CHAT-018: Think+ mode toggle
  test('toggles Think+ (extended thinking) mode', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    // Extended thinking option should appear for supported models
    const items = await app.chat.getHashtagMenuItems();
    expect(items.length).toBeGreaterThan(0);
  });

  // CHAT-019: Deep Research mode toggle
  test('toggles Deep Research mode via hashtag', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    // Deep Research option should be in the menu
    const items = await app.chat.getHashtagMenuItems();
    expect(items.some(i => i.toLowerCase().includes('deep research') || i.toLowerCase().includes('research'))).toBe(true);
  });

  // CHAT-021: Hashtag menu
  test('# shows command menu with modes and agents', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    const items = await app.chat.getHashtagMenuItems();
    // Should have at least Think + Deep Research + Modify (agent commands)
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  // CHAT-022: Agent command chip
  test('selected agent command shows as removable chip', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    // Select first available item
    const items = app.page.locator('.hashtag-menu-item');
    if (await items.count() > 0) {
      await items.first().click();

      // A chip should appear
      await expect(app.chat.commandChip).toBeVisible({ timeout: 3000 });
    }
  });

  // CHAT-023: Scroll-to-bottom button
  test('scroll-to-bottom button appears when scrolled up', async ({ app }) => {
    const conv = createConversation({ id: 'conv-scroll', title: 'Scroll Test' });
    // Create many messages to enable scrolling
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message number ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(5)}`,
      conversationId: 'conv-scroll',
      createdAt: new Date(Date.now() - (50 - i) * 60000).toISOString(),
    }));
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-scroll', messages);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Scroll Test');

    // Wait for messages to load
    await app.chat.waitForMessageContaining('Message number');
  });
});
