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

// --- Metric type system ---

export type MetricType = 'numeric' | 'percentage' | 'count' | 'duration' | 'boolean' | 'rating';
export type MetricStatus = 'on_target' | 'warning' | 'off_target' | 'unknown';
export type MetricTrend = 'improving' | 'stable' | 'degrading' | 'unknown';

export interface MetricTarget {
  operator: '<' | '<=' | '>' | '>=' | '=' | '!=';
  value: number;
  warningThreshold?: number;
  desiredDirection?: 'up' | 'down' | 'stable';
}

export interface MetricCollection {
  method: 'tool';
  toolName?: string;
  toolParams?: Record<string, unknown>;
  collectionSchedule?: string;   // cron expression (per-metric schedule)
  instructions?: string;
}

export interface PillarMetric {
  id: string;
  pillarId: string;
  slug: string;
  name: string;
  type: MetricType;
  unit: string;
  target: string;             // JSON string of MetricTarget
  current: number | null;     // numeric value (durations always in seconds)
  status: MetricStatus;
  trend: MetricTrend;
  collection: string;         // JSON string of MetricCollection
  lastCollectedAt: string | null;
  updatedAt: string;
}

export interface PillarMetricHistory {
  id: string;
  metricId: string;
  value: number;
  note: string | null;
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
  id: string;                             // GUID — TODOs referenced by ID, not slug
  pillarId: string;
  missionId: string;
  title: string;
  description: string;
  justification: string;                  // Why this, why now
  completionCriteria: string;             // How to judge "done"
  status: 'backlog' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;              // When status → in_progress
  completedAt: string | null;            // When status → completed OR cancelled
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
export type PillarMetricHistoryRow = Stringify<PillarMetricHistory>;
export type PillarStrategyRow = Stringify<PillarStrategy>;
export type MissionTodoRow = Stringify<MissionTodo>;
