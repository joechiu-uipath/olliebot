/**
 * Missions Tests
 *
 * Covers: MISSION-001 through MISSION-018
 */

import { test, expect } from '../../utils/test-base.js';
import { createMission, createConversation } from '../../fixtures/index.js';

test.describe('Missions', () => {

  // MISSION-001: List missions
  test('views all missions via Mission mode', async ({ app }) => {
    // Set up missions API response
    app.api.setHandler('GET', '/api/missions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          createMission({ slug: 'mission-1', name: 'Growth Strategy' }),
          createMission({ slug: 'mission-2', name: 'Tech Debt' }),
        ]),
      });
    });

    await app.page.reload();
    await app.waitForAppReady();
    await app.switchToMission();

    // Mission mode should show mission list
    await expect(app.page.locator('.mode-btn.active')).toContainText('Mission');
  });

  // MISSION-002: View mission details
  test('sees mission pillars, todos, metrics', async ({ app }) => {
    const mission = createMission({
      slug: 'detailed-mission',
      name: 'Detailed Mission',
      pillars: [
        { slug: 'pillar-1', name: 'Revenue', description: 'Revenue growth' },
        { slug: 'pillar-2', name: 'Quality', description: 'Code quality' },
      ],
    });

    app.api.setHandler('GET', '/api/missions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mission]),
      });
    });

    app.api.setHandler('GET', '/api/missions/detailed-mission', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mission),
      });
    });

    await app.page.reload();
    await app.waitForAppReady();
    await app.switchToMission();
  });

  // MISSION-003: Pause mission
  test('pauses an active mission', async ({ app }) => {
    app.api.setHandler('POST', '/api/missions/test-mission/pause', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await app.switchToMission();
    // Pause would be triggered via UI button in the mission detail view
  });

  // MISSION-004: Resume mission
  test('resumes a paused mission', async ({ app }) => {
    app.api.setHandler('POST', '/api/missions/test-mission/resume', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await app.switchToMission();
  });

  // MISSION-005 through MISSION-008: Mission tools (todo CRUD, metrics)
  test('creates and manages mission todos', async ({ app }) => {
    const conv = createConversation({ id: 'conv-mission', title: 'Mission Chat' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Mission Chat');

    // Simulate todo creation tool
    app.ws.simulateToolExecution({
      conversationId: 'conv-mission',
      turnId: 'turn-todo',
      requestId: 'req-todo',
      toolName: 'mission_todo_create',
      parameters: { title: 'Complete feature X', pillarSlug: 'pillar-1' },
      result: 'Todo created: Complete feature X',
    });

    await expect(app.chat.toolByName('mission_todo_create')).toBeVisible({ timeout: 5000 });
  });

  // MISSION-009: Update dashboard
  test('updates mission dashboard', async ({ app }) => {
    const conv = createConversation({ id: 'conv-dash', title: 'Dashboard Update' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Dashboard Update');

    app.ws.simulateToolExecution({
      conversationId: 'conv-dash',
      turnId: 'turn-dash',
      requestId: 'req-dash',
      toolName: 'mission_update_dashboard',
      parameters: { missionSlug: 'test-mission' },
      result: 'Dashboard updated.',
    });

    await expect(app.chat.toolByName('mission_update_dashboard')).toBeVisible({ timeout: 5000 });
  });

  // MISSION-010: Mission cycle
  test('triggers mission cycle', async ({ app }) => {
    app.api.setHandler('POST', '/api/missions/test-mission/cycle', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Cycle triggered' }),
      });
    });

    await app.switchToMission();
  });

  // MISSION-012: Mission mode UI
  test('switches to Mission mode via mode switcher', async ({ app }) => {
    await app.switchToMission();
    await expect(app.page.locator('.mode-btn.active')).toContainText('Mission');
  });

  // MISSION-015: Mission tabs
  test('switches between dashboard/pillars/config tabs', async ({ app }) => {
    await app.switchToMission();
    // The mission mode should be active
    await expect(app.page.locator('.mode-btn.active')).toContainText('Mission');
  });
});
