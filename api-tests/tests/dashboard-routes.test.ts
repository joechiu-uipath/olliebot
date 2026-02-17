/**
 * API Tests — Dashboard Routes
 *
 * Covers the dashboard REST API endpoints using the FullServerHarness.
 * The FullServerHarness boots with TraceStore + LLMService, which enables
 * the dashboard routes (POST/GET/DELETE snapshots, lineage queries).
 *
 * Tests exercise:
 *   - Snapshot creation with validation (title, snapshotType required)
 *   - Snapshot type validation (must be known type)
 *   - Listing snapshots (empty state, with filters)
 *   - Snapshot detail and 404
 *   - Snapshot deletion and 404
 *   - Lineage query (version history)
 *   - Custom snapshot creation with metricsJson
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { FullServerHarness } from '../harness/index.js';
import { getDb } from '../../src/db/index.js';

const harness = new FullServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

// ---------------------------------------------------------------------------
// Seed helpers — insert dashboard snapshots directly
// ---------------------------------------------------------------------------

function seedSnapshot(opts: {
  id: string;
  title: string;
  snapshotType?: string;
  missionId?: string;
  conversationId?: string;
  status?: string;
  metricsJson?: string;
  specText?: string;
  lineageId?: string;
  version?: number;
  renderedHtml?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.rawRun(
    `INSERT INTO dashboard_snapshots
      (id, conversationId, missionId, title, snapshotType, version, lineageId, metricsJson, specText, renderedHtml, createdAt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.conversationId ?? null,
      opts.missionId ?? null,
      opts.title,
      opts.snapshotType ?? 'custom',
      opts.version ?? 1,
      opts.lineageId ?? opts.id,
      opts.metricsJson ?? '{}',
      opts.specText ?? 'Default spec',
      opts.renderedHtml ?? null,
      now,
      opts.status ?? 'pending',
    ],
  );
}

describe('Dashboard Routes', () => {
  describe('POST /api/dashboards/snapshots', () => {
    it('returns 400 when title is missing', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots',
        { snapshotType: 'custom' },
      );

      expect(status).toBe(400);
      expect(body.error).toContain('title');
    });

    it('returns 400 when snapshotType is missing', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots',
        { title: 'My Dashboard' },
      );

      expect(status).toBe(400);
      expect(body.error).toContain('snapshotType');
    });

    it('returns 400 for invalid snapshotType', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots',
        { title: 'Test', snapshotType: 'invalid_type' },
      );

      expect(status).toBe(400);
      expect(body.error).toContain('snapshotType must be one of');
    });

    it('creates a custom snapshot with provided metricsJson', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{
        id: string;
        title: string;
        snapshotType: string;
        status: string;
      }>(
        '/api/dashboards/snapshots',
        {
          title: 'Custom Dashboard',
          snapshotType: 'custom',
          metricsJson: { customKey: 'customValue', count: 42 },
        },
      );

      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      expect(body.title).toBe('Custom Dashboard');
      expect(body.snapshotType).toBe('custom');
      expect(body.status).toBe('pending');
    });

    it('creates an agent_analytics snapshot', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{
        id: string;
        snapshotType: string;
      }>(
        '/api/dashboards/snapshots',
        { title: 'Agent Analytics', snapshotType: 'agent_analytics' },
      );

      expect(status).toBe(201);
      expect(body.snapshotType).toBe('agent_analytics');
    });

    it('creates a system_health snapshot', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{
        id: string;
        snapshotType: string;
      }>(
        '/api/dashboards/snapshots',
        { title: 'System Health', snapshotType: 'system_health' },
      );

      expect(status).toBe(201);
      expect(body.snapshotType).toBe('system_health');
    });

    it('mission_report requires conversationId', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots',
        { title: 'Mission Report', snapshotType: 'mission_report' },
      );

      expect(status).toBe(400);
      expect(body.error).toContain('conversationId');
    });

    it('creates a mission_report snapshot with conversationId', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{
        id: string;
        snapshotType: string;
        conversationId: string;
      }>(
        '/api/dashboards/snapshots',
        { title: 'Mission Report', snapshotType: 'mission_report', conversationId: 'conv-123' },
      );

      expect(status).toBe(201);
      expect(body.snapshotType).toBe('mission_report');
    });
  });

  describe('GET /api/dashboards/snapshots', () => {
    it('returns empty array when no snapshots exist', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/dashboards/snapshots');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns seeded snapshots as summaries (no renderedHtml/metricsJson)', async () => {
      seedSnapshot({ id: 'snap-1', title: 'Dashboard A', renderedHtml: '<h1>A</h1>' });
      seedSnapshot({ id: 'snap-2', title: 'Dashboard B' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; title: string; renderedHtml?: string; metricsJson?: string }>>('/api/dashboards/snapshots');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
      // Summaries should not include heavy fields
      for (const snap of body) {
        expect(snap).not.toHaveProperty('renderedHtml');
        expect(snap).not.toHaveProperty('metricsJson');
      }
    });

    it('filters by snapshotType', async () => {
      seedSnapshot({ id: 'snap-cust', title: 'Custom', snapshotType: 'custom' });
      seedSnapshot({ id: 'snap-health', title: 'Health', snapshotType: 'system_health' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/dashboards/snapshots?snapshotType=system_health');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('snap-health');
    });

    it('filters by missionId', async () => {
      seedSnapshot({ id: 'snap-m1', title: 'M1', missionId: 'mission-1' });
      seedSnapshot({ id: 'snap-m2', title: 'M2', missionId: 'mission-2' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/dashboards/snapshots?missionId=mission-1');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('snap-m1');
    });

    it('filters by status', async () => {
      seedSnapshot({ id: 'snap-pending', title: 'Pending', status: 'pending' });
      seedSnapshot({ id: 'snap-rendered', title: 'Rendered', status: 'rendered' });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string }>>('/api/dashboards/snapshots?status=rendered');

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('snap-rendered');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        seedSnapshot({ id: `snap-lim-${i}`, title: `Snap ${i}` });
      }

      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/dashboards/snapshots?limit=2');

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
    });
  });

  describe('GET /api/dashboards/snapshots/:id', () => {
    it('returns full snapshot detail including metricsJson', async () => {
      seedSnapshot({
        id: 'snap-detail',
        title: 'Detail Test',
        metricsJson: '{"key":"value"}',
        renderedHtml: '<h1>Test</h1>',
        status: 'rendered',
      });

      const api = harness.api();
      const { status, body } = await api.getJson<{
        id: string;
        title: string;
        metricsJson: string;
        renderedHtml: string;
      }>('/api/dashboards/snapshots/snap-detail');

      expect(status).toBe(200);
      expect(body.id).toBe('snap-detail');
      expect(body.title).toBe('Detail Test');
      expect(body.metricsJson).toBe('{"key":"value"}');
      expect(body.renderedHtml).toBe('<h1>Test</h1>');
    });

    it('returns 404 for unknown snapshot', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ error: string }>('/api/dashboards/snapshots/nonexistent');

      expect(status).toBe(404);
      expect(body.error).toContain('not found');
    });
  });

  describe('DELETE /api/dashboards/snapshots/:id', () => {
    it('deletes an existing snapshot', async () => {
      seedSnapshot({ id: 'snap-del', title: 'To Delete' });

      const res = await fetch(`${harness.baseUrl}/api/dashboards/snapshots/snap-del`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      const api = harness.api();
      const { status } = await api.getJson('/api/dashboards/snapshots/snap-del');
      expect(status).toBe(404);
    });

    it('returns 404 when deleting unknown snapshot', async () => {
      const res = await fetch(`${harness.baseUrl}/api/dashboards/snapshots/nonexistent`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/dashboards/lineage/:lineageId', () => {
    it('returns all versions in a lineage', async () => {
      const lineageId = 'lineage-abc';
      seedSnapshot({ id: 'snap-v1', title: 'V1', lineageId, version: 1 });
      seedSnapshot({ id: 'snap-v2', title: 'V2', lineageId, version: 2 });
      seedSnapshot({ id: 'snap-v3', title: 'V3', lineageId, version: 3 });

      const api = harness.api();
      const { status, body } = await api.getJson<Array<{ id: string; version: number }>>(`/api/dashboards/lineage/${lineageId}`);

      expect(status).toBe(200);
      expect(body).toHaveLength(3);
      // Should be ordered by version DESC
      expect(body[0].version).toBe(3);
      expect(body[1].version).toBe(2);
      expect(body[2].version).toBe(1);
    });

    it('returns empty array for unknown lineage', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<unknown[]>('/api/dashboards/lineage/nonexistent');

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('POST /api/dashboards/snapshots/:id/render', () => {
    it('returns 404 for unknown snapshot', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots/nonexistent/render',
      );

      expect(status).toBe(404);
      expect(body.error).toContain('not found');
    });
  });

  describe('POST /api/dashboards/snapshots/:id/rerender', () => {
    it('returns 400 when specText is missing', async () => {
      seedSnapshot({ id: 'snap-rerender', title: 'Rerender Test' });

      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots/snap-rerender/rerender',
        {},
      );

      expect(status).toBe(400);
      expect(body.error).toContain('specText');
    });

    it('returns 404 for unknown snapshot', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/dashboards/snapshots/nonexistent/rerender',
        { specText: 'New spec' },
      );

      expect(status).toBe(404);
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/dashboards/snapshots/:id/html', () => {
    it('returns 404 for unknown snapshot', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/dashboards/snapshots/nonexistent/html');
      expect(status).toBe(404);
    });

    it('returns 404 when snapshot has no rendered HTML', async () => {
      seedSnapshot({ id: 'snap-no-html', title: 'No HTML', status: 'pending' });

      const api = harness.api();
      const { status, body } = await api.getJson<{ error: string }>('/api/dashboards/snapshots/snap-no-html/html');
      expect(status).toBe(404);
      expect(body.error).toContain('not been rendered');
    });

    it('returns raw HTML for rendered snapshot', async () => {
      seedSnapshot({
        id: 'snap-html',
        title: 'Has HTML',
        renderedHtml: '<h1>Dashboard</h1>',
        status: 'rendered',
      });

      const res = await fetch(`${harness.baseUrl}/api/dashboards/snapshots/snap-html/html`);
      expect(res.status).toBe(200);

      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('<h1>Dashboard</h1>');
      // Should be wrapped with library tags
      expect(html).toContain('echarts');
    });
  });
});
