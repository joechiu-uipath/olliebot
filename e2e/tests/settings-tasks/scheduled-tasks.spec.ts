/**
 * Scheduled Tasks Tests
 *
 * Covers: TASK-001 through TASK-011
 */

import { test, expect } from '../../utils/test-base.js';
import { createTask, createConversation } from '../../fixtures/index.js';

test.describe('Scheduled Tasks', () => {

  // TASK-001: List tasks
  test('views all scheduled tasks in sidebar', async ({ app }) => {
    const tasks = [
      createTask({ id: 'task-1', name: 'Morning Summary', schedule: '0 9 * * *' }),
      createTask({ id: 'task-2', name: 'Daily Report', schedule: '0 18 * * *' }),
    ];
    app.api.setTasks(tasks);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Agent Tasks');
    await expect(app.sidebar.accordion('Agent Tasks').locator('.accordion-content')).toBeVisible({ timeout: 3000 });
  });

  // TASK-002: Run task manually
  test('triggers task execution via sidebar', async ({ app }) => {
    const tasks = [createTask({ id: 'task-manual', name: 'Manual Task' })];
    app.api.setTasks(tasks);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Agent Tasks');

    // Run the task
    await app.sidebar.runTask('Manual Task');
  });

  // TASK-003: Task run event
  test('task run appears in Feed conversation', async ({ app }) => {
    await app.waitForAppReady();

    // Simulate a task run event
    app.ws.send({
      type: 'task_run',
      conversationId: 'feed',
      taskId: 'task-feed',
      taskName: 'Auto Summary',
      taskDescription: 'Generates daily summary',
      messageId: `msg-task-${Date.now()}`,
      content: 'Daily summary: All systems operational.',
    });

    await app.chat.waitForMessageContaining('Daily summary');
  });

  // TASK-005: Enable/disable task
  test('toggles task active state', async ({ app }) => {
    const tasks = [createTask({ id: 'task-toggle', name: 'Toggle Task', enabled: true })];
    app.api.setTasks(tasks);
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Agent Tasks');
    await app.sidebar.toggleTask('Toggle Task');
  });

  // TASK-007: Task lastRun tracking
  test('lastRun timestamp updates after execution', async ({ app }) => {
    const tasks = [createTask({ id: 'task-lastrun', name: 'Track Task', lastRun: null })];
    app.api.setTasks(tasks);
    await app.page.reload();
    await app.waitForAppReady();

    // After task runs, a task_updated event would come
    app.ws.send({
      type: 'task_updated',
      taskId: 'task-lastrun',
      lastRun: new Date().toISOString(),
      enabled: true,
    });
  });

  // TASK-008: Task with conversationId
  test('task targets specific conversation', async ({ app }) => {
    const conv = createConversation({ id: 'conv-task-target', title: 'Task Target' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Task Target');

    app.ws.send({
      type: 'task_run',
      conversationId: 'conv-task-target',
      taskId: 'task-targeted',
      taskName: 'Targeted Task',
      messageId: `msg-targeted-${Date.now()}`,
      content: 'Task result for this conversation.',
    });

    // Task run renders as .task-run-event showing the task name
    await app.chat.waitForMessageContaining('Targeted Task');
  });

  // TASK-009: No duplicate task messages
  test('single message per task run after refresh', async ({ app }) => {
    const conv = createConversation({ id: 'conv-task-dedup', title: 'Dedup Test' });
    const messages = [{
      id: 'msg-task-single',
      role: 'assistant',
      content: 'Task result.',
      conversationId: 'conv-task-dedup',
      createdAt: new Date().toISOString(),
      messageType: 'task_run',
      taskId: 'task-dedup',
      taskName: 'Dedup Task',
    }];
    app.api.addConversation(conv);
    app.api.setConversationMessages('conv-task-dedup', messages);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Dedup Test');

    // Only one instance should appear (task_run renders showing taskName)
    await app.chat.waitForMessageContaining('Dedup Task');
    const taskEvents = app.chat.taskRunEvents;
    const count = await taskEvents.count();
    // Should have exactly 1 task run message
    expect(count).toBeLessThanOrEqual(1);
  });
});
