/**
 * Snapshot Engine
 *
 * Captures metrics from various sources (TraceStore, database) into the
 * standardized DashboardMetrics format. Each capture method freezes the
 * current state into an immutable JSON payload.
 */

import type { TraceStore } from '../tracing/trace-store.js';
import {
  DASHBOARD_DEFAULT_TIME_RANGE_MS,
  DASHBOARD_MAX_TRACES,
  DASHBOARD_MAX_LLM_CALLS,
  DASHBOARD_MAX_TOOL_CALLS,
  DASHBOARD_MAX_LLM_CALL_SUMMARIES,
  DASHBOARD_MAX_TRACE_SUMMARIES,
  DASHBOARD_TIME_SERIES_BUCKET_MS,
} from '../constants.js';
import type {
  DashboardMetrics,
  TimeSeriesPoint,
  AgentMetric,
  ToolMetric,
  LlmCallSummary,
  TraceSummary,
} from './types.js';

const SCHEMA_VERSION = 1;

export class SnapshotEngine {
  constructor(private traceStore: TraceStore) {}

  /**
   * Capture agent analytics for a time range.
   * Used for system-wide dashboards.
   */
  captureAgentAnalytics(since?: string, until?: string): DashboardMetrics {
    const now = new Date();
    const sinceDate = since || new Date(now.getTime() - DASHBOARD_DEFAULT_TIME_RANGE_MS).toISOString();
    const untilDate = until || now.toISOString();

    const stats = this.traceStore.getStats(sinceDate);
    const traces = this.traceStore.getTraces({ limit: DASHBOARD_MAX_TRACES, since: sinceDate });
    const llmCalls = this.traceStore.getLlmCalls({ limit: DASHBOARD_MAX_LLM_CALLS, since: sinceDate });
    const toolCalls = this.traceStore.getToolCalls({ limit: DASHBOARD_MAX_TOOL_CALLS });

    // Collect all spans across traces
    const allSpans = this.collectSpans(traces);

    const agentMetrics = this.buildAgentMetrics(allSpans, llmCalls);
    const toolMetrics = this.buildToolMetrics(toolCalls);
    const timeSeries = this.buildTimeSeries(llmCalls, sinceDate, untilDate);
    const llmCallSummaries = this.mapLlmCalls(llmCalls);
    const traceSummaries = this.mapTraces(traces);
    const errorCount = traces.filter(t => t.status === 'error').length;

    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: now.toISOString(),
      timeRange: {
        start: sinceDate,
        end: untilDate,
        durationMs: new Date(untilDate).getTime() - new Date(sinceDate).getTime(),
      },
      summary: {
        traceCount: stats.totalTraces,
        llmCallCount: stats.totalLlmCalls,
        toolCallCount: stats.totalToolCalls,
        agentCount: agentMetrics.length,
        totalInputTokens: stats.totalInputTokens,
        totalOutputTokens: stats.totalOutputTokens,
        totalDurationMs: Math.round(stats.avgDurationMs * stats.totalTraces),
        errorCount,
      },
      timeSeries,
      agentMetrics,
      toolMetrics,
      llmCalls: llmCallSummaries,
      traces: traceSummaries,
    };
  }

  /**
   * Capture metrics for a specific mission/conversation.
   * Used for mission-specific dashboards.
   */
  captureMissionReport(conversationId: string): DashboardMetrics {
    const traces = this.traceStore.getTraces({ limit: DASHBOARD_MAX_TRACES, conversationId });
    if (traces.length === 0) {
      return this.emptyMetrics();
    }

    const llmCalls = this.traceStore.getLlmCalls({ limit: DASHBOARD_MAX_LLM_CALLS, conversationId });

    // Collect all spans and tool calls across traces
    const allSpans = this.collectSpans(traces);
    const allToolCalls = this.collectToolCalls(traces);

    // Compute time range from traces
    const starts = traces.map(t => new Date(t.startedAt).getTime());
    const ends = traces
      .filter(t => t.completedAt)
      .map(t => new Date(t.completedAt!).getTime());
    const rangeStart = new Date(Math.min(...starts)).toISOString();
    const rangeEnd = ends.length > 0
      ? new Date(Math.max(...ends)).toISOString()
      : new Date().toISOString();

    const agentMetrics = this.buildAgentMetrics(allSpans, llmCalls);
    const toolMetrics = this.buildToolMetrics(allToolCalls);
    const totalInputTokens = llmCalls.reduce((s, c) => s + (c.inputTokens || 0), 0);
    const totalOutputTokens = llmCalls.reduce((s, c) => s + (c.outputTokens || 0), 0);
    const errorCount = traces.filter(t => t.status === 'error').length;

    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      timeRange: {
        start: rangeStart,
        end: rangeEnd,
        durationMs: new Date(rangeEnd).getTime() - new Date(rangeStart).getTime(),
      },
      summary: {
        traceCount: traces.length,
        llmCallCount: llmCalls.length,
        toolCallCount: allToolCalls.length,
        agentCount: agentMetrics.length,
        totalInputTokens,
        totalOutputTokens,
        totalDurationMs: traces.reduce((s, t) => s + (t.durationMs || 0), 0),
        errorCount,
      },
      agentMetrics,
      toolMetrics,
      llmCalls: this.mapLlmCalls(llmCalls),
      traces: this.mapTraces(traces),
    };
  }

  /**
   * Capture custom metrics from raw data.
   */
  captureCustom(title: string, data: Record<string, unknown>): DashboardMetrics {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: now,
      timeRange: { start: now, end: now, durationMs: 0 },
      summary: {
        traceCount: 0, llmCallCount: 0, toolCallCount: 0, agentCount: 0,
        totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0, errorCount: 0,
      },
      custom: data,
    };
  }

  // ================================================================
  // Data collection helpers
  // ================================================================

  private collectSpans(traces: Array<{ id: string }>): unknown[] {
    const allSpans: unknown[] = [];
    for (const trace of traces) {
      allSpans.push(...this.traceStore.getSpansByTraceId(trace.id));
    }
    return allSpans;
  }

  private collectToolCalls(traces: Array<{ id: string }>): unknown[] {
    const allToolCalls: unknown[] = [];
    for (const trace of traces) {
      allToolCalls.push(...this.traceStore.getToolCalls({ traceId: trace.id, limit: DASHBOARD_MAX_TOOL_CALLS }));
    }
    return allToolCalls;
  }

  // ================================================================
  // Aggregation helpers (shared between capture methods)
  // ================================================================

  /**
   * Build per-agent metrics from spans and LLM calls.
   */
  private buildAgentMetrics(spans: unknown[], llmCalls: unknown[]): AgentMetric[] {
    const agentMap = new Map<string, AgentMetric>();
    const typedSpans = spans as Array<{
      agentId: string; agentName: string; agentEmoji: string;
      agentType: string; agentRole: string; llmCallCount: number;
      toolCallCount: number; durationMs: number | null; status: string;
    }>;

    for (const span of typedSpans) {
      const existing = agentMap.get(span.agentId);
      if (existing) {
        existing.spanCount++;
        existing.llmCallCount += span.llmCallCount;
        existing.toolCallCount += span.toolCallCount;
        existing.totalDurationMs += span.durationMs || 0;
        if (span.status === 'error') existing.errorCount++;
      } else {
        agentMap.set(span.agentId, {
          agentId: span.agentId,
          agentName: span.agentName,
          agentEmoji: span.agentEmoji,
          agentType: span.agentType,
          agentRole: span.agentRole,
          spanCount: 1,
          llmCallCount: span.llmCallCount,
          toolCallCount: span.toolCallCount,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalDurationMs: span.durationMs || 0,
          errorCount: span.status === 'error' ? 1 : 0,
        });
      }
    }

    // Accumulate token counts per agent from LLM calls
    const typedCalls = llmCalls as Array<{
      callerAgentId: string | null; inputTokens: number | null; outputTokens: number | null;
    }>;
    for (const call of typedCalls) {
      if (call.callerAgentId && agentMap.has(call.callerAgentId)) {
        const agent = agentMap.get(call.callerAgentId)!;
        agent.totalInputTokens += call.inputTokens || 0;
        agent.totalOutputTokens += call.outputTokens || 0;
      }
    }

    return Array.from(agentMap.values());
  }

  /**
   * Build per-tool metrics from tool calls.
   */
  private buildToolMetrics(toolCalls: unknown[]): ToolMetric[] {
    const toolMap = new Map<string, ToolMetric>();
    const typedCalls = toolCalls as Array<{
      toolName: string; source: string; success: number; durationMs: number | null;
    }>;

    for (const tc of typedCalls) {
      const existing = toolMap.get(tc.toolName);
      if (existing) {
        existing.invocationCount++;
        if (tc.success === 1) existing.successCount++;
        if (tc.success === 0) existing.errorCount++;
        existing.avgDurationMs =
          (existing.avgDurationMs * (existing.invocationCount - 1) + (tc.durationMs || 0))
          / existing.invocationCount;
      } else {
        toolMap.set(tc.toolName, {
          toolName: tc.toolName,
          source: tc.source,
          invocationCount: 1,
          successCount: tc.success === 1 ? 1 : 0,
          errorCount: tc.success === 0 ? 1 : 0,
          avgDurationMs: tc.durationMs || 0,
        });
      }
    }

    return Array.from(toolMap.values());
  }

  /**
   * Map raw LLM calls to summary records, capped to max summaries.
   */
  private mapLlmCalls(llmCalls: unknown[]): LlmCallSummary[] {
    const typedCalls = llmCalls as Array<{
      id: string; spanId: string | null; workload: string; provider: string;
      model: string; inputTokens: number | null; outputTokens: number | null;
      durationMs: number | null; callerAgentName: string | null;
      callerPurpose: string | null; stopReason: string | null; status: string;
    }>;

    return typedCalls.slice(0, DASHBOARD_MAX_LLM_CALL_SUMMARIES).map(c => ({
      id: c.id,
      spanId: c.spanId,
      workload: c.workload,
      provider: c.provider,
      model: c.model,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      durationMs: c.durationMs,
      callerAgentName: c.callerAgentName,
      callerPurpose: c.callerPurpose,
      stopReason: c.stopReason,
      status: c.status,
    }));
  }

  /**
   * Map raw traces to summary records, capped to max summaries.
   */
  private mapTraces(traces: unknown[]): TraceSummary[] {
    const typedTraces = traces as Array<{
      id: string; triggerType: string; triggerContent: string | null;
      agentCount: number; llmCallCount: number; toolCallCount: number;
      totalInputTokens: number; totalOutputTokens: number;
      durationMs: number | null; status: string; startedAt: string;
    }>;

    return typedTraces.slice(0, DASHBOARD_MAX_TRACE_SUMMARIES).map(t => ({
      id: t.id,
      triggerType: t.triggerType,
      triggerContent: t.triggerContent,
      agentCount: t.agentCount,
      llmCallCount: t.llmCallCount,
      toolCallCount: t.toolCallCount,
      totalInputTokens: t.totalInputTokens,
      totalOutputTokens: t.totalOutputTokens,
      durationMs: t.durationMs,
      status: t.status,
      startedAt: t.startedAt,
    }));
  }

  // ================================================================
  // Time series
  // ================================================================

  private buildTimeSeries(
    llmCalls: Array<{ startedAt: string; inputTokens: number | null; outputTokens: number | null }>,
    since: string,
    until: string
  ): TimeSeriesPoint[] {
    const start = new Date(since).getTime();
    const end = new Date(until).getTime();
    const buckets = new Map<number, TimeSeriesPoint>();

    // Initialize buckets
    for (let t = start; t <= end; t += DASHBOARD_TIME_SERIES_BUCKET_MS) {
      buckets.set(t, {
        timestamp: new Date(t).toISOString(),
        inputTokens: 0,
        outputTokens: 0,
        llmCalls: 0,
        toolCalls: 0,
      });
    }

    // Fill from LLM calls
    for (const call of llmCalls) {
      const callTime = new Date(call.startedAt).getTime();
      const bucketKey = start + Math.floor((callTime - start) / DASHBOARD_TIME_SERIES_BUCKET_MS) * DASHBOARD_TIME_SERIES_BUCKET_MS;
      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.llmCalls++;
        bucket.inputTokens += call.inputTokens || 0;
        bucket.outputTokens += call.outputTokens || 0;
      }
    }

    return Array.from(buckets.values());
  }

  private emptyMetrics(): DashboardMetrics {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: now,
      timeRange: { start: now, end: now, durationMs: 0 },
      summary: {
        traceCount: 0, llmCallCount: 0, toolCallCount: 0, agentCount: 0,
        totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0, errorCount: 0,
      },
    };
  }
}
