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
  // Mission endpoints
  // ========================================================================

  // List all missions
  app.get('/api/missions', (_req: Request, res: Response) => {
    try {
      const missions = missionManager.getMissions();
      res.json(missions);
    } catch (error) {
      console.error('[API] Failed to list missions:', error);
      res.status(500).json({ error: 'Failed to list missions' });
    }
  });

  // Get mission detail
  app.get('/api/missions/:slug', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }

      // Include pillars summary
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

        return {
          ...p,
          metrics,
          todosByStatus,
        };
      });

      res.json({ ...mission, pillars: pillarSummaries });
    } catch (error) {
      console.error('[API] Failed to get mission:', error);
      res.status(500).json({ error: 'Failed to get mission' });
    }
  });

  // Update mission
  app.put('/api/missions/:slug', (req: Request, res: Response) => {
    try {
      const updated = missionManager.updateMission(req.params.slug, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      console.error('[API] Failed to update mission:', error);
      res.status(500).json({ error: 'Failed to update mission' });
    }
  });

  // Pause mission
  app.post('/api/missions/:slug/pause', (req: Request, res: Response) => {
    try {
      const updated = missionManager.updateMission(req.params.slug, { status: 'paused' });
      if (!updated) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      console.error('[API] Failed to pause mission:', error);
      res.status(500).json({ error: 'Failed to pause mission' });
    }
  });

  // Resume mission
  app.post('/api/missions/:slug/resume', (req: Request, res: Response) => {
    try {
      const updated = missionManager.updateMission(req.params.slug, { status: 'active' });
      if (!updated) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      console.error('[API] Failed to resume mission:', error);
      res.status(500).json({ error: 'Failed to resume mission' });
    }
  });

  // Trigger manual cycle
  app.post('/api/missions/:slug/cycle', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      missionManager.emit('mission:cycle:due', { mission });
      res.json({ success: true, message: 'Cycle triggered' });
    } catch (error) {
      console.error('[API] Failed to trigger cycle:', error);
      res.status(500).json({ error: 'Failed to trigger cycle' });
    }
  });

  // ========================================================================
  // Pillar endpoints
  // ========================================================================

  // List pillars for a mission
  app.get('/api/missions/:slug/pillars', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      const pillars = missionManager.getPillarsByMission(mission.id);
      res.json(pillars);
    } catch (error) {
      console.error('[API] Failed to list pillars:', error);
      res.status(500).json({ error: 'Failed to list pillars' });
    }
  });

  // Get pillar detail
  app.get('/api/missions/:slug/pillars/:pillarSlug', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      const pillar = missionManager.getPillarBySlug(mission.id, req.params.pillarSlug);
      if (!pillar) {
        res.status(404).json({ error: 'Pillar not found' });
        return;
      }

      const metrics = missionManager.getMetricsByPillar(pillar.id);
      const strategies = missionManager.getStrategiesByPillar(pillar.id);
      const todos = missionManager.getTodosByPillar(pillar.id);

      res.json({ ...pillar, metrics, strategies, todos });
    } catch (error) {
      console.error('[API] Failed to get pillar:', error);
      res.status(500).json({ error: 'Failed to get pillar' });
    }
  });

  // Get pillar metrics with history
  app.get('/api/missions/:slug/pillars/:pillarSlug/metrics', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) { res.status(404).json({ error: 'Mission not found' }); return; }
      const pillar = missionManager.getPillarBySlug(mission.id, req.params.pillarSlug);
      if (!pillar) { res.status(404).json({ error: 'Pillar not found' }); return; }

      const metrics = missionManager.getMetricsByPillar(pillar.id);
      const metricsWithHistory = metrics.map(m => ({
        ...m,
        history: missionManager.getMetricHistory(m.id),
      }));
      res.json(metricsWithHistory);
    } catch (error) {
      console.error('[API] Failed to get metrics:', error);
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  });

  // Get pillar strategies
  app.get('/api/missions/:slug/pillars/:pillarSlug/strategies', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) { res.status(404).json({ error: 'Mission not found' }); return; }
      const pillar = missionManager.getPillarBySlug(mission.id, req.params.pillarSlug);
      if (!pillar) { res.status(404).json({ error: 'Pillar not found' }); return; }

      const strategies = missionManager.getStrategiesByPillar(pillar.id);
      res.json(strategies);
    } catch (error) {
      console.error('[API] Failed to get strategies:', error);
      res.status(500).json({ error: 'Failed to get strategies' });
    }
  });

  // Get pillar TODOs
  app.get('/api/missions/:slug/pillars/:pillarSlug/todos', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMissionBySlug(req.params.slug);
      if (!mission) { res.status(404).json({ error: 'Mission not found' }); return; }
      const pillar = missionManager.getPillarBySlug(mission.id, req.params.pillarSlug);
      if (!pillar) { res.status(404).json({ error: 'Pillar not found' }); return; }

      const todos = missionManager.getTodosByPillar(pillar.id);
      res.json(todos);
    } catch (error) {
      console.error('[API] Failed to get todos:', error);
      res.status(500).json({ error: 'Failed to get todos' });
    }
  });

  // Update a TODO
  app.put('/api/missions/:slug/pillars/:pillarSlug/todos/:todoId', (req: Request, res: Response) => {
    try {
      const updated = missionManager.updateTodo(req.params.todoId, req.body);
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
