/**
 * Mission system types
 */

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

/** Row types as stored in SQLite */
export interface MissionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  mdFile: string;
  jsonConfig: string;
  conversationId: string;
  cadence: string | null;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PillarRow {
  id: string;
  missionId: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PillarMetricRow {
  id: string;
  pillarId: string;
  name: string;
  target: string;
  current: string;
  unit: string;
  trend: string;
  updatedAt: string;
}

export interface PillarMetricHistoryRow {
  id: string;
  metricId: string;
  value: number;
  timestamp: string;
}

export interface PillarStrategyRow {
  id: string;
  pillarId: string;
  description: string;
  status: string;
  lastReviewedAt: string;
  createdAt: string;
}

export interface MissionTodoRow {
  id: string;
  pillarId: string;
  missionId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedAgent: string | null;
  conversationId: string | null;
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
