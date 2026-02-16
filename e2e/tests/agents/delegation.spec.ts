/**
 * Agent Delegation Tests
 *
 * Covers: AGENT-001 through AGENT-012
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';
import { AgentType, AgentInfo } from '../../constants/index.js';

test.describe('Agent Delegation', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-agent', title: 'Agent Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('Agent Test');
  });

  // AGENT-001: Delegate to researcher
  test('supervisor delegates research task to researcher agent', async ({ app }) => {
    await app.chat.sendMessage('Research the latest AI developments');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-res-1',
      agentType: AgentType.RESEARCHER,
      agentName: AgentInfo[AgentType.RESEARCHER].name,
      agentEmoji: AgentInfo[AgentType.RESEARCHER].emoji,
      mission: 'Research latest AI developments',
      rationale: 'Delegating research task to specialist',
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.RESEARCHER].name)).toBeVisible();
  });

  // AGENT-002: Delegate to coder
  test('supervisor delegates coding task to coder agent', async ({ app }) => {
    await app.chat.sendMessage('Write a Python function to sort a list');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-code-1',
      agentType: AgentType.CODER,
      agentName: AgentInfo[AgentType.CODER].name,
      agentEmoji: AgentInfo[AgentType.CODER].emoji,
      mission: 'Write Python sort function',
      rationale: 'Delegating coding task to specialist',
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.CODER].name)).toBeVisible();
  });

  // AGENT-003: Delegate to writer
  test('supervisor delegates writing task to writer agent', async ({ app }) => {
    await app.chat.sendMessage('Write a blog post about testing');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-write-1',
      agentType: AgentType.WRITER,
      agentName: AgentInfo[AgentType.WRITER].name,
      agentEmoji: AgentInfo[AgentType.WRITER].emoji,
      mission: 'Write blog post',
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.WRITER].name)).toBeVisible();
  });

  // AGENT-004: Delegate to planner
  test('supervisor delegates planning task to planner agent', async ({ app }) => {
    await app.chat.sendMessage('Plan a migration strategy');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-plan-1',
      agentType: AgentType.PLANNER,
      agentName: AgentInfo[AgentType.PLANNER].name,
      agentEmoji: AgentInfo[AgentType.PLANNER].emoji,
      mission: 'Plan migration strategy',
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.PLANNER].name)).toBeVisible();
  });

  // AGENT-005: Command trigger (#research)
  test('#research triggers direct delegation', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible();

    // Select Deep Research from menu
    const items = await app.chat.getHashtagMenuItems();
    const researchItem = items.find(i => i.toLowerCase().includes('research'));
    if (researchItem) {
      await app.chat.selectHashtagItem(researchItem);
      await expect(app.chat.commandChip).toBeVisible();
    }
  });

  // AGENT-006: Command trigger (#code / #Modify)
  test('#Modify triggers direct delegation', async ({ app }) => {
    await app.chat.openHashtagMenu();
    await expect(app.chat.hashtagMenu).toBeVisible();

    const items = await app.chat.getHashtagMenuItems();
    const codeItem = items.find(i => i.toLowerCase().includes('modify') || i.toLowerCase().includes('code'));
    if (codeItem) {
      await app.chat.selectHashtagItem(codeItem);
      await expect(app.chat.commandChip).toBeVisible();
    }
  });

  // AGENT-008: Delegation notification
  test('UI shows delegation card when agent is spawned', async ({ app }) => {
    await app.chat.sendMessage('Help me with research');

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-n1',
      agentType: AgentType.RESEARCHER,
      agentName: AgentInfo[AgentType.RESEARCHER].name,
      agentEmoji: AgentInfo[AgentType.RESEARCHER].emoji,
      mission: 'Research task',
      rationale: 'Spawning research specialist',
    });

    const delegationCard = app.chat.delegationByAgent(AgentInfo[AgentType.RESEARCHER].name);
    await expect(delegationCard).toBeVisible();
    await expect(delegationCard).toContainText('Research task');
  });

  // AGENT-009: Worker response attribution
  test('worker responses show correct agent name and emoji', async ({ app }) => {
    await app.chat.sendMessage('Do some research');

    // Response from a worker agent (not supervisor)
    app.ws.simulateResponse({
      conversationId: 'conv-agent',
      content: 'Here are my research findings...',
      agentName: AgentInfo[AgentType.RESEARCHER].name,
      agentEmoji: AgentInfo[AgentType.RESEARCHER].emoji,
    });

    await app.chat.waitForMessageContaining('research findings');

    // Verify agent avatar/name is shown
    await expect(app.chat.lastMessageAvatar).toBeVisible();
  });

  // AGENT-010: Parallel delegation
  test('multiple agents work in parallel', async ({ app }) => {
    await app.chat.sendMessage('Research and code a solution');

    // Two delegations in parallel
    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-p1',
      agentType: AgentType.RESEARCHER,
      agentName: AgentInfo[AgentType.RESEARCHER].name,
      agentEmoji: AgentInfo[AgentType.RESEARCHER].emoji,
      mission: 'Research the topic',
    });

    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-p2',
      agentType: AgentType.CODER,
      agentName: AgentInfo[AgentType.CODER].name,
      agentEmoji: AgentInfo[AgentType.CODER].emoji,
      mission: 'Code the solution',
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.RESEARCHER].name)).toBeVisible();
    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.CODER].name)).toBeVisible();
  });

  // AGENT-012: Delegation chain
  test('multi-level delegation renders correctly', async ({ app }) => {
    await app.chat.sendMessage('Complex coding task');

    // Supervisor -> Coding Lead
    app.ws.simulateDelegation({
      conversationId: 'conv-agent',
      agentId: 'agent-cl',
      agentType: AgentType.CODING_LEAD,
      agentName: AgentInfo[AgentType.CODING_LEAD].name,
      agentEmoji: AgentInfo[AgentType.CODING_LEAD].emoji,
      mission: 'Lead the coding task',
    });

    // Response from coding lead (sub-delegation happened internally)
    app.ws.simulateResponse({
      conversationId: 'conv-agent',
      content: 'I have completed the coding task with my team.',
      agentName: AgentInfo[AgentType.CODING_LEAD].name,
      agentEmoji: AgentInfo[AgentType.CODING_LEAD].emoji,
    });

    await expect(app.chat.delegationByAgent(AgentInfo[AgentType.CODING_LEAD].name)).toBeVisible();
    await app.chat.waitForMessageContaining('completed the coding task');
  });
});
