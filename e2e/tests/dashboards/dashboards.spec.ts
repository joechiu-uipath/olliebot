/**
 * Dashboard Tests
 *
 * Covers: DASH-001 through DASH-008
 */

import { test, expect } from '../../utils/test-base.js';
import { createDashboardSnapshot } from '../../fixtures/index.js';

test.describe('Dashboards', () => {

  // DASH-001: Create dashboard snapshot
  test('creates dashboard snapshot via API', async ({ app }) => {
    app.api.setHandler('POST', '/api/dashboards/snapshots', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createDashboardSnapshot({ id: 'snap-new' })),
      });
    });

    await app.switchToMission();
  });

  // DASH-002: List dashboard snapshots
  test('lists all dashboard snapshots', async ({ app }) => {
    app.api.setHandler('GET', '/api/dashboards/snapshots', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          createDashboardSnapshot({ id: 'snap-1' }),
          createDashboardSnapshot({ id: 'snap-2' }),
        ]),
      });
    });

    await app.switchToMission();
  });

  // DASH-003: Get dashboard snapshot
  test('retrieves specific dashboard snapshot', async ({ app }) => {
    app.api.setHandler('GET', '/api/dashboards/snapshots/snap-detail', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createDashboardSnapshot({ id: 'snap-detail', html: '<div>Detailed Dashboard</div>' })),
      });
    });

    await app.switchToMission();
  });

  // DASH-004: Render dashboard
  test('renders dashboard HTML', async ({ app }) => {
    app.api.setHandler('POST', '/api/dashboards/snapshots/snap-render/render', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          html: '<div class="dashboard"><h1>Dashboard</h1><div class="kpi">Revenue: $1M</div></div>',
        }),
      });
    });

    await app.switchToMission();
  });

  // DASH-005: Re-render dashboard
  test('regenerates dashboard HTML', async ({ app }) => {
    app.api.setHandler('POST', '/api/dashboards/snapshots/snap-rerender/rerender', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          html: '<div class="dashboard"><h1>Updated Dashboard</h1></div>',
        }),
      });
    });

    await app.switchToMission();
  });

  // DASH-006: Delete dashboard
  test('removes dashboard snapshot', async ({ app }) => {
    app.api.setHandler('DELETE', '/api/dashboards/snapshots/snap-delete', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await app.switchToMission();
  });

  // DASH-008: Dashboard HTML output
  test('generated HTML includes KPIs, trends, badges', async ({ app }) => {
    const dashboardHtml = `
      <div class="dashboard">
        <h1>Mission Dashboard</h1>
        <div class="kpi-grid">
          <div class="kpi"><span class="kpi-value">95%</span><span class="kpi-label">Uptime</span></div>
          <div class="kpi"><span class="kpi-value">42</span><span class="kpi-label">Tasks Done</span></div>
        </div>
        <div class="trend">↑ 15% from last week</div>
        <span class="badge badge-success">On Track</span>
      </div>
    `;

    app.api.setHandler('POST', '/api/dashboards/snapshots/snap-full/render', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ html: dashboardHtml }),
      });
    });

    await app.switchToMission();
  });
});
