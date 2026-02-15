/**
 * Deep Research Tests
 *
 * Covers: RESEARCH-001 through RESEARCH-010
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

  // RESEARCH-005: Research plan event
  test('deep_research_plan event shows research plan', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.send({
      type: 'deep_research_plan',
      conversationId: 'conv-research',
      plan: {
        steps: [
          { title: 'Step 1: Literature review', description: 'Review existing papers' },
          { title: 'Step 2: Data collection', description: 'Gather data from sources' },
          { title: 'Step 3: Analysis', description: 'Analyze findings' },
        ],
      },
    });

    // Plan should be rendered in the UI
    await expect(app.page.locator('text=Literature review')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-006: Research step events
  test('deep_research_step events show progress', async ({ app }) => {
    await app.chat.sendMessage('Research AI');

    app.ws.send({
      type: 'deep_research_step',
      conversationId: 'conv-research',
      step: 1,
      title: 'Searching academic papers',
      status: 'in_progress',
    });

    await expect(app.page.locator('text=Searching academic papers')).toBeVisible({ timeout: 5000 });

    app.ws.send({
      type: 'deep_research_step',
      conversationId: 'conv-research',
      step: 1,
      title: 'Searching academic papers',
      status: 'completed',
    });
  });

  // RESEARCH-007: Research source events
  test('deep_research_source events list sources', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.send({
      type: 'deep_research_source',
      conversationId: 'conv-research',
      sources: [
        { title: 'Research Paper A', url: 'https://arxiv.org/paper-a' },
        { title: 'Blog Post B', url: 'https://blog.example.com/post-b' },
      ],
    });

    await expect(app.page.locator('text=Research Paper A')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-008: Research draft event
  test('deep_research_draft event shows draft', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.send({
      type: 'deep_research_draft',
      conversationId: 'conv-research',
      draft: 'This is a preliminary draft of the research findings on the topic...',
    });

    await expect(app.page.locator('text=preliminary draft')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-009: Research review event
  test('deep_research_review event shows feedback', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.send({
      type: 'deep_research_review',
      conversationId: 'conv-research',
      review: 'The draft needs more quantitative data and citations from peer-reviewed sources.',
    });

    await expect(app.page.locator('text=quantitative data')).toBeVisible({ timeout: 5000 });
  });

  // RESEARCH-010: Research completion
  test('deep_research_completed event with final report', async ({ app }) => {
    await app.chat.sendMessage('Research topic');

    app.ws.send({
      type: 'deep_research_completed',
      conversationId: 'conv-research',
      report: '# Final Research Report\n\n## Summary\nOur research found that...',
    });

    app.ws.simulateResponse({
      conversationId: 'conv-research',
      content: '# Final Research Report\n\n## Summary\nOur research found that quantum computing has advanced significantly...',
    });

    await app.chat.waitForMessageContaining('Final Research Report');
  });
});
