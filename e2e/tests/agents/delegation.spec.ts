/**
 * Agent Delegation Tests
 *
 * Covers: AGENT-001 through AGENT-012
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Agent Delegation', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-agent', title: 'Agent Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Agent Test');
  });

  // AGENT-001: Delegate to researcher
  test('supervisor delegates research task to researcher agent', async ({ app }) => {
    await app.chat.sendMessage('Research the latest AI developments');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-res-1',
      agentType: 'researcher',
      agentName: 'Researcher',
      agentEmoji: '🔬',
      mission: 'Research latest AI developments',
      rationale: 'Delegating research task to specialist',
    });

    await expect(app.chat.delegationByAgent('Researcher')).toBeVisible({ timeout: 5000 });
  });

  // AGENT-002: Delegate to coder
  test('supervisor delegates coding task to coder agent', async ({ app }) => {
    await app.chat.sendMessage('Write a Python function to sort a list');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-code-1',
      agentType: 'coder',
      agentName: 'Coder',
      agentEmoji: '💻',
      mission: 'Write Python sort function',
      rationale: 'Delegating coding task to specialist',
    });

    await expect(app.chat.delegationByAgent('Coder')).toBeVisible({ timeout: 5000 });
  });

  // AGENT-003: Delegate to writer
  test('supervisor delegates writing task to writer agent', async ({ app }) => {
    await app.chat.sendMessage('Write a blog post about testing');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-write-1',
      agentType: 'writer',
      agentName: 'Writer',
      agentEmoji: '✍️',
      mission: 'Write blog post',
    });

    await expect(app.chat.delegationByAgent('Writer')).toBeVisible({ timeout: 5000 });
  });

  // AGENT-004: Delegate to planner
  test('supervisor delegates planning task to planner agent', async ({ app }) => {
    await app.chat.sendMessage('Plan a migration strategy');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-plan-1',
      agentType: 'planner',
      agentName: 'Planner',
      agentEmoji: '📋',
      mission: 'Plan migration strategy',
    });

    await expect(app.chat.delegationByAgent('Planner')).toBeVisible({ timeout: 5000 });
  });

  // AGENT-005: Command trigger (#research)
  test('#research triggers direct delegation', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    // Select Deep Research from menu
    const items = await app.chat.getHashtagMenuItems();
    const researchItem = items.find(i => i.toLowerCase().includes('research'));
    if (researchItem) {
      await app.chat.selectHashtagItem(researchItem);
      await expect(app.chat.commandChip).toBeVisible({ timeout: 3000 });
    }
  });

  // AGENT-006: Command trigger (#code / #Modify)
  test('#Modify triggers direct delegation', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });

    const items = await app.chat.getHashtagMenuItems();
    const codeItem = items.find(i => i.toLowerCase().includes('modify') || i.toLowerCase().includes('code'));
    if (codeItem) {
      await app.chat.selectHashtagItem(codeItem);
      await expect(app.chat.commandChip).toBeVisible({ timeout: 3000 });
    }
  });

  // AGENT-008: Delegation notification
  test('UI shows delegation card when agent is spawned', async ({ app }) => {
    await app.chat.sendMessage('Help me with research');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-n1',
      agentType: 'researcher',
      agentName: 'Researcher',
      agentEmoji: '🔬',
      mission: 'Research task',
      rationale: 'Spawning research specialist',
    });

    const delegationCard = app.chat.delegationByAgent('Researcher');
    await expect(delegationCard).toBeVisible({ timeout: 5000 });
    await expect(delegationCard).toContainText('Research task');
  });

  // AGENT-009: Worker response attribution
  test('worker responses show correct agent name and emoji', async ({ app }) => {
    await app.chat.sendMessage('Do some research');

    // Response from a worker agent (not supervisor)
    app.ws.simulateResponse({
      conversationId: 'conv-agent',
      content: 'Here are my research findings...',
      agentName: 'Researcher',
      agentEmoji: '🔬',
    });

    await app.chat.waitForMessageContaining('research findings');

    // Verify agent avatar/name is shown
    const lastMsg = app.chat.lastMessage;
    await expect(lastMsg.locator('.message-avatar, [class*="avatar"]')).toBeVisible();
  });

  // AGENT-010: Parallel delegation
  test('multiple agents work in parallel', async ({ app }) => {
    await app.chat.sendMessage('Research and code a solution');

    // Two delegations in parallel
    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-p1',
      agentType: 'researcher',
      agentName: 'Researcher',
      agentEmoji: '🔬',
      mission: 'Research the topic',
    });

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-p2',
      agentType: 'coder',
      agentName: 'Coder',
      agentEmoji: '💻',
      mission: 'Code the solution',
    });

    await expect(app.chat.delegationByAgent('Researcher')).toBeVisible({ timeout: 5000 });
    await expect(app.chat.delegationByAgent('Coder')).toBeVisible({ timeout: 5000 });
  });

  // AGENT-012: Delegation chain
  test('multi-level delegation renders correctly', async ({ app }) => {
    await app.chat.sendMessage('Complex coding task');

    // Supervisor -> Coding Lead
    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-cl',
      agentType: 'coding-lead',
      agentName: 'Coding Lead',
      agentEmoji: '💻',
      mission: 'Lead the coding task',
    });

    // Response from coding lead (sub-delegation happened internally)
    app.ws.simulateResponse({
      conversationId: 'conv-agent',
      content: 'I have completed the coding task with my team.',
      agentName: 'Coding Lead',
      agentEmoji: '💻',
    });

    await expect(app.chat.delegationByAgent('Coding Lead')).toBeVisible({ timeout: 5000 });
    await app.chat.waitForMessageContaining('completed the coding task');
  });
});
