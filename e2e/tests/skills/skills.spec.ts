/**
 * Skills Tests
 *
 * Covers: SKILL-001 through SKILL-005
 */

import { test, expect } from '../../utils/test-base.js';
import { createSkill, createConversation } from '../../fixtures/index.js';

test.describe('Skills', () => {

  // SKILL-001: List skills
  test('views available skills in sidebar', async ({ app }) => {
    app.api.setSkills([
      createSkill({ id: 'skill-1', name: 'Frontend Modifier', description: 'Modifies frontend code' }),
      createSkill({ id: 'skill-2', name: 'Data Analyzer', description: 'Analyzes data' }),
    ]);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Skills');
    await expect(app.sidebar.accordion('Skills').locator('.accordion-content')).toBeVisible({ timeout: 3000 });
  });

  // SKILL-002: Read skill
  test('reads skill content via read_agent_skill tool', async ({ app }) => {
    const conv = createConversation({ id: 'conv-skill', title: 'Skill Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Skill Test');

    app.ws.simulateToolExecution({
      conversationId: 'conv-skill',
      turnId: 'turn-sk-read',
      requestId: 'req-sk-read',
      toolName: 'read_agent_skill',
      parameters: { skillId: 'frontend-modifier' },
      result: '# Frontend Modifier\n\nA skill for modifying frontend code.\n\n## Steps\n1. Read current code\n2. Plan changes\n3. Apply modifications',
    });

    await expect(app.chat.toolByName('read_agent_skill')).toBeVisible({ timeout: 5000 });
  });

  // SKILL-003: Run skill script
  test('executes skill script via run_agent_skill_script', async ({ app }) => {
    const conv = createConversation({ id: 'conv-skill-run', title: 'Skill Run' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Skill Run');

    app.ws.simulateToolExecution({
      conversationId: 'conv-skill-run',
      turnId: 'turn-sk-run',
      requestId: 'req-sk-run',
      toolName: 'run_agent_skill_script',
      parameters: { skillId: 'frontend-modifier', script: 'analyze-component' },
      result: 'Analysis complete: Component has 3 props, 2 state variables.',
    });

    await expect(app.chat.toolByName('run_agent_skill_script')).toBeVisible({ timeout: 5000 });
  });

  // SKILL-005: Built-in skills
  test('accesses built-in skills', async ({ app }) => {
    app.api.setSkills([
      createSkill({ id: 'frontend-modifier', name: 'Frontend Modifier', description: 'Built-in skill for code modification' }),
    ]);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Skills');
    await expect(app.sidebar.accordion('Skills')).toContainText('Frontend Modifier');
  });
});
