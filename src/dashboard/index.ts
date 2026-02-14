/**
 * Dashboard System
 *
 * LLM-powered, versioned dashboard rendering system.
 * Captures point-in-time metric snapshots and renders them
 * into self-contained HTML/JS applications via LLM.
 */

export { DashboardStore, getDashboardStore } from './dashboard-store.js';
export { SnapshotEngine } from './snapshot-engine.js';
export { RenderEngine } from './render-engine.js';
export { setupDashboardRoutes } from './dashboard-routes.js';
export type { DashboardRoutesConfig } from './dashboard-routes.js';

export type {
  DashboardSnapshot,
  DashboardMetrics,
  SnapshotType,
  SnapshotStatus,
  SnapshotQueryOptions,
  CreateSnapshotOptions,
  RenderMeta,
  TimeSeriesPoint,
  AgentMetric,
  ToolMetric,
  LlmCallSummary,
  TraceSummary,
} from './types.js';
