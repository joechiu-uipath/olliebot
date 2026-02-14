/**
 * Mission database schema setup
 *
 * Creates mission-related tables and indexes in the existing SQLite database.
 * Uses the Database.rawExec() method to run DDL statements.
 */

import { getDb } from '../db/index.js';
import { metricConversationId, pillarTodoConversationId } from './constants.js';

export function initMissionSchema(): void {
  const db = getDb();

  // Enable foreign keys (must be set per-connection in SQLite)
  db.rawExec('PRAGMA foreign_keys = ON');

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
      mdFile TEXT NOT NULL,
      jsonConfig TEXT NOT NULL DEFAULT '{}',
      conversationId TEXT NOT NULL,
      cadence TEXT,
      lastCycleAt TEXT,
      nextCycleAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillars (
      id TEXT PRIMARY KEY,
      missionId TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
      conversationId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(missionId, slug)
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_metrics (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL REFERENCES pillars(id) ON DELETE CASCADE,
      slug TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'numeric'
        CHECK(type IN ('numeric', 'percentage', 'count', 'duration', 'boolean', 'rating')),
      unit TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '{}',
      current REAL,
      status TEXT DEFAULT 'unknown'
        CHECK(status IN ('on_target', 'warning', 'off_target', 'unknown')),
      trend TEXT NOT NULL DEFAULT 'unknown'
        CHECK(trend IN ('improving', 'stable', 'degrading', 'unknown')),
      collection TEXT DEFAULT '{}',
      lastCollectedAt TEXT,
      updatedAt TEXT NOT NULL,
      UNIQUE(pillarId, slug)
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_metric_history (
      id TEXT PRIMARY KEY,
      metricId TEXT NOT NULL REFERENCES pillar_metrics(id) ON DELETE CASCADE,
      value REAL NOT NULL,
      note TEXT,
      timestamp TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_strategies (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL REFERENCES pillars(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
      lastReviewedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS mission_todos (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL REFERENCES pillars(id) ON DELETE CASCADE,
      missionId TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      justification TEXT NOT NULL DEFAULT '',
      completionCriteria TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('backlog', 'pending', 'in_progress', 'completed', 'cancelled')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK(priority IN ('critical', 'high', 'medium', 'low')),
      outcome TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT
    )
  `);

  // Indexes for common query patterns
  db.rawExec(`
    CREATE INDEX IF NOT EXISTS idx_missions_slug ON missions(slug);
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
    CREATE INDEX IF NOT EXISTS idx_pillars_missionId ON pillars(missionId);
    CREATE INDEX IF NOT EXISTS idx_pillars_mission_slug ON pillars(missionId, slug);
    CREATE INDEX IF NOT EXISTS idx_pillar_metrics_pillarId ON pillar_metrics(pillarId);
    CREATE INDEX IF NOT EXISTS idx_pillar_metric_history_metricId ON pillar_metric_history(metricId, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_pillar_strategies_pillarId ON pillar_strategies(pillarId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_pillarId ON mission_todos(pillarId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_missionId ON mission_todos(missionId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_status ON mission_todos(missionId, status);
  `);

  // Migrate existing schemas (add new columns if missing)
  migratePillarMetrics(db);
  migrateMissionTodos(db);

  console.log('[MissionSchema] Mission tables and indexes created');
}

/**
 * Validate that all well-known mission conversations exist.
 * Creates any that are missing. Non-blocking — safe to call on every startup.
 */
export function validateMissionConversations(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Find all active missions and their pillars
  const missions = db.rawQuery('SELECT id, slug, name FROM missions WHERE status = ?', ['active']) as Array<{
    id: string; slug: string; name: string;
  }>;

  for (const mission of missions) {
    // Ensure metric collection conversation exists
    const metricConvId = metricConversationId(mission.slug);
    const metricExists = db.rawQuery('SELECT id FROM conversations WHERE id = ?', [metricConvId]) as Array<{ id: string }>;
    if (metricExists.length === 0) {
      console.log(`[MissionSchema] Creating missing metric collection conversation: ${metricConvId}`);
      db.rawRun(
        'INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [metricConvId, `[Metric Collection] ${mission.name}`, now, now, 1, JSON.stringify({ channel: 'metric-collection', missionId: mission.id, missionSlug: mission.slug })]
      );
    }

    // Ensure pillar TODO conversations exist
    const pillars = db.rawQuery('SELECT id, slug, name FROM pillars WHERE missionId = ? AND status = ?', [mission.id, 'active']) as Array<{
      id: string; slug: string; name: string;
    }>;

    for (const pillar of pillars) {
      const todoConvId = pillarTodoConversationId(mission.slug, pillar.slug);
      const todoExists = db.rawQuery('SELECT id FROM conversations WHERE id = ?', [todoConvId]) as Array<{ id: string }>;
      if (todoExists.length === 0) {
        console.log(`[MissionSchema] Creating missing pillar TODO conversation: ${todoConvId}`);
        db.rawRun(
          'INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
          [todoConvId, `[TODOs] ${pillar.name}`, now, now, 1, JSON.stringify({ channel: 'pillar-todo', missionId: mission.id, missionSlug: mission.slug, pillarId: pillar.id, pillarSlug: pillar.slug })]
        );
      }
    }
  }
}

/**
 * Migrate mission_todos table from old schema (with assignedAgent, conversationId, blocked)
 * to new schema (with justification, completionCriteria, backlog, cancelled).
 */
function migrateMissionTodos(db: ReturnType<typeof getDb>): void {
  try {
    const columns = db.rawQuery('PRAGMA table_info(mission_todos)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(c => c.name));

    // If 'justification' column already exists, migration was already done
    if (columnNames.has('justification')) return;

    console.log('[MissionSchema] Migrating mission_todos to enhanced schema...');

    // Add new columns
    db.rawExec('ALTER TABLE mission_todos ADD COLUMN justification TEXT NOT NULL DEFAULT \'\'');
    db.rawExec('ALTER TABLE mission_todos ADD COLUMN completionCriteria TEXT NOT NULL DEFAULT \'\'');

    // Migrate 'blocked' status to 'pending' (blocked is removed)
    db.rawRun('UPDATE mission_todos SET status = ? WHERE status = ?', ['pending', 'blocked']);

    console.log('[MissionSchema] Migrated mission_todos to enhanced schema');
  } catch {
    console.log('[MissionSchema] mission_todos migration skipped (fresh install or already migrated)');
  }
}

/**
 * Migrate pillar_metrics table from old schema (string target/current, no slug/type/status/collection)
 * to new schema. Safe to run multiple times — checks for column existence first.
 */
function migratePillarMetrics(db: ReturnType<typeof getDb>): void {
  try {
    const columns = db.rawQuery('PRAGMA table_info(pillar_metrics)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(c => c.name));

    // If 'slug' column already exists, migration was already done
    if (columnNames.has('slug')) return;

    console.log('[MissionSchema] Migrating pillar_metrics to enhanced schema...');

    // Add new columns
    if (!columnNames.has('slug')) {
      db.rawExec('ALTER TABLE pillar_metrics ADD COLUMN slug TEXT NOT NULL DEFAULT \'\'');
    }
    if (!columnNames.has('type')) {
      db.rawExec('ALTER TABLE pillar_metrics ADD COLUMN type TEXT NOT NULL DEFAULT \'numeric\'');
    }
    if (!columnNames.has('status')) {
      db.rawExec('ALTER TABLE pillar_metrics ADD COLUMN status TEXT DEFAULT \'unknown\'');
    }
    if (!columnNames.has('collection')) {
      db.rawExec('ALTER TABLE pillar_metrics ADD COLUMN collection TEXT DEFAULT \'{}\'');
    }
    if (!columnNames.has('lastCollectedAt')) {
      db.rawExec('ALTER TABLE pillar_metrics ADD COLUMN lastCollectedAt TEXT');
    }

    // Add note column to history if missing
    const histColumns = db.rawQuery('PRAGMA table_info(pillar_metric_history)') as Array<{ name: string }>;
    const histColumnNames = new Set(histColumns.map(c => c.name));
    if (!histColumnNames.has('note')) {
      db.rawExec('ALTER TABLE pillar_metric_history ADD COLUMN note TEXT');
    }

    // Migrate existing rows: generate slugs from names, infer types from units
    const metrics = db.rawQuery('SELECT id, name, unit, target, current FROM pillar_metrics') as Array<{
      id: string; name: string; unit: string; target: string; current: string;
    }>;

    for (const m of metrics) {
      const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || m.id;
      const type = inferMetricType(m.unit);
      const currentValue = parseFloat(m.current);
      const targetJson = parseTargetString(m.target);

      db.rawRun(
        'UPDATE pillar_metrics SET slug = ?, type = ?, target = ?, current = ? WHERE id = ?',
        [slug, type, JSON.stringify(targetJson), isNaN(currentValue) ? null : currentValue, m.id]
      );
    }

    console.log(`[MissionSchema] Migrated ${metrics.length} metrics to enhanced schema`);
  } catch (error) {
    // If table doesn't exist yet (fresh install), migration is not needed
    console.log('[MissionSchema] pillar_metrics migration skipped (fresh install or already migrated)');
  }
}

function inferMetricType(unit: string): string {
  const u = unit.toLowerCase().trim();
  if (u === '%' || u === 'percent') return 'percentage';
  if (u === 's' || u === 'sec' || u === 'seconds' || u === 'min' || u === 'minutes' || u === 'ms' || u === 'hours' || u === 'days') return 'duration';
  if (u === 'count' || u === 'items' || u === 'bugs' || u === 'tickets') return 'count';
  if (u === 'bool' || u === 'boolean') return 'boolean';
  return 'numeric';
}

function parseTargetString(target: string): Record<string, unknown> {
  // Try parsing as JSON first (already migrated)
  try {
    const parsed = JSON.parse(target);
    if (typeof parsed === 'object' && parsed !== null && 'operator' in parsed) return parsed;
  } catch { /* not JSON */ }

  // Parse free-text like "< 60", "> 80", "= 0"
  const match = target.match(/^\s*([<>!=]+)\s*([\d.]+)\s*$/);
  if (match) {
    return { operator: match[1], value: parseFloat(match[2]) };
  }

  return {};
}
