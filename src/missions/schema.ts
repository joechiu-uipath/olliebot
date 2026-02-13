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
      name TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      current TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      trend TEXT NOT NULL DEFAULT 'unknown' CHECK(trend IN ('improving', 'stable', 'degrading', 'unknown')),
      updatedAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_metric_history (
      id TEXT PRIMARY KEY,
      metricId TEXT NOT NULL REFERENCES pillar_metrics(id) ON DELETE CASCADE,
      value REAL NOT NULL,
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

  console.log('[MissionSchema] Mission tables and indexes created');
}
