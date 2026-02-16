/**
 * Deep Research Tests
 *
 * Covers: RESEARCH-001 through RESEARCH-010
 *
 * Deep research in the frontend works via:
 * 1. User sends message with #Deep Research command
 * 2. Supervisor delegates to deep-research-lead agent
 * 3. Agent uses tools (web_search, web_scrape) and streams updates
 * 4. Final report delivered as streamed assistant message
 *
 * Note: The frontend does NOT handle deep_research_* custom WS events.
 * All deep research UI is rendered via standard delegation, tool, and stream events.
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Deep Research', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-research', title: 'Research Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Research Test');
  });

  // RESEARCH-001: Initiate deep research
  test('starts multi-step research via # toggle', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    const items = await app.chat.getHashtagMenuItems();
    const researchItem = items.find(i => i.toLowerCase().includes('deep research') || i.toLowerCase().includes('research'));
    if (researchItem) {
      await app.chat.selectHashtagItem(researchItem);
      await expect(app.chat.commandChip).toBeVisible({ timeout: 3000 });
    }

    await app.chat.typeMessage('What are the latest advances in quantum computing?');
    await app.chat.clickSend();
  });

  // RESEARCH-002: Research lead delegation
  test('supervisor delegates to deep-research-lead', async ({ app }) => {
    await app.chat.sendMessage('Deep research on climate change');

    app.ws.simulateDelegation({
      conversationId: 'conv-research',
      agentId: 'agent-drl',
      agentType: 'deep-research-lead',
      agentName: 'Deep Research Lead',
      agentEmoji: '🔬',
      mission: 'Deep research on climate change',
    });

    await expect(app.chat.delegationByAgent('Deep Research Lead')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-005: Research plan — rendered as delegation with streamed plan content
  test('research plan delivered via delegation and streaming', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    // Deep research lead is delegated to
    app.ws.simulateDelegation({
      conversationId: 'conv-research',
      agentId: 'agent-plan',
      agentType: 'deep-research-lead',
      agentName: 'Deep Research Lead',
      agentEmoji: '🔬',
      mission: 'Research topic',
    });

    // Agent streams its research plan
    app.ws.simulateResponse({
      conversationId: 'conv-research',
      content: '## Research Plan\n\n1. Literature review\n2. Data collection\n3. Analysis',
      agentName: 'Deep Research Lead',
      agentEmoji: '🔬',
    });

    await app.chat.waitForMessageContaining('Research Plan');
  });

  // RESEARCH-006: Research steps — rendered as tool executions
  test('research steps shown as tool executions', async ({ app }) => {
    await app.chat.sendMessage('Research AI');

    // Agent searches for papers
    app.ws.simulateToolExecution({
      conversationId: 'conv-research',
      turnId: 'turn-step1',
      requestId: 'req-step1',
      toolName: 'web_search',
      parameters: { query: 'AI research papers 2025' },
      result: 'Found 5 relevant papers on neural architecture search.',
    });

    await expect(app.chat.toolByName('web_search')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-007: Research sources — delivered via tool results
  test('research sources gathered via web scraping tools', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.simulateToolExecution({
      conversationId: 'conv-research',
      turnId: 'turn-src',
      requestId: 'req-src',
      toolName: 'web_scrape',
      parameters: { url: 'https://arxiv.org/paper-a' },
      result: 'Scraped content from Research Paper A: Findings on quantum computing...',
    });

    await expect(app.chat.toolByName('web_scrape')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-008: Research draft — streamed as message content
  test('research draft delivered as streamed response', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.simulateResponse({
      conversationId: 'conv-research',
      content: '# Draft Report\n\nThis is a preliminary draft of the research findings...',
      agentName: 'Deep Research Lead',
      agentEmoji: '🔬',
    });

    await app.chat.waitForMessageContaining('Draft Report');
  });

  // RESEARCH-009: Research review — subsequent streamed message
  test('research review delivered as follow-up response', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.simulateResponse({
      conversationId: 'conv-research',
      content: '## Review Notes\n\nThe draft needs more quantitative data and peer-reviewed citations.',
      agentName: 'Deep Research Lead',
      agentEmoji: '🔬',
    });

    await app.chat.waitForMessageContaining('Review Notes');
  });

  // RESEARCH-010: Research completion
  test('final research report delivered as streamed response', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.simulateResponse({
      conversationId: 'conv-research',
      content: '# Final Research Report\n\n## Summary\nOur research found that quantum computing has advanced significantly...',
    });

    await app.chat.waitForMessageContaining('Final Research Report');
  });
});
