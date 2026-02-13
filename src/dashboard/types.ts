/**
 * Dashboard System Types
 *
 * Type definitions for the LLM-powered, versioned dashboard system.
 * Dashboards render point-in-time metric snapshots into self-contained
 * JavaScript applications displayed inside sandboxed iframes.
 */

// ============================================================
// Snapshot types
// ============================================================

export type SnapshotType = 'mission_report' | 'agent_analytics' | 'system_health' | 'custom';
export type SnapshotStatus = 'pending' | 'rendering' | 'rendered' | 'error';

export interface DashboardSnapshot {
  id: string;
  conversationId: string | null;
  missionId: string | null;

  title: string;
  snapshotType: SnapshotType;
  version: number;
  lineageId: string;

  metricsJson: string;
  specText: string;
  renderedHtml: string | null;
  renderModel: string | null;
  renderDurationMs: number | null;
  renderTokensIn: number | null;
  renderTokensOut: number | null;

  createdAt: string;
  renderedAt: string | null;

  status: SnapshotStatus;
  error: string | null;
}

// ============================================================
// Metrics envelope (the data frozen into metricsJson)
// ============================================================

export interface DashboardMetrics {
  schemaVersion: number;
  capturedAt: string;

  timeRange: {
    start: string;
    end: string;
    durationMs: number;
  };

  summary: {
    traceCount: number;
    llmCallCount: number;
    toolCallCount: number;
    agentCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    errorCount: number;
  };

  timeSeries?: TimeSeriesPoint[];
  agentMetrics?: AgentMetric[];
  toolMetrics?: ToolMetric[];
  llmCalls?: LlmCallSummary[];
  traces?: TraceSummary[];

  custom?: Record<string, unknown>;
}

export interface TimeSeriesPoint {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  toolCalls: number;
}

export interface AgentMetric {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentType: string;
  agentRole: string;
  spanCount: number;
  llmCallCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  errorCount: number;
}

export interface ToolMetric {
  toolName: string;
  source: string;
  invocationCount: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
}

export interface LlmCallSummary {
  id: string;
  spanId: string | null;
  workload: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  callerAgentName: string | null;
  callerPurpose: string | null;
  stopReason: string | null;
  status: string;
}

export interface TraceSummary {
  id: string;
  triggerType: string;
  triggerContent: string | null;
  agentCount: number;
  llmCallCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number | null;
  status: string;
  startedAt: string;
}

// ============================================================
// Query options
// ============================================================

export interface SnapshotQueryOptions {
  limit?: number;
  missionId?: string;
  conversationId?: string;
  snapshotType?: SnapshotType;
  status?: SnapshotStatus;
  since?: string;
}

export interface CreateSnapshotOptions {
  title: string;
  snapshotType: SnapshotType;
  specText: string;
  metricsJson: string;
  conversationId?: string;
  missionId?: string;
  lineageId?: string;
}

export interface RenderMeta {
  model: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}
