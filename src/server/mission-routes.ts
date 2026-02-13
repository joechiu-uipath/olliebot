/**
 * Mission API Routes
 *
 * REST endpoints for the Mission system (Level 4 continuous agent).
 */

import type { Express, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import type { MissionManager } from '../missions/index.js';

export interface MissionRoutesConfig {
  missionManager: MissionManager;
}

export function setupMissionRoutes(app: Express, config: MissionRoutesConfig): void {
  const { missionManager } = config;

  // ========================================================================
  // Helpers — eliminate repeated mission/pillar lookup boilerplate
  // ========================================================================

  type RouteHandler = (req: Request, res: Response) => void;

  /** Wraps a handler that needs a resolved mission */
  function withMission(handler: (req: Request, res: Response, mission: ReturnType<typeof missionManager.getMissionBySlug> & {}) => void): RouteHandler {
    return (req, res) => {
      try {
        const mission = missionManager.getMissionBySlug(req.params.slug);
        if (!mission) {
          res.status(404).json({ error: 'Mission not found' });
          return;
        }
        handler(req, res, mission);
      } catch (error) {
        console.error(`[API] Mission route error:`, error);
        res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /** Wraps a handler that needs a resolved mission + pillar */
  function withPillar(handler: (req: Request, res: Response, mission: any, pillar: any) => void): RouteHandler {
    return withMission((req, res, mission) => {
      const pillar = missionManager.getPillarBySlug(mission.id, req.params.pillarSlug);
      if (!pillar) {
        res.status(404).json({ error: 'Pillar not found' });
        return;
      }
      handler(req, res, mission, pillar);
    });
  }

  // ========================================================================
  // Mission endpoints
  // ========================================================================

  // List all missions (includes pillar count for sidebar display)
  app.get('/api/missions', (_req: Request, res: Response) => {
    try {
      const missions = missionManager.getMissions();
      const enriched = missions.map(m => ({
        ...m,
        pillarCount: missionManager.getPillarsByMission(m.id).length,
      }));
      res.json(enriched);
    } catch (error) {
      console.error('[API] Failed to list missions:', error);
      res.status(500).json({ error: 'Failed to list missions' });
    }
  });

  // Get mission detail
  app.get('/api/missions/:slug', withMission((req, res, mission) => {
    const pillars = missionManager.getPillarsByMission(mission.id);
    const pillarSummaries = pillars.map(p => {
      const metrics = missionManager.getMetricsByPillar(p.id);
      const todos = missionManager.getTodosByPillar(p.id);
      const todosByStatus = {
        pending: todos.filter(t => t.status === 'pending').length,
        in_progress: todos.filter(t => t.status === 'in_progress').length,
        completed: todos.filter(t => t.status === 'completed').length,
        blocked: todos.filter(t => t.status === 'blocked').length,
      };
      return { ...p, metrics, todosByStatus };
    });

    res.json({ ...mission, pillars: pillarSummaries });
  }));

  // Update mission (whitelisted fields only)
  app.put('/api/missions/:slug', withMission((req, res, mission) => {
    const updated = missionManager.updateMission(req.params.slug, req.body);
    res.json(updated);
  }));

  // Pause mission
  app.post('/api/missions/:slug/pause', withMission((req, res, mission) => {
    const updated = missionManager.updateMission(req.params.slug, { status: 'paused' });
    res.json(updated);
  }));

  // Resume mission
  app.post('/api/missions/:slug/resume', withMission((req, res, mission) => {
    const updated = missionManager.updateMission(req.params.slug, { status: 'active' });
    res.json(updated);
  }));

  // Trigger manual cycle
  app.post('/api/missions/:slug/cycle', withMission((req, res, mission) => {
    missionManager.emit('mission:cycle:due', { mission });
    res.json({ success: true, message: 'Cycle triggered' });
  }));

  // ========================================================================
  // Pillar endpoints
  // ========================================================================

  // List pillars for a mission
  app.get('/api/missions/:slug/pillars', withMission((req, res, mission) => {
    const pillars = missionManager.getPillarsByMission(mission.id);
    res.json(pillars);
  }));

  // Get pillar detail
  app.get('/api/missions/:slug/pillars/:pillarSlug', withPillar((req, res, mission, pillar) => {
    const metrics = missionManager.getMetricsByPillar(pillar.id);
    const strategies = missionManager.getStrategiesByPillar(pillar.id);
    const todos = missionManager.getTodosByPillar(pillar.id);
    res.json({ ...pillar, metrics, strategies, todos });
  }));

  // Get pillar metrics with history
  app.get('/api/missions/:slug/pillars/:pillarSlug/metrics', withPillar((req, res, mission, pillar) => {
    const metrics = missionManager.getMetricsByPillar(pillar.id);
    const metricsWithHistory = metrics.map(m => ({
      ...m,
      history: missionManager.getMetricHistory(m.id),
    }));
    res.json(metricsWithHistory);
  }));

  // Get pillar strategies
  app.get('/api/missions/:slug/pillars/:pillarSlug/strategies', withPillar((req, res, mission, pillar) => {
    const strategies = missionManager.getStrategiesByPillar(pillar.id);
    res.json(strategies);
  }));

  // Get pillar TODOs
  app.get('/api/missions/:slug/pillars/:pillarSlug/todos', withPillar((req, res, mission, pillar) => {
    const todos = missionManager.getTodosByPillar(pillar.id);
    res.json(todos);
  }));

  // Create a TODO (used by Mission Lead agent programmatically)
  app.post('/api/missions/:slug/pillars/:pillarSlug/todos', withPillar((req, res, mission, pillar) => {
    const { title, description, priority, assignedAgent } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const todo = missionManager.createTodo({
      pillarId: pillar.id,
      missionId: mission.id,
      title,
      description: description || '',
      status: 'pending',
      priority: priority || 'medium',
      assignedAgent: assignedAgent || null,
      conversationId: null,
      outcome: null,
    });
    res.status(201).json(todo);
  }));

  // Update a TODO (whitelisted fields only)
  app.put('/api/missions/:slug/pillars/:pillarSlug/todos/:todoId', (_req: Request, res: Response) => {
    try {
      const updated = missionManager.updateTodo(_req.params.todoId, _req.body);
      if (!updated) {
        res.status(404).json({ error: 'TODO not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      console.error('[API] Failed to update todo:', error);
      res.status(500).json({ error: 'Failed to update todo' });
    }
  });

  // ========================================================================
  // Dashboard endpoints
  // ========================================================================

  // Serve mission dashboard HTML
  app.get('/api/missions/:slug/dashboard', (req: Request, res: Response) => {
    try {
      const htmlPath = missionManager.getMissionDashboardPath(req.params.slug);
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf-8');
        res.type('html').send(html);
      } else {
        res.status(404).json({ error: 'Dashboard not generated yet' });
      }
    } catch (error) {
      console.error('[API] Failed to serve mission dashboard:', error);
      res.status(500).json({ error: 'Failed to serve dashboard' });
    }
  });

  // Serve pillar dashboard HTML
  app.get('/api/missions/:slug/pillars/:pillarSlug/dashboard', (req: Request, res: Response) => {
    try {
      const htmlPath = missionManager.getPillarDashboardPath(req.params.slug, req.params.pillarSlug);
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, 'utf-8');
        res.type('html').send(html);
      } else {
        res.status(404).json({ error: 'Dashboard not generated yet' });
      }
    } catch (error) {
      console.error('[API] Failed to serve pillar dashboard:', error);
      res.status(500).json({ error: 'Failed to serve dashboard' });
    }
  });

  console.log('[Server] Mission routes registered');
}
