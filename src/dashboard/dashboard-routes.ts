/**
 * Dashboard REST API Routes
 *
 * Endpoints for creating, rendering, listing, and managing
 * versioned dashboard snapshots.
 *
 * POST   /api/dashboards/snapshots            Create + capture a new snapshot
 * GET    /api/dashboards/snapshots             List snapshots (filterable)
 * GET    /api/dashboards/snapshots/:id         Get snapshot detail
 * POST   /api/dashboards/snapshots/:id/render  Trigger LLM rendering
 * POST   /api/dashboards/snapshots/:id/rerender Re-render with new spec
 * GET    /api/dashboards/snapshots/:id/html    Raw HTML for iframe src
 * DELETE /api/dashboards/snapshots/:id         Delete a snapshot
 * GET    /api/dashboards/lineage/:lineageId    All versions of a dashboard
 */

import { Hono } from 'hono';
import type { DashboardStore } from './dashboard-store.js';
import type { SnapshotEngine } from './snapshot-engine.js';
import type { RenderEngine } from './render-engine.js';
import type { DashboardSnapshot, SnapshotType } from './types.js';
import {
  DASHBOARD_DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
} from '../constants.js';

export interface DashboardRoutesConfig {
  dashboardStore: DashboardStore;
  snapshotEngine: SnapshotEngine;
  renderEngine: RenderEngine;
}

/**
 * Strip renderedHtml and metricsJson from a snapshot for list responses.
 * Keeps payloads small — callers use the detail or html endpoint for full content.
 */
function toSnapshotSummary(s: DashboardSnapshot) {
  return {
    id: s.id,
    conversationId: s.conversationId,
    missionId: s.missionId,
    title: s.title,
    snapshotType: s.snapshotType,
    version: s.version,
    lineageId: s.lineageId,
    specText: s.specText,
    renderModel: s.renderModel,
    renderDurationMs: s.renderDurationMs,
    renderTokensIn: s.renderTokensIn,
    renderTokensOut: s.renderTokensOut,
    createdAt: s.createdAt,
    renderedAt: s.renderedAt,
    status: s.status,
    error: s.error,
  };
}

const VALID_SNAPSHOT_TYPES: SnapshotType[] = ['mission_report', 'agent_analytics', 'system_health', 'custom'];

