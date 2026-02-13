/**
 * Mission database schema setup
 *
 * Creates mission-related tables and indexes in the existing SQLite database.
 * Uses the Database.rawExec() method to run DDL statements.
 */

import { getDb } from '../db/index.js';

export function initMissionSchema(): void {
  const db = getDb();

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
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
      missionId TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      conversationId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_metrics (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL,
      name TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      current TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      trend TEXT NOT NULL DEFAULT 'unknown',
      updatedAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_metric_history (
      id TEXT PRIMARY KEY,
      metricId TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS pillar_strategies (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      lastReviewedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.rawExec(`
    CREATE TABLE IF NOT EXISTS mission_todos (
      id TEXT PRIMARY KEY,
      pillarId TEXT NOT NULL,
      missionId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignedAgent TEXT,
      conversationId TEXT,
      outcome TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT
    )
  `);

  // Indexes
  db.rawExec(`
    CREATE INDEX IF NOT EXISTS idx_missions_slug ON missions(slug);
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
    CREATE INDEX IF NOT EXISTS idx_pillars_missionId ON pillars(missionId);
    CREATE INDEX IF NOT EXISTS idx_pillar_metrics_pillarId ON pillar_metrics(pillarId);
    CREATE INDEX IF NOT EXISTS idx_pillar_metric_history_metricId ON pillar_metric_history(metricId, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_pillar_strategies_pillarId ON pillar_strategies(pillarId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_pillarId ON mission_todos(pillarId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_missionId ON mission_todos(missionId);
    CREATE INDEX IF NOT EXISTS idx_mission_todos_status ON mission_todos(missionId, status);
  `);

  console.log('[MissionSchema] Mission tables and indexes created');
}
