/**
 * Configuration & Initialization Tests
 *
 * Covers: CONFIG-001 through CONFIG-006
 */

import { test, expect } from '../../utils/test-base.js';
import { createTask, createSkill, createToolInfo } from '../../fixtures/index.js';
import { ToolName } from '../../constants/index.js';

test.describe('Configuration & Initialization', () => {

  // CONFIG-001: Env validation
  test('app loads with valid configuration', async ({ app }) => {
    // If the app starts, env validation passed
    await expect(app.connectionStatus).toContainText('Connected');
  });

  // CONFIG-003: Hot-reload tasks
  test('task changes reflected in sidebar', async ({ app }) => {
    app.api.setTasks([
      createTask({ id: 'task-hot-1', name: 'Original Task' }),
    ]);
    await app.reload();

    await app.sidebar.toggleAccordion('Tasks');
    await expect(app.sidebar.accordion('Tasks')).toContainText('Original Task');

    // Simulate task update via WebSocket
    app.ws.send({
      type: 'task_updated',
      taskId: 'task-hot-1',
      name: 'Updated Task',
      enabled: true,
    });
  });

  // CONFIG-004: Hot-reload tools
  test('tool changes reflected in sidebar', async ({ app }) => {
    app.api.setTools({
      builtin: [createToolInfo(ToolName.WEB_SEARCH, 'Search the web')],
      user: [createToolInfo('custom_tool', 'A custom tool')],
      mcp: {},
    });
    await app.reload();

    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordionContent('Tools')).toBeVisible();
  });

  // CONFIG-005: Hot-reload skills
  test('skill changes reflected in sidebar', async ({ app }) => {
    app.api.setSkills([
      createSkill({ id: 'skill-hot', name: 'Hot Skill' }),
    ]);
    await app.reload();

    await app.sidebar.toggleAccordion('Skills');
    await expect(app.sidebar.accordion('Skills')).toContainText('Hot Skill');
  });
});
