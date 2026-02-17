/**
 * API Tests — Mission Routes
 *
 * Covers the full mission REST API using the ServerHarness
 * (real LLMService + ToolRunner + MissionManager backed by simulator).
 *
 * Tests exercise:
 *   - Mission CRUD: list, get by slug, update, pause/resume
 *   - Pillar endpoints: list, detail, metrics, strategies, todos
 *   - TODO create/update lifecycle
 *   - Error handling: 404 for unknown missions/pillars
 *   - Mission cycle trigger
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness, seedMission, seedPillar, seedMetric, seedTodo } from '../harness/index.js';
import { HTTP_STATUS, TIMEOUTS, waitFor } from '../harness/index.js';
import { getDb } from '../../src/db/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Mission Routes', () => {
  describe('mission CRUD', () => {
    it('GET /api/missions returns empty array when no missions exist', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/missions');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body).toEqual([]);
    });

    it('GET /api/missions returns seeded missions with pillar count', async () => {
      const missionId = seedMission({ slug: 'test-mission', name: 'Test Mission' });
      seedPillar({ missionId, slug: 'perf', name: 'Performance' });
      seedPillar({ missionId, slug: 'qual', name: 'Quality' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ slug: string; name: string; pillarCount: number }>>(
        '/api/missions',
      );

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBe(1);
      expect(body[0].slug).toBe('test-mission');
      expect(body[0].name).toBe('Test Mission');
      expect(body[0].pillarCount).toBe(2);
    });

    it('GET /api/missions/:slug returns mission detail with pillars', async () => {
      const missionId = seedMission({ slug: 'detail-test', name: 'Detail Test' });
      const pillarId = seedPillar({ missionId, slug: 'p1', name: 'Pillar One' });
      seedTodo({ pillarId, missionId, title: 'Do something' });

      const api = harness.api();
      const { status, body } = await api.getJson<{
        slug: string;
        name: string;
        pillars: Array<{
          slug: string;
          name: string;
          todosByStatus: Record<string, number>;
        }>;
      }>('/api/missions/detail-test');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.slug).toBe('detail-test');
      expect(body.pillars.length).toBe(1);
      expect(body.pillars[0].slug).toBe('p1');
      expect(body.pillars[0].todosByStatus.pending).toBe(1);
    });

    it('GET /api/missions/:slug returns 404 for unknown slug', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/missions/nonexistent');
      expect(status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('PUT /api/missions/:slug updates mission fields', async () => {
      seedMission({ slug: 'updatable', name: 'Original Name' });

      // Mission routes use PUT, not PATCH
      const res = await fetch(`${harness.baseUrl}/api/missions/updatable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name', description: 'New description' }),
      });
      const updated = await res.json();

      expect(res.status).toBe(HTTP_STATUS.OK);
      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
    });

    it('POST /api/missions/:slug/pause pauses an active mission', async () => {
      seedMission({ slug: 'pausable', name: 'Pausable Mission', status: 'active' });

      const api = harness.api();
      const res = await api.postJson<{ status: string }>('/api/missions/pausable/pause');

      expect(res.status).toBe(HTTP_STATUS.OK);
      expect(res.body.status).toBe('paused');
    });

    it('POST /api/missions/:slug/resume resumes a paused mission', async () => {
      seedMission({ slug: 'resumable', name: 'Resumable Mission', status: 'paused' });

      const api = harness.api();
      const res = await api.postJson<{ status: string }>('/api/missions/resumable/resume');

      expect(res.status).toBe(HTTP_STATUS.OK);
      expect(res.body.status).toBe('active');
    });

    it('POST /api/missions/:slug/cycle triggers a cycle event', async () => {
      seedMission({ slug: 'cyclable', name: 'Cyclable Mission' });

      const api = harness.api();
      const res = await api.postJson<{ success: boolean; message: string }>(
        '/api/missions/cyclable/cycle',
      );

      expect(res.status).toBe(HTTP_STATUS.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Cycle triggered');
    });
  });

  describe('pillar endpoints', () => {
    it('GET /api/missions/:slug/pillars lists pillars', async () => {
      const missionId = seedMission({ slug: 'with-pillars', name: 'With Pillars' });
      seedPillar({ missionId, slug: 'p1', name: 'Pillar 1' });
      seedPillar({ missionId, slug: 'p2', name: 'Pillar 2' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ slug: string; name: string }>>(
        '/api/missions/with-pillars/pillars',
      );

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBe(2);
    });

    it('GET /api/missions/:slug/pillars/:pillarSlug returns pillar detail with summary', async () => {
      const missionId = seedMission({ slug: 'pillar-detail', name: 'Pillar Detail' });
      const pillarId = seedPillar({ missionId, slug: 'pd1', name: 'Detail Pillar' });
      seedMetric({ pillarId, slug: 'resp-time', name: 'Response Time', current: 150 });
      seedTodo({ pillarId, missionId, title: 'Fix latency', status: 'in_progress' });

      const api = harness.api();
      const { status, body } = await api.getJson<{
        slug: string;
        metrics: Array<{ name: string; current: number }>;
        todosByStatus: Record<string, number>;
      }>('/api/missions/pillar-detail/pillars/pd1');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.slug).toBe('pd1');
      expect(body.metrics.length).toBe(1);
      expect(body.metrics[0].current).toBe(150);
      expect(body.todosByStatus.in_progress).toBe(1);
    });

    it('GET /api/missions/:slug/pillars/:pillarSlug returns 404 for unknown pillar', async () => {
      seedMission({ slug: 'exists', name: 'Exists' });

      const api = harness.api();
      const { status } = await api.getJson('/api/missions/exists/pillars/ghost');
      expect(status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('GET pillar metrics returns metrics with history', async () => {
      const missionId = seedMission({ slug: 'met-test', name: 'Metric Test' });
      const pillarId = seedPillar({ missionId, slug: 'mp', name: 'Metric Pillar' });
      const metricId = seedMetric({ pillarId, slug: 'uptime', name: 'Uptime', current: 99.5 });

      // Seed metric history
      const db = getDb();
      for (let i = 0; i < 3; i++) {
        db.rawRun(
          'INSERT INTO pillar_metric_history (id, metricId, value, timestamp) VALUES (?, ?, ?, ?)',
          [`hist-${i}`, metricId, 98 + i, new Date(Date.now() + i * 60000).toISOString()],
        );
      }

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{
        name: string;
        current: number;
        history: Array<{ value: number }>;
      }>>('/api/missions/met-test/pillars/mp/metrics');

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('Uptime');
      expect(body[0].history.length).toBe(3);
    });

    it('GET pillar strategies returns strategies', async () => {
      const missionId = seedMission({ slug: 'strat-test', name: 'Strategy Test' });
      const pillarId = seedPillar({ missionId, slug: 'sp', name: 'Strategy Pillar' });

      // Seed a strategy
      const db = getDb();
      const now = new Date().toISOString();
      db.rawRun(
        'INSERT INTO pillar_strategies (id, pillarId, description, status, lastReviewedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        ['strat-1', pillarId, 'Optimize caching', 'active', now, now],
      );

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ description: string; status: string }>>(
        '/api/missions/strat-test/pillars/sp/strategies',
      );

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBe(1);
      expect(body[0].description).toBe('Optimize caching');
      expect(body[0].status).toBe('active');
    });
  });

  describe('TODO CRUD', () => {
    it('GET pillar todos returns seeded todos', async () => {
      const missionId = seedMission({ slug: 'todo-list', name: 'Todo List' });
      const pillarId = seedPillar({ missionId, slug: 'tp', name: 'Todo Pillar' });
      seedTodo({ pillarId, missionId, title: 'Task A', status: 'pending' });
      seedTodo({ pillarId, missionId, title: 'Task B', status: 'completed' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ title: string; status: string }>>(
        '/api/missions/todo-list/pillars/tp/todos',
      );

      expect(status).toBe(HTTP_STATUS.OK);
      expect(body.length).toBe(2);
    });

    it('POST creates a new TODO', async () => {
      const missionId = seedMission({ slug: 'todo-create', name: 'Todo Create' });
      seedPillar({ missionId, slug: 'cp', name: 'Create Pillar' });

      const api = harness.api();
      const res = await api.postJson<{ id: string; title: string; status: string; priority: string }>(
        '/api/missions/todo-create/pillars/cp/todos',
        { title: 'New Task', priority: 'high' },
      );

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Task');
      expect(res.body.status).toBe('pending');
      expect(res.body.priority).toBe('high');
      expect(res.body.id).toBeTruthy();
    });

    it('POST without title returns 400', async () => {
      const missionId = seedMission({ slug: 'todo-validate', name: 'Todo Validate' });
      seedPillar({ missionId, slug: 'vp', name: 'Validate Pillar' });

      const api = harness.api();
      const res = await api.postJson<{ error: string }>(
        '/api/missions/todo-validate/pillars/vp/todos',
        { description: 'Missing title' },
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('title');
    });

    it('PUT updates a TODO', async () => {
      const missionId = seedMission({ slug: 'todo-update', name: 'Todo Update' });
      const pillarId = seedPillar({ missionId, slug: 'up', name: 'Update Pillar' });
      const todoId = seedTodo({ pillarId, missionId, title: 'Original', status: 'pending' });

      const res = await fetch(
        `${harness.baseUrl}/api/missions/todo-update/pillars/up/todos/${todoId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress' }),
        },
      );

      expect(res.status).toBe(HTTP_STATUS.OK);
      const body = await res.json();
      expect(body.status).toBe('in_progress');
    });

    it('PUT returns 404 for unknown todo ID', async () => {
      const missionId = seedMission({ slug: 'todo-ghost', name: 'Todo Ghost' });
      seedPillar({ missionId, slug: 'gp', name: 'Ghost Pillar' });

      const res = await fetch(
        `${harness.baseUrl}/api/missions/todo-ghost/pillars/gp/todos/nonexistent`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        },
      );

      expect(res.status).toBe(404);
    });
  });

  describe('dashboard endpoints', () => {
    it('GET /api/missions/:slug/dashboard returns 404 when no dashboard exists', async () => {
      seedMission({ slug: 'no-dash', name: 'No Dashboard' });

      const api = harness.api();
      const { status } = await api.getJson('/api/missions/no-dash/dashboard');
      expect(status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('GET pillar dashboard returns 404 when no dashboard exists', async () => {
      const missionId = seedMission({ slug: 'no-pdash', name: 'No Pillar Dashboard' });
      seedPillar({ missionId, slug: 'nodp', name: 'No Dashboard Pillar' });

      const api = harness.api();
      const { status } = await api.getJson('/api/missions/no-pdash/pillars/nodp/dashboard');
      expect(status).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });
});