export function setupDashboardRoutes(app: Hono, config: DashboardRoutesConfig): void {
  const { dashboardStore, snapshotEngine, renderEngine } = config;

  // ================================================================
  // Create snapshot — capture metrics and store
  // ================================================================

  app.post('/api/dashboards/snapshots', async (c) => {
    try {
      const body = await c.req.json();
      const {
        title,
        snapshotType,
        specText,
        conversationId,
        missionId,
      } = body;

      if (!title || !snapshotType) {
        return c.json({ error: 'title and snapshotType are required' }, 400);
      }

      if (!VALID_SNAPSHOT_TYPES.includes(snapshotType)) {
        return c.json({ error: `snapshotType must be one of: ${VALID_SNAPSHOT_TYPES.join(', ')}` }, 400);
      }

      // Capture metrics based on snapshot type
      let metricsJson: string;
      try {
        switch (snapshotType) {
          case 'mission_report':
            if (!conversationId) {
              return c.json({ error: 'conversationId is required for mission_report snapshots' }, 400);
            }
            metricsJson = JSON.stringify(snapshotEngine.captureMissionReport(conversationId));
            break;
          case 'agent_analytics':
          case 'system_health': {
            const since = body.since as string | undefined;
            const until = body.until as string | undefined;
            metricsJson = JSON.stringify(snapshotEngine.captureAgentAnalytics(since, until));
            break;
          }
          case 'custom':
            if (body.metricsJson) {
              metricsJson = typeof body.metricsJson === 'string'
                ? body.metricsJson
                : JSON.stringify(body.metricsJson);
            } else {
              metricsJson = JSON.stringify(snapshotEngine.captureCustom(title, body.customData || {}));
            }
            break;
          default:
            return c.json({ error: `Unsupported snapshot type: ${snapshotType}` }, 400);
        }
      } catch (captureError) {
        console.error('[Dashboard API] Failed to capture metrics:', captureError);
        return c.json({ error: 'Failed to capture metrics' }, 500);
      }

      const spec = specText || renderEngine.getDefaultSpec(snapshotType);

      const id = dashboardStore.createSnapshot({
        title,
        snapshotType,
        specText: spec,
        metricsJson,
        conversationId,
        missionId,
      });

      const snapshot = dashboardStore.getSnapshotById(id);
      return c.json(snapshot, 201);
    } catch (error) {
      console.error('[Dashboard API] Failed to create snapshot:', error);
      return c.json({ error: 'Failed to create snapshot' }, 500);
    }
  });

  // ================================================================
  // List snapshots
  // ================================================================

  app.get('/api/dashboards/snapshots', (c) => {
    try {
      const snapshots = dashboardStore.getSnapshots({
        limit: parseInt(c.req.query('limit') || String(DASHBOARD_DEFAULT_QUERY_LIMIT)),
        missionId: c.req.query('missionId'),
        conversationId: c.req.query('conversationId'),
        snapshotType: c.req.query('snapshotType') as SnapshotType | undefined,
        status: c.req.query('status') as 'pending' | 'rendering' | 'rendered' | 'error' | undefined,
        since: c.req.query('since'),
      });

      return c.json(snapshots.map(toSnapshotSummary));
    } catch (error) {
      console.error('[Dashboard API] Failed to list snapshots:', error);
      return c.json({ error: 'Failed to list snapshots' }, 500);
    }
  });

  // ================================================================
  // Get snapshot detail
  // ================================================================

  app.get('/api/dashboards/snapshots/:id', (c) => {
    try {
      const snapshot = dashboardStore.getSnapshotById(c.req.param('id'));
      if (!snapshot) {
        return c.json({ error: 'Snapshot not found' }, 404);
      }

      // Include metricsJson and renderedHtml in detail view
      return c.json(snapshot);
    } catch (error) {
      console.error('[Dashboard API] Failed to get snapshot:', error);
      return c.json({ error: 'Failed to get snapshot' }, 500);
    }
  });

  // ================================================================
  // Trigger rendering
  // ================================================================

  app.post('/api/dashboards/snapshots/:id/render', async (c) => {
    try {
      const id = c.req.param('id');
      const snapshot = dashboardStore.getSnapshotById(id);
      if (!snapshot) {
        return c.json({ error: 'Snapshot not found' }, 404);
      }

      if (snapshot.status === 'rendering') {
        return c.json({ error: 'Snapshot is already being rendered' }, 409);
      }

      const html = await renderEngine.render(id);
      const updated = dashboardStore.getSnapshotById(id);

      return c.json({
        id: updated?.id,
        status: updated?.status,
        renderedAt: updated?.renderedAt,
        renderModel: updated?.renderModel,
        renderDurationMs: updated?.renderDurationMs,
        renderTokensIn: updated?.renderTokensIn,
        renderTokensOut: updated?.renderTokensOut,
        html,
      });
    } catch (error) {
      console.error('[Dashboard API] Failed to render snapshot:', error);
      return c.json({ error: 'Failed to render dashboard' }, 500);
    }
  });

  // ================================================================
  // Re-render with new spec (creates new version)
  // ================================================================

  app.post('/api/dashboards/snapshots/:id/rerender', async (c) => {
    try {
      const body = await c.req.json();
      const { specText } = body;
      if (!specText) {
        return c.json({ error: 'specText is required' }, 400);
      }

      const id = c.req.param('id');
      const snapshot = dashboardStore.getSnapshotById(id);
      if (!snapshot) {
        return c.json({ error: 'Snapshot not found' }, 404);
      }

      const result = await renderEngine.rerender(id, specText);
      const newSnapshot = dashboardStore.getSnapshotById(result.snapshotId);

      return c.json({
        id: newSnapshot?.id,
        version: newSnapshot?.version,
        lineageId: newSnapshot?.lineageId,
        status: newSnapshot?.status,
        renderedAt: newSnapshot?.renderedAt,
        renderModel: newSnapshot?.renderModel,
        renderDurationMs: newSnapshot?.renderDurationMs,
        renderTokensIn: newSnapshot?.renderTokensIn,
        renderTokensOut: newSnapshot?.renderTokensOut,
        html: result.html,
      }, 201);
    } catch (error) {
      console.error('[Dashboard API] Failed to re-render snapshot:', error);
      return c.json({ error: 'Failed to re-render dashboard' }, 500);
    }
  });

  // ================================================================
  // Get raw HTML for iframe src
  // ================================================================

  app.get('/api/dashboards/snapshots/:id/html', (c) => {
    try {
      const snapshot = dashboardStore.getSnapshotById(c.req.param('id'));
      if (!snapshot) {
        return c.json({ error: 'Snapshot not found' }, 404);
      }

      if (!snapshot.renderedHtml) {
        return c.json({ error: 'Dashboard has not been rendered yet' }, 404);
      }

      const fullHtml = renderEngine.wrapWithLibraries(snapshot.renderedHtml);
      return c.html(fullHtml);
    } catch (error) {
      console.error('[Dashboard API] Failed to serve dashboard HTML:', error);
      return c.json({ error: 'Failed to serve dashboard HTML' }, 500);
    }
  });

  // ================================================================
  // Delete snapshot
  // ================================================================

  app.delete('/api/dashboards/snapshots/:id', (c) => {
    try {
      const deleted = dashboardStore.deleteSnapshot(c.req.param('id'));
      if (!deleted) {
        return c.json({ error: 'Snapshot not found' }, 404);
      }
      return c.json({ success: true });
    } catch (error) {
      console.error('[Dashboard API] Failed to delete snapshot:', error);
      return c.json({ error: 'Failed to delete snapshot' }, 500);
    }
  });

  // ================================================================
  // Get all versions in a lineage
  // ================================================================

  app.get('/api/dashboards/lineage/:lineageId', (c) => {
    try {
      const snapshots = dashboardStore.getSnapshotsByLineage(c.req.param('lineageId'));
      return c.json(snapshots.map(toSnapshotSummary));
    } catch (error) {
      console.error('[Dashboard API] Failed to get lineage:', error);
      return c.json({ error: 'Failed to get dashboard lineage' }, 500);
    }
  });

  console.log('[Server] Dashboard routes registered');
}
