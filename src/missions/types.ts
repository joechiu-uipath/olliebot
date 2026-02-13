/**
 * Mission system types
 *
 * Domain interfaces define the typed shape; Row types are the string-relaxed
 * versions as stored in SQLite (status/trend/priority come back as plain strings).
 */

// ============================================================================
// Domain interfaces
// ============================================================================

export interface Mission {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'archived';
  mdFile: string;
  jsonConfig: string;         // JSON text of the full runtime config
  conversationId: string;     // mission-level chat conversation
  cadence: string | null;     // cron expression for cycle schedule
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pillar {
  id: string;
  missionId: string;
  slug: string;
  name: string;
  description: string;
  status: 'active' | 'paused';
  conversationId: string;     // pillar-level chat conversation
  createdAt: string;
  updatedAt: string;
}

export interface PillarMetric {
  id: string;
  pillarId: string;
  name: string;
  target: string;
  current: string;
  unit: string;
  trend: 'improving' | 'stable' | 'degrading' | 'unknown';
  updatedAt: string;
}

export interface PillarMetricHistory {
  id: string;
  metricId: string;
  value: number;
  timestamp: string;
}

export interface PillarStrategy {
  id: string;
  pillarId: string;
  description: string;
  status: 'active' | 'retired';
  lastReviewedAt: string;
  createdAt: string;
}

export interface MissionTodo {
  id: string;
  pillarId: string;
  missionId: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedAgent: string | null;
  conversationId: string | null;  // execution log conversation
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ============================================================================
// SQLite row types — same shape but union types relaxed to string
// ============================================================================

/** Utility: replaces specific string literal unions with plain string */
type Stringify<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K];
};

export type MissionRow = Stringify<Mission>;
export type PillarRow = Stringify<Pillar>;
export type PillarMetricRow = Stringify<PillarMetric>;
export type PillarMetricHistoryRow = PillarMetricHistory; // no unions to relax
export type PillarStrategyRow = Stringify<PillarStrategy>;
export type MissionTodoRow = Stringify<MissionTodo>;
