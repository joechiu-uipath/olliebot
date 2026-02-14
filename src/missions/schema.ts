/**
 * Mission database schema setup
 *
 * Creates mission-related tables and indexes in the existing SQLite database.
 * Uses the Database.rawExec() method to run DDL statements.
 */

import { getDb } from '../db/index.js';

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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('critical', 'high', 'medium', 'low')),
      assignedAgent TEXT,
      conversationId TEXT,
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

  // Migrate existing pillar_metrics schema (add new columns if missing)
  migratePillarMetrics(db);

  console.log('[MissionSchema] Mission tables and indexes created');
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
