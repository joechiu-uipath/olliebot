/**
 * Snapshot Engine
 *
 * Captures metrics from various sources (TraceStore, database) into the
 * standardized DashboardMetrics format. Each capture method freezes the
 * current state into an immutable JSON payload.
 */

import type { TraceStore } from '../tracing/trace-store.js';
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
    const sinceDate = since || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const untilDate = until || now.toISOString();

    const stats = this.traceStore.getStats(sinceDate);
    const traces = this.traceStore.getTraces({ limit: 100, since: sinceDate });
    const llmCalls = this.traceStore.getLlmCalls({ limit: 500, since: sinceDate });
    const toolCalls = this.traceStore.getToolCalls({ limit: 500 });

    // Build agent metrics from spans across all traces
    const agentMap = new Map<string, AgentMetric>();
    for (const trace of traces) {
      const spans = this.traceStore.getSpansByTraceId(trace.id);
      for (const span of spans) {
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
    }

    // Accumulate token counts per agent from LLM calls
    for (const call of llmCalls) {
      if (call.callerAgentId && agentMap.has(call.callerAgentId)) {
        const agent = agentMap.get(call.callerAgentId)!;
        agent.totalInputTokens += call.inputTokens || 0;
        agent.totalOutputTokens += call.outputTokens || 0;
      }
    }

    // Build tool metrics
    const toolMap = new Map<string, ToolMetric>();
    for (const tc of toolCalls) {
      const existing = toolMap.get(tc.toolName);
      if (existing) {
        existing.invocationCount++;
        if (tc.success === 1) existing.successCount++;
        if (tc.success === 0) existing.errorCount++;
        existing.avgDurationMs = (existing.avgDurationMs * (existing.invocationCount - 1) + (tc.durationMs || 0)) / existing.invocationCount;
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

    // Build time series (bucket by hour)
    const timeSeries = this.buildTimeSeries(llmCalls, sinceDate, untilDate);

    // LLM call summaries
    const llmCallSummaries: LlmCallSummary[] = llmCalls.slice(0, 200).map(c => ({
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

    // Trace summaries
    const traceSummaries: TraceSummary[] = traces.slice(0, 50).map(t => ({
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
        agentCount: agentMap.size,
        totalInputTokens: stats.totalInputTokens,
        totalOutputTokens: stats.totalOutputTokens,
        totalDurationMs: Math.round(stats.avgDurationMs * stats.totalTraces),
        errorCount,
      },
      timeSeries,
      agentMetrics: Array.from(agentMap.values()),
      toolMetrics: Array.from(toolMap.values()),
      llmCalls: llmCallSummaries,
      traces: traceSummaries,
    };
  }

  /**
   * Capture metrics for a specific mission/conversation.
   * Used for mission-specific dashboards.
   */
  captureMissionReport(conversationId: string): DashboardMetrics {
    const traces = this.traceStore.getTraces({ limit: 100, conversationId });
    if (traces.length === 0) {
      return this.emptyMetrics();
    }

    const llmCalls = this.traceStore.getLlmCalls({ limit: 500, conversationId });
    const allToolCalls = [];
    const allSpans = [];

    for (const trace of traces) {
      const spans = this.traceStore.getSpansByTraceId(trace.id);
      allSpans.push(...spans);
      const tcs = this.traceStore.getToolCalls({ traceId: trace.id, limit: 500 });
      allToolCalls.push(...tcs);
    }

    // Compute time range from traces
    const starts = traces.map(t => new Date(t.startedAt).getTime());
    const ends = traces
      .filter(t => t.completedAt)
      .map(t => new Date(t.completedAt!).getTime());
    const rangeStart = new Date(Math.min(...starts)).toISOString();
    const rangeEnd = ends.length > 0
      ? new Date(Math.max(...ends)).toISOString()
      : new Date().toISOString();

    // Build agent metrics
    const agentMap = new Map<string, AgentMetric>();
    for (const span of allSpans) {
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

    for (const call of llmCalls) {
      if (call.callerAgentId && agentMap.has(call.callerAgentId)) {
        const agent = agentMap.get(call.callerAgentId)!;
        agent.totalInputTokens += call.inputTokens || 0;
        agent.totalOutputTokens += call.outputTokens || 0;
      }
    }

    // Tool metrics
    const toolMap = new Map<string, ToolMetric>();
    for (const tc of allToolCalls) {
      const existing = toolMap.get(tc.toolName);
      if (existing) {
        existing.invocationCount++;
        if (tc.success === 1) existing.successCount++;
        if (tc.success === 0) existing.errorCount++;
        existing.avgDurationMs = (existing.avgDurationMs * (existing.invocationCount - 1) + (tc.durationMs || 0)) / existing.invocationCount;
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
        agentCount: agentMap.size,
        totalInputTokens,
        totalOutputTokens,
        totalDurationMs: traces.reduce((s, t) => s + (t.durationMs || 0), 0),
        errorCount,
      },
      agentMetrics: Array.from(agentMap.values()),
      toolMetrics: Array.from(toolMap.values()),
      llmCalls: llmCalls.slice(0, 200).map(c => ({
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
      })),
      traces: traces.slice(0, 50).map(t => ({
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
      })),
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
  // Helpers
  // ================================================================

  private buildTimeSeries(
    llmCalls: Array<{ startedAt: string; inputTokens: number | null; outputTokens: number | null }>,
    since: string,
    until: string
  ): TimeSeriesPoint[] {
    const start = new Date(since).getTime();
    const end = new Date(until).getTime();
    const bucketMs = 60 * 60 * 1000; // 1 hour buckets
    const buckets = new Map<number, TimeSeriesPoint>();

    // Initialize buckets
    for (let t = start; t <= end; t += bucketMs) {
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
      const bucketKey = start + Math.floor((callTime - start) / bucketMs) * bucketMs;
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
