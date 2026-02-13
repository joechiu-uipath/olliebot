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

import type { Express, Request, Response } from 'express';
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

export function setupDashboardRoutes(app: Express, config: DashboardRoutesConfig): void {
  const { dashboardStore, snapshotEngine, renderEngine } = config;

  // ================================================================
  // Create snapshot — capture metrics and store
  // ================================================================

  app.post('/api/dashboards/snapshots', (req: Request, res: Response) => {
    try {
      const {
        title,
        snapshotType,
        specText,
        conversationId,
        missionId,
      } = req.body;

      if (!title || !snapshotType) {
        res.status(400).json({ error: 'title and snapshotType are required' });
        return;
      }

      if (!VALID_SNAPSHOT_TYPES.includes(snapshotType)) {
        res.status(400).json({ error: `snapshotType must be one of: ${VALID_SNAPSHOT_TYPES.join(', ')}` });
        return;
      }

      // Capture metrics based on snapshot type
      let metricsJson: string;
      try {
        switch (snapshotType) {
          case 'mission_report':
            if (!conversationId) {
              res.status(400).json({ error: 'conversationId is required for mission_report snapshots' });
              return;
            }
            metricsJson = JSON.stringify(snapshotEngine.captureMissionReport(conversationId));
            break;
          case 'agent_analytics':
          case 'system_health': {
            const since = req.body.since as string | undefined;
            const until = req.body.until as string | undefined;
            metricsJson = JSON.stringify(snapshotEngine.captureAgentAnalytics(since, until));
            break;
          }
          case 'custom':
            if (req.body.metricsJson) {
              metricsJson = typeof req.body.metricsJson === 'string'
                ? req.body.metricsJson
                : JSON.stringify(req.body.metricsJson);
            } else {
              metricsJson = JSON.stringify(snapshotEngine.captureCustom(title, req.body.customData || {}));
            }
            break;
          default:
            res.status(400).json({ error: `Unsupported snapshot type: ${snapshotType}` });
            return;
        }
      } catch (captureError) {
        console.error('[Dashboard API] Failed to capture metrics:', captureError);
        res.status(500).json({ error: 'Failed to capture metrics' });
        return;
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
      res.status(201).json(snapshot);
    } catch (error) {
      console.error('[Dashboard API] Failed to create snapshot:', error);
      res.status(500).json({ error: 'Failed to create snapshot' });
    }
  });

  // ================================================================
  // List snapshots
  // ================================================================

  app.get('/api/dashboards/snapshots', (req: Request, res: Response) => {
    try {
      const snapshots = dashboardStore.getSnapshots({
        limit: parseInt(req.query.limit as string) || DASHBOARD_DEFAULT_QUERY_LIMIT,
        missionId: req.query.missionId as string | undefined,
        conversationId: req.query.conversationId as string | undefined,
        snapshotType: req.query.snapshotType as SnapshotType | undefined,
        status: req.query.status as 'pending' | 'rendering' | 'rendered' | 'error' | undefined,
        since: req.query.since as string | undefined,
      });

      res.json(snapshots.map(toSnapshotSummary));
    } catch (error) {
      console.error('[Dashboard API] Failed to list snapshots:', error);
      res.status(500).json({ error: 'Failed to list snapshots' });
    }
  });

  // ================================================================
  // Get snapshot detail
  // ================================================================

  app.get('/api/dashboards/snapshots/:id', (req: Request, res: Response) => {
    try {
      const snapshot = dashboardStore.getSnapshotById(req.params.id);
      if (!snapshot) {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }

      // Include metricsJson and renderedHtml in detail view
      res.json(snapshot);
    } catch (error) {
      console.error('[Dashboard API] Failed to get snapshot:', error);
      res.status(500).json({ error: 'Failed to get snapshot' });
    }
  });

  // ================================================================
  // Trigger rendering
  // ================================================================

  app.post('/api/dashboards/snapshots/:id/render', async (req: Request, res: Response) => {
    try {
      const snapshot = dashboardStore.getSnapshotById(req.params.id);
      if (!snapshot) {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }

      if (snapshot.status === 'rendering') {
        res.status(409).json({ error: 'Snapshot is already being rendered' });
        return;
      }

      const html = await renderEngine.render(req.params.id);
      const updated = dashboardStore.getSnapshotById(req.params.id);

      res.json({
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
      res.status(500).json({ error: 'Failed to render dashboard' });
    }
  });

  // ================================================================
  // Re-render with new spec (creates new version)
  // ================================================================

  app.post('/api/dashboards/snapshots/:id/rerender', async (req: Request, res: Response) => {
    try {
      const { specText } = req.body;
      if (!specText) {
        res.status(400).json({ error: 'specText is required' });
        return;
      }

      const snapshot = dashboardStore.getSnapshotById(req.params.id);
      if (!snapshot) {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }

      const result = await renderEngine.rerender(req.params.id, specText);
      const newSnapshot = dashboardStore.getSnapshotById(result.snapshotId);

      res.status(201).json({
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
      });
    } catch (error) {
      console.error('[Dashboard API] Failed to re-render snapshot:', error);
      res.status(500).json({ error: 'Failed to re-render dashboard' });
    }
  });

  // ================================================================
  // Get raw HTML for iframe src
  // ================================================================

  app.get('/api/dashboards/snapshots/:id/html', (req: Request, res: Response) => {
    try {
      const snapshot = dashboardStore.getSnapshotById(req.params.id);
      if (!snapshot) {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }

      if (!snapshot.renderedHtml) {
        res.status(404).json({ error: 'Dashboard has not been rendered yet' });
        return;
      }

      const fullHtml = renderEngine.wrapWithLibraries(snapshot.renderedHtml);
      res.type('html').send(fullHtml);
    } catch (error) {
      console.error('[Dashboard API] Failed to serve dashboard HTML:', error);
      res.status(500).json({ error: 'Failed to serve dashboard HTML' });
    }
  });

  // ================================================================
  // Delete snapshot
  // ================================================================

  app.delete('/api/dashboards/snapshots/:id', (req: Request, res: Response) => {
    try {
      const deleted = dashboardStore.deleteSnapshot(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Dashboard API] Failed to delete snapshot:', error);
      res.status(500).json({ error: 'Failed to delete snapshot' });
    }
  });

  // ================================================================
  // Get all versions in a lineage
  // ================================================================

  app.get('/api/dashboards/lineage/:lineageId', (req: Request, res: Response) => {
    try {
      const snapshots = dashboardStore.getSnapshotsByLineage(req.params.lineageId);
      res.json(snapshots.map(toSnapshotSummary));
    } catch (error) {
      console.error('[Dashboard API] Failed to get lineage:', error);
      res.status(500).json({ error: 'Failed to get dashboard lineage' });
    }
  });

  console.log('[Server] Dashboard routes registered');
}
