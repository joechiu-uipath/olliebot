/**
 * Dashboard Store
 *
 * SQLite persistence for versioned dashboard snapshots.
 * Follows the same pattern as TraceStore — uses the shared better-sqlite3
 * database instance via getDb(), WAL mode, prepared statements.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import {
  DASHBOARD_DEFAULT_QUERY_LIMIT,
  DASHBOARD_DEFAULT_RETENTION_DAYS,
  MAX_QUERY_LIMIT,
} from '../constants.js';
import type {
  DashboardSnapshot,
  SnapshotQueryOptions,
  CreateSnapshotOptions,
  RenderMeta,
  SnapshotStatus,
} from './types.js';

export class DashboardStore {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    const db = getDb();

    db.rawExec(`
      CREATE TABLE IF NOT EXISTS dashboard_snapshots (
        id              TEXT PRIMARY KEY,
        conversationId  TEXT,
        missionId       TEXT,

        title           TEXT NOT NULL,
        snapshotType    TEXT NOT NULL,
        version         INTEGER NOT NULL DEFAULT 1,
        lineageId       TEXT NOT NULL,

        metricsJson     TEXT NOT NULL,
        specText        TEXT NOT NULL,
        renderedHtml    TEXT,
        renderModel     TEXT,
        renderDurationMs INTEGER,
        renderTokensIn  INTEGER,
        renderTokensOut INTEGER,

        createdAt       TEXT NOT NULL,
        renderedAt      TEXT,

        status          TEXT NOT NULL DEFAULT 'pending',
        error           TEXT
      )
    `);

    db.rawExec(`CREATE INDEX IF NOT EXISTS idx_snapshots_lineage ON dashboard_snapshots(lineageId, version DESC)`);
    db.rawExec(`CREATE INDEX IF NOT EXISTS idx_snapshots_mission ON dashboard_snapshots(missionId)`);
    db.rawExec(`CREATE INDEX IF NOT EXISTS idx_snapshots_created ON dashboard_snapshots(createdAt DESC)`);
    db.rawExec(`CREATE INDEX IF NOT EXISTS idx_snapshots_type ON dashboard_snapshots(snapshotType)`);
    db.rawExec(`CREATE INDEX IF NOT EXISTS idx_snapshots_conversation ON dashboard_snapshots(conversationId)`);

    this.initialized = true;
    console.log('[DashboardStore] Initialized');
  }

  // ================================================================
  // Create
  // ================================================================

  createSnapshot(opts: CreateSnapshotOptions): string {
    const db = getDb();
    const id = uuid();
    const now = new Date().toISOString();
    const lineageId = opts.lineageId || uuid();

    // If lineageId was provided, compute next version
    let version = 1;
    if (opts.lineageId) {
      const rows = db.rawQuery(
        `SELECT MAX(version) as maxVersion FROM dashboard_snapshots WHERE lineageId = ?`,
        [opts.lineageId]
      ) as Array<{ maxVersion: number | null }>;
      version = (rows[0]?.maxVersion || 0) + 1;
    }

    db.rawRun(
      `INSERT INTO dashboard_snapshots
        (id, conversationId, missionId, title, snapshotType, version, lineageId,
         metricsJson, specText, createdAt, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        opts.conversationId || null,
        opts.missionId || null,
        opts.title,
        opts.snapshotType,
        version,
        lineageId,
        opts.metricsJson,
        opts.specText,
        now,
        'pending',
      ]
    );

    return id;
  }

  // ================================================================
  // Read
  // ================================================================

  getSnapshotById(id: string): DashboardSnapshot | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM dashboard_snapshots WHERE id = ?',
      [id]
    ) as DashboardSnapshot[];
    return rows[0];
  }

  getSnapshots(opts?: SnapshotQueryOptions): DashboardSnapshot[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.missionId) {
      conditions.push('missionId = ?');
      params.push(opts.missionId);
    }
    if (opts?.conversationId) {
      conditions.push('conversationId = ?');
      params.push(opts.conversationId);
    }
    if (opts?.snapshotType) {
      conditions.push('snapshotType = ?');
      params.push(opts.snapshotType);
    }
    if (opts?.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }
    if (opts?.since) {
      conditions.push('createdAt > ?');
      params.push(opts.since);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = Math.min(Math.max(opts?.limit || DASHBOARD_DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);

    return db.rawQuery(
      `SELECT * FROM dashboard_snapshots ${where} ORDER BY createdAt DESC LIMIT ?`,
      [...params, limit]
    ) as DashboardSnapshot[];
  }

  getSnapshotsByLineage(lineageId: string): DashboardSnapshot[] {
    const db = getDb();
    return db.rawQuery(
      `SELECT * FROM dashboard_snapshots WHERE lineageId = ? ORDER BY version DESC`,
      [lineageId]
    ) as DashboardSnapshot[];
  }

  // ================================================================
  // Update — rendering lifecycle
  // ================================================================

  updateStatus(id: string, status: SnapshotStatus, error?: string): void {
    const db = getDb();
    db.rawRun(
      `UPDATE dashboard_snapshots SET status = ?, error = ? WHERE id = ?`,
      [status, error || null, id]
    );
  }

  updateRenderedHtml(id: string, html: string, meta: RenderMeta): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.rawRun(
      `UPDATE dashboard_snapshots
       SET renderedHtml = ?, renderModel = ?, renderDurationMs = ?,
           renderTokensIn = ?, renderTokensOut = ?,
           renderedAt = ?, status = 'rendered', error = NULL
       WHERE id = ?`,
      [html, meta.model, meta.durationMs, meta.tokensIn, meta.tokensOut, now, id]
    );
  }

  // ================================================================
  // Re-render (create new version from existing snapshot)
  // ================================================================

  createNewVersion(sourceId: string, newSpecText: string): string | undefined {
    const source = this.getSnapshotById(sourceId);
    if (!source) return undefined;

    return this.createSnapshot({
      title: source.title,
      snapshotType: source.snapshotType as CreateSnapshotOptions['snapshotType'],
      specText: newSpecText,
      metricsJson: source.metricsJson,
      conversationId: source.conversationId || undefined,
      missionId: source.missionId || undefined,
      lineageId: source.lineageId,
    });
  }

  // ================================================================
  // Delete
  // ================================================================

  deleteSnapshot(id: string): boolean {
    const db = getDb();
    const changes = db.rawRun(
      'DELETE FROM dashboard_snapshots WHERE id = ?',
      [id]
    );
    return changes > 0;
  }

  // ================================================================
  // Cleanup
  // ================================================================

  cleanup(retentionDays: number = DASHBOARD_DEFAULT_RETENTION_DAYS): number {
    const db = getDb();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return db.rawRun(
      'DELETE FROM dashboard_snapshots WHERE createdAt < ?',
      [cutoff]
    );
  }
}

// ================================================================
// Singleton
// ================================================================

let globalDashboardStore: DashboardStore | null = null;

export function getDashboardStore(): DashboardStore {
  if (!globalDashboardStore) {
    globalDashboardStore = new DashboardStore();
  }
  return globalDashboardStore;
}
