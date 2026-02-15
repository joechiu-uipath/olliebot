/**
 * Mission API Routes
 *
 * REST endpoints for the Mission system (Level 4 continuous agent).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { existsSync, readFileSync } from 'fs';
import type { MissionManager } from '../missions/index.js';
import { getDashboardStore, RenderEngine } from '../dashboard/index.js';
import type { LLMService } from '../llm/service.js';

export interface MissionRoutesConfig {
  missionManager: MissionManager;
  llmService?: LLMService;
}

export function setupMissionRoutes(app: Hono, config: MissionRoutesConfig): void {
  const { missionManager, llmService } = config;

  // Dashboard store and render engine for database-backed dashboards
  const dashboardStore = getDashboardStore();
  const renderEngine = llmService ? new RenderEngine(llmService, dashboardStore) : null;

  // ========================================================================
  // Helpers — eliminate repeated mission/pillar lookup boilerplate
  // ========================================================================

  type Mission = ReturnType<typeof missionManager.getMissionBySlug>;
  type Pillar = ReturnType<typeof missionManager.getPillarBySlug>;

  /** Wraps a handler that needs a resolved mission */
  function withMission(handler: (c: Context, mission: NonNullable<Mission>) => Response | Promise<Response>) {
    return (c: Context) => {
      try {
        const slug = c.req.param('slug');
        const mission = missionManager.getMissionBySlug(slug);
        if (!mission) {
          return c.json({ error: 'Mission not found' }, 404);
        }
        return handler(c, mission);
      } catch (error) {
        console.error(`[API] Mission route error:`, error);
        return c.json({ error: 'Internal server error' }, 500);
      }
    };
  }

  /** Wraps a handler that needs a resolved mission + pillar */
  function withPillar(handler: (c: Context, mission: NonNullable<Mission>, pillar: NonNullable<Pillar>) => Response | Promise<Response>) {
    return withMission((c, mission) => {
      const pillarSlug = c.req.param('pillarSlug');
      const pillar = missionManager.getPillarBySlug(mission.id, pillarSlug);
      if (!pillar) {
        return c.json({ error: 'Pillar not found' }, 404);
      }
      return handler(c, mission, pillar);
    });
  }

  // ========================================================================
  // Mission endpoints
  // ========================================================================

  // List all missions (includes pillar count for sidebar display)
  app.get('/api/missions', (c) => {
    try {
      const missions = missionManager.getMissions();
      const enriched = missions.map(m => ({
        ...m,
        pillarCount: missionManager.getPillarsByMission(m.id).length,
      }));
      return c.json(enriched);
    } catch (error) {
      console.error('[API] Failed to list missions:', error);
      return c.json({ error: 'Failed to list missions' }, 500);
    }
  });

  // Get mission detail
  app.get('/api/missions/:slug', withMission((c, mission) => {
    const pillars = missionManager.getPillarsByMission(mission.id);
    const pillarSummaries = pillars.map(p => {
      const summary = missionManager.getPillarSummary(p.id);
      return { ...p, metrics: summary.metrics, todosByStatus: summary.todosByStatus };
    });

    return c.json({ ...mission, pillars: pillarSummaries });
  }));

  // Update mission (whitelisted fields only)
  app.put('/api/missions/:slug', withMission(async (c, mission) => {
    const body = await c.req.json();
    const updated = missionManager.updateMission(mission.slug, body);
    return c.json(updated);
  }));

  // Pause mission
  app.post('/api/missions/:slug/pause', withMission((c, mission) => {
    const updated = missionManager.updateMission(mission.slug, { status: 'paused' });
    return c.json(updated);
  }));

  // Resume mission
  app.post('/api/missions/:slug/resume', withMission((c, mission) => {
    const updated = missionManager.updateMission(mission.slug, { status: 'active' });
    return c.json(updated);
  }));

  // Trigger manual cycle
  app.post('/api/missions/:slug/cycle', withMission((c, mission) => {
    missionManager.emit('mission:cycle:due', { mission });
    return c.json({ success: true, message: 'Cycle triggered' });
  }));

  // ========================================================================
  // Pillar endpoints
  // ========================================================================

  // List pillars for a mission
  app.get('/api/missions/:slug/pillars', withMission((c, mission) => {
    const pillars = missionManager.getPillarsByMission(mission.id);
    return c.json(pillars);
  }));

  // Get pillar detail
  app.get('/api/missions/:slug/pillars/:pillarSlug', withPillar((c, mission, pillar) => {
    const summary = missionManager.getPillarSummary(pillar.id);
    return c.json({ ...pillar, ...summary });
  }));

  // Get pillar metrics with history
  app.get('/api/missions/:slug/pillars/:pillarSlug/metrics', withPillar((c, mission, pillar) => {
    const metrics = missionManager.getMetricsByPillar(pillar.id);
    const metricsWithHistory = metrics.map(m => ({
      ...m,
      history: missionManager.getMetricHistory(m.id),
    }));
    return c.json(metricsWithHistory);
  }));

  // Get pillar strategies
  app.get('/api/missions/:slug/pillars/:pillarSlug/strategies', withPillar((c, mission, pillar) => {
    const strategies = missionManager.getStrategiesByPillar(pillar.id);
    return c.json(strategies);
  }));

  // Get pillar TODOs
  app.get('/api/missions/:slug/pillars/:pillarSlug/todos', withPillar((c, mission, pillar) => {
    const todos = missionManager.getTodosByPillar(pillar.id);
    return c.json(todos);
  }));

  // Create a TODO (used by Mission Lead agent programmatically)
  app.post('/api/missions/:slug/pillars/:pillarSlug/todos', withPillar(async (c, mission, pillar) => {
    const body = await c.req.json();
    const { title, description, priority, justification, completionCriteria } = body;
    if (!title) {
      return c.json({ error: 'title is required' }, 400);
    }
    const todo = missionManager.createTodo({
      pillarId: pillar.id,
      missionId: mission.id,
      title,
      description: description || '',
      justification: justification || '',
      completionCriteria: completionCriteria || '',
      status: 'pending',
      priority: priority || 'medium',
      outcome: null,
    });
    return c.json(todo, 201);
  }));

  // Update a TODO (whitelisted fields only)
  app.put('/api/missions/:slug/pillars/:pillarSlug/todos/:todoId', async (c) => {
    try {
      const todoId = c.req.param('todoId');
      const body = await c.req.json();
      const updated = missionManager.updateTodo(todoId, body);
      if (!updated) {
        return c.json({ error: 'TODO not found' }, 404);
      }
      return c.json(updated);
    } catch (error) {
      console.error('[API] Failed to update todo:', error);
      return c.json({ error: 'Failed to update todo' }, 500);
    }
  });

  // ========================================================================
  // Dashboard endpoints
  // ========================================================================

  /**
   * Helper: Try to serve a dashboard from the database (created by mission_update_dashboard tool).
   * Returns the HTML string if found, null if should fall back to file-based.
   */
  function tryGetDatabaseDashboard(missionId: string, conversationId: string): string | null {
    if (!renderEngine) return null;

    // Try to find a rendered snapshot by missionId first, then conversationId
    let snapshots = dashboardStore.getSnapshots({ missionId, limit: 1 });
    if (snapshots.length === 0) {
      snapshots = dashboardStore.getSnapshots({ conversationId, limit: 1 });
    }

    if (snapshots.length > 0) {
      const snapshot = snapshots[0];
      if (snapshot.status === 'rendered' && snapshot.renderedHtml) {
        return renderEngine.wrapWithLibraries(snapshot.renderedHtml);
      }
    }

    return null;
  }

  // Serve mission dashboard HTML
  app.get('/api/missions/:slug/dashboard', (c) => {
    try {
      const slug = c.req.param('slug');
      const mission = missionManager.getMissionBySlug(slug);
      if (!mission) {
        return c.json({ error: 'Mission not found' }, 404);
      }

      // Try database-backed dashboard first (from mission_update_dashboard tool)
      const dbHtml = tryGetDatabaseDashboard(mission.id, mission.conversationId);
      if (dbHtml) {
        return c.html(dbHtml);
      }

      // Fall back to file-based dashboard
      const htmlPath = missionManager.getMissionDashboardPath(slug);
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf-8');
        return c.html(html);
      } else {
        return c.json({ error: 'Dashboard not generated yet' }, 404);
      }
    } catch (error) {
      console.error('[API] Failed to serve mission dashboard:', error);
      return c.json({ error: 'Failed to serve dashboard' }, 500);
    }
  });

  // Serve pillar dashboard HTML
  app.get('/api/missions/:slug/pillars/:pillarSlug/dashboard', (c) => {
    try {
      const slug = c.req.param('slug');
      const pillarSlug = c.req.param('pillarSlug');

      const mission = missionManager.getMissionBySlug(slug);
      if (!mission) {
        return c.json({ error: 'Mission not found' }, 404);
      }

      const pillar = missionManager.getPillarBySlug(mission.id, pillarSlug);
      if (!pillar) {
        return c.json({ error: 'Pillar not found' }, 404);
      }

      // Try database-backed dashboard first (from mission_update_dashboard tool)
      const dbHtml = tryGetDatabaseDashboard(mission.id, pillar.conversationId);
      if (dbHtml) {
        return c.html(dbHtml);
      }

      // Fall back to file-based dashboard
      const htmlPath = missionManager.getPillarDashboardPath(slug, pillarSlug);
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf-8');
        return c.html(html);
      } else {
        return c.json({ error: 'Dashboard not generated yet' }, 404);
      }
    } catch (error) {
      console.error('[API] Failed to serve pillar dashboard:', error);
      return c.json({ error: 'Failed to serve dashboard' }, 500);
    }
  });

  console.log('[Server] Mission routes registered');
}
