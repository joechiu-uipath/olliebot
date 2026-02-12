/**
 * TraceStore - Central service for managing execution traces.
 *
 * Handles the lifecycle of traces, spans, LLM calls, and tool calls.
 * Persists data to AlaSQL tables following the existing DB pattern.
 * Provides query methods for the API layer.
 */

import { v4 as uuid } from 'uuid';
import alasql from 'alasql';
import type {
  TraceRecord,
  TraceSpan,
  LlmCallRecord,
  ToolCallRecord,
  LlmWorkload,
  TraceContext,
  TraceQueryOptions,
  LlmCallQueryOptions,
  ToolCallQueryOptions,
  TraceStats,
} from './types.js';
import type { Channel } from '../channels/types.js';

// Max stored size for messages/tools JSON (500KB)
const MAX_MESSAGES_JSON_SIZE = 500_000;
// Max stored size for tool result JSON (50KB)
const MAX_TOOL_RESULT_JSON_SIZE = 50_000;
// Default retention period in days
const DEFAULT_RETENTION_DAYS = 7;
// Default query limit
const DEFAULT_QUERY_LIMIT = 50;
// Max query limit
const MAX_QUERY_LIMIT = 200;

export class TraceStore {
  private initialized = false;
  private channel: Channel | null = null;
  private storeStreamChunks: boolean;

  constructor() {
    this.storeStreamChunks = process.env.TRACE_STORE_STREAM_CHUNKS === 'true';
  }

  /**
   * Initialize AlaSQL tables for tracing data.
   * Called during app startup after DB init.
   */
  init(): void {
    if (this.initialized) return;

    alasql(`
      CREATE TABLE IF NOT EXISTS traces (
        id STRING,
        conversationId STRING,
        turnId STRING,
        triggerType STRING,
        triggerContent STRING,
        startedAt STRING,
        completedAt STRING,
        durationMs INT,
        llmCallCount INT,
        toolCallCount INT,
        agentCount INT,
        totalInputTokens INT,
        totalOutputTokens INT,
        status STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS trace_spans (
        id STRING,
        traceId STRING,
        parentSpanId STRING,
        agentId STRING,
        agentName STRING,
        agentEmoji STRING,
        agentType STRING,
        agentRole STRING,
        mission STRING,
        startedAt STRING,
        completedAt STRING,
        durationMs INT,
        llmCallCount INT,
        toolCallCount INT,
        status STRING,
        error STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id STRING,
        traceId STRING,
        spanId STRING,
        workload STRING,
        provider STRING,
        model STRING,
        messagesJson STRING,
        systemPrompt STRING,
        toolsJson STRING,
        toolChoice STRING,
        maxTokens INT,
        temperature FLOAT,
        reasoningEffort STRING,
        responseContent STRING,
        responseToolUseJson STRING,
        stopReason STRING,
        inputTokens INT,
        outputTokens INT,
        streamChunksJson STRING,
        startedAt STRING,
        completedAt STRING,
        durationMs INT,
        callerAgentId STRING,
        callerAgentName STRING,
        callerPurpose STRING,
        conversationId STRING,
        status STRING,
        error STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id STRING,
        traceId STRING,
        spanId STRING,
        llmCallId STRING,
        toolName STRING,
        source STRING,
        parametersJson STRING,
        resultJson STRING,
        success INT,
        error STRING,
        startedAt STRING,
        completedAt STRING,
        durationMs INT,
        callerAgentId STRING,
        callerAgentName STRING
      )
    `);

    this.initialized = true;
    console.log('[TraceStore] Initialized tracing tables');
  }

  /**
   * Set the channel for broadcasting real-time log events.
   */
  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  // ============================================================
  // Trace lifecycle
  // ============================================================

  startTrace(opts: {
    conversationId?: string;
    turnId?: string;
    triggerType: 'user_message' | 'task_run' | 'system';
    triggerContent?: string;
  }): string {
    const id = uuid();
    const now = new Date().toISOString();

    const record: TraceRecord = {
      id,
      conversationId: opts.conversationId || null,
      turnId: opts.turnId || null,
      triggerType: opts.triggerType,
      triggerContent: opts.triggerContent?.substring(0, 200) || null,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      llmCallCount: 0,
      toolCallCount: 0,
      agentCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      status: 'running',
    };

    alasql('INSERT INTO traces VALUES ?', [record]);

    // Broadcast
    this.broadcast({
      type: 'log_trace_start',
      traceId: id,
      triggerType: opts.triggerType,
      triggerContent: record.triggerContent,
      conversationId: record.conversationId,
      timestamp: now,
    });

    return id;
  }

  endTrace(traceId: string, status: 'completed' | 'error' = 'completed'): void {
    const trace = this.getTraceById(traceId);
    if (!trace) return;

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(trace.startedAt).getTime();

    alasql(
      'UPDATE traces SET completedAt = ?, durationMs = ?, status = ? WHERE id = ?',
      [now, durationMs, status, traceId]
    );

    // Broadcast with final stats
    const updated = this.getTraceById(traceId);
    this.broadcast({
      type: 'log_trace_end',
      traceId,
      durationMs,
      status,
      stats: updated ? {
        llmCallCount: updated.llmCallCount,
        toolCallCount: updated.toolCallCount,
        agentCount: updated.agentCount,
        totalInputTokens: updated.totalInputTokens,
        totalOutputTokens: updated.totalOutputTokens,
      } : undefined,
      timestamp: now,
    });
  }

  // ============================================================
  // Span lifecycle
  // ============================================================

  startSpan(opts: {
    traceId: string;
    parentSpanId?: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    agentType: string;
    agentRole: 'supervisor' | 'worker' | 'specialist';
    mission?: string;
  }): string {
    const id = uuid();
    const now = new Date().toISOString();

    const span: TraceSpan = {
      id,
      traceId: opts.traceId,
      parentSpanId: opts.parentSpanId || null,
      agentId: opts.agentId,
      agentName: opts.agentName,
      agentEmoji: opts.agentEmoji,
      agentType: opts.agentType,
      agentRole: opts.agentRole,
      mission: opts.mission || null,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      llmCallCount: 0,
      toolCallCount: 0,
      status: 'running',
      error: null,
    };

    alasql('INSERT INTO trace_spans VALUES ?', [span]);

    // Increment trace agent count
    alasql('UPDATE traces SET agentCount = agentCount + 1 WHERE id = ?', [opts.traceId]);

    // Broadcast
    this.broadcast({
      type: 'log_span_start',
      traceId: opts.traceId,
      spanId: id,
      agentId: opts.agentId,
      agentName: opts.agentName,
      agentEmoji: opts.agentEmoji,
      agentType: opts.agentType,
      timestamp: now,
    });

    return id;
  }

  endSpan(spanId: string, status: 'completed' | 'error' = 'completed', error?: string): void {
    const span = this.getSpanById(spanId);
    if (!span) return;

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(span.startedAt).getTime();

    alasql(
      'UPDATE trace_spans SET completedAt = ?, durationMs = ?, status = ?, error = ? WHERE id = ?',
      [now, durationMs, status, error || null, spanId]
    );

    this.broadcast({
      type: 'log_span_end',
      spanId,
      traceId: span.traceId,
      durationMs,
      status,
      timestamp: now,
    });
  }

  // ============================================================
  // LLM Call recording
  // ============================================================

  recordLlmCallStart(opts: {
    id: string;
    traceId?: string;
    spanId?: string;
    workload: LlmWorkload;
    provider: string;
    model: string;
    messages?: unknown[];
    systemPrompt?: string;
    tools?: unknown[];
    toolChoice?: string;
    maxTokens?: number;
    temperature?: number;
    reasoningEffort?: string;
    callerAgentId?: string;
    callerAgentName?: string;
    callerPurpose?: string;
    conversationId?: string;
  }): void {
    const now = new Date().toISOString();

    // Serialize messages with size limit
    let messagesJson: string | null = null;
    if (opts.messages) {
      try {
        const full = JSON.stringify(opts.messages);
        messagesJson = full.length > MAX_MESSAGES_JSON_SIZE
          ? full.substring(0, MAX_MESSAGES_JSON_SIZE) + '...(truncated)'
          : full;
      } catch { /* ignore serialization errors */ }
    }

    // Serialize tools
    let toolsJson: string | null = null;
    if (opts.tools && opts.tools.length > 0) {
      try {
        // Store only tool names and descriptions, not full schemas
        const toolSummaries = opts.tools.map((t: unknown) => {
          const tool = t as { name?: string; description?: string };
          return { name: tool.name, description: tool.description?.substring(0, 100) };
        });
        toolsJson = JSON.stringify(toolSummaries);
      } catch { /* ignore */ }
    }

    // Extract system prompt from messages if not provided
    let systemPrompt = opts.systemPrompt || null;
    if (!systemPrompt && opts.messages && opts.messages.length > 0) {
      const firstMsg = opts.messages[0] as { role?: string; content?: string };
      if (firstMsg.role === 'system' && typeof firstMsg.content === 'string') {
        systemPrompt = firstMsg.content;
      }
    }

    const record: LlmCallRecord = {
      id: opts.id,
      traceId: opts.traceId || null,
      spanId: opts.spanId || null,
      workload: opts.workload,
      provider: opts.provider,
      model: opts.model,
      messagesJson,
      systemPrompt,
      toolsJson,
      toolChoice: opts.toolChoice || null,
      maxTokens: opts.maxTokens || null,
      temperature: opts.temperature ?? null,
      reasoningEffort: opts.reasoningEffort || null,
      responseContent: null,
      responseToolUseJson: null,
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      streamChunksJson: null,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      callerAgentId: opts.callerAgentId || null,
      callerAgentName: opts.callerAgentName || null,
      callerPurpose: opts.callerPurpose || null,
      conversationId: opts.conversationId || null,
      status: 'pending',
      error: null,
    };

    alasql('INSERT INTO llm_calls VALUES ?', [record]);

    // Increment counters on trace and span
    if (opts.traceId) {
      alasql('UPDATE traces SET llmCallCount = llmCallCount + 1 WHERE id = ?', [opts.traceId]);
    }
    if (opts.spanId) {
      alasql('UPDATE trace_spans SET llmCallCount = llmCallCount + 1 WHERE id = ?', [opts.spanId]);
    }

    this.broadcast({
      type: 'log_llm_call_start',
      callId: opts.id,
      traceId: opts.traceId,
      spanId: opts.spanId,
      workload: opts.workload,
      model: opts.model,
      provider: opts.provider,
      timestamp: now,
    });
  }

  completeLlmCall(callId: string, result: {
    content?: string;
    toolUse?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    stopReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    streamChunks?: Array<{ text: string; timestamp: string }>;
  }): void {
    const call = this.getLlmCallById(callId);
    if (!call) return;

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(call.startedAt).getTime();

    let responseToolUseJson: string | null = null;
    if (result.toolUse && result.toolUse.length > 0) {
      try {
        responseToolUseJson = JSON.stringify(result.toolUse);
      } catch { /* ignore */ }
    }

    let streamChunksJson: string | null = null;
    if (this.storeStreamChunks && result.streamChunks && result.streamChunks.length > 0) {
      try {
        streamChunksJson = JSON.stringify(result.streamChunks);
      } catch { /* ignore */ }
    }

    alasql(
      `UPDATE llm_calls SET
        responseContent = ?,
        responseToolUseJson = ?,
        stopReason = ?,
        inputTokens = ?,
        outputTokens = ?,
        streamChunksJson = ?,
        completedAt = ?,
        durationMs = ?,
        status = ?
      WHERE id = ?`,
      [
        result.content || null,
        responseToolUseJson,
        result.stopReason || null,
        result.inputTokens || null,
        result.outputTokens || null,
        streamChunksJson,
        now,
        durationMs,
        'completed',
        callId,
      ]
    );

    // Update trace token totals
    if (call.traceId) {
      alasql(
        'UPDATE traces SET totalInputTokens = totalInputTokens + ?, totalOutputTokens = totalOutputTokens + ? WHERE id = ?',
        [result.inputTokens || 0, result.outputTokens || 0, call.traceId]
      );
    }

    this.broadcast({
      type: 'log_llm_call_end',
      callId,
      traceId: call.traceId,
      spanId: call.spanId,
      durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stopReason: result.stopReason,
      status: 'completed',
      timestamp: now,
    });
  }

  failLlmCall(callId: string, error: unknown): void {
    const call = this.getLlmCallById(callId);
    if (!call) return;

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(call.startedAt).getTime();
    const errorStr = error instanceof Error ? error.message : String(error);

    alasql(
      'UPDATE llm_calls SET completedAt = ?, durationMs = ?, status = ?, error = ? WHERE id = ?',
      [now, durationMs, 'error', errorStr, callId]
    );

    this.broadcast({
      type: 'log_llm_call_end',
      callId,
      traceId: call.traceId,
      spanId: call.spanId,
      durationMs,
      status: 'error',
      error: errorStr,
      timestamp: now,
    });
  }

  // ============================================================
  // Tool Call recording
  // ============================================================

  recordToolCallStart(opts: {
    id: string;
    traceId?: string;
    spanId?: string;
    llmCallId?: string;
    toolName: string;
    source: 'native' | 'mcp' | 'user';
    parameters?: Record<string, unknown>;
    callerAgentId?: string;
    callerAgentName?: string;
  }): void {
    const now = new Date().toISOString();

    let parametersJson: string | null = null;
    if (opts.parameters) {
      try {
        const json = JSON.stringify(opts.parameters);
        parametersJson = json.length > MAX_TOOL_RESULT_JSON_SIZE
          ? json.substring(0, MAX_TOOL_RESULT_JSON_SIZE) + '...(truncated)'
          : json;
      } catch { /* ignore */ }
    }

    const record: ToolCallRecord = {
      id: opts.id,
      traceId: opts.traceId || null,
      spanId: opts.spanId || null,
      llmCallId: opts.llmCallId || null,
      toolName: opts.toolName,
      source: opts.source,
      parametersJson,
      resultJson: null,
      success: null,
      error: null,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      callerAgentId: opts.callerAgentId || null,
      callerAgentName: opts.callerAgentName || null,
    };

    alasql('INSERT INTO tool_calls VALUES ?', [record]);

    // Increment counters
    if (opts.traceId) {
      alasql('UPDATE traces SET toolCallCount = toolCallCount + 1 WHERE id = ?', [opts.traceId]);
    }
    if (opts.spanId) {
      alasql('UPDATE trace_spans SET toolCallCount = toolCallCount + 1 WHERE id = ?', [opts.spanId]);
    }
  }

  completeToolCall(callId: string, result: unknown, success: boolean, error?: string): void {
    const now = new Date().toISOString();
    const call = this.getToolCallById(callId);
    const durationMs = call
      ? new Date(now).getTime() - new Date(call.startedAt).getTime()
      : null;

    let resultJson: string | null = null;
    if (result !== undefined) {
      try {
        const json = JSON.stringify(result);
        resultJson = json.length > MAX_TOOL_RESULT_JSON_SIZE
          ? json.substring(0, MAX_TOOL_RESULT_JSON_SIZE) + '...(truncated)'
          : json;
      } catch {
        resultJson = String(result);
      }
    }

    alasql(
      'UPDATE tool_calls SET resultJson = ?, success = ?, error = ?, completedAt = ?, durationMs = ? WHERE id = ?',
      [resultJson, success ? 1 : 0, error || null, now, durationMs, callId]
    );
  }

  // ============================================================
  // Query methods
  // ============================================================

  getTraceById(traceId: string): TraceRecord | undefined {
    const rows = alasql('SELECT * FROM traces WHERE id = ?', [traceId]) as TraceRecord[];
    return rows[0];
  }

  getTraces(options?: TraceQueryOptions): TraceRecord[] {
    const limit = Math.min(options?.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.conversationId) {
      conditions.push('conversationId = ?');
      params.push(options.conversationId);
    }
    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.since) {
      conditions.push('startedAt >= ?');
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return alasql(
      `SELECT * FROM traces ${where} ORDER BY startedAt DESC LIMIT ${limit}`,
      params
    ) as TraceRecord[];
  }

  getFullTrace(traceId: string): {
    trace: TraceRecord;
    spans: TraceSpan[];
    llmCalls: LlmCallRecord[];
    toolCalls: ToolCallRecord[];
  } | undefined {
    const trace = this.getTraceById(traceId);
    if (!trace) return undefined;

    const spans = alasql(
      'SELECT * FROM trace_spans WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as TraceSpan[];

    const llmCalls = alasql(
      'SELECT * FROM llm_calls WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as LlmCallRecord[];

    const toolCalls = alasql(
      'SELECT * FROM tool_calls WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as ToolCallRecord[];

    return { trace, spans, llmCalls, toolCalls };
  }

  getSpanById(spanId: string): TraceSpan | undefined {
    const rows = alasql('SELECT * FROM trace_spans WHERE id = ?', [spanId]) as TraceSpan[];
    return rows[0];
  }

  getSpansByTraceId(traceId: string): TraceSpan[] {
    return alasql(
      'SELECT * FROM trace_spans WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as TraceSpan[];
  }

  getLlmCallById(callId: string): LlmCallRecord | undefined {
    const rows = alasql('SELECT * FROM llm_calls WHERE id = ?', [callId]) as LlmCallRecord[];
    return rows[0];
  }

  getLlmCalls(options?: LlmCallQueryOptions): LlmCallRecord[] {
    const limit = Math.min(options?.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.traceId) {
      conditions.push('traceId = ?');
      params.push(options.traceId);
    }
    if (options?.spanId) {
      conditions.push('spanId = ?');
      params.push(options.spanId);
    }
    if (options?.workload) {
      conditions.push('workload = ?');
      params.push(options.workload);
    }
    if (options?.provider) {
      conditions.push('provider = ?');
      params.push(options.provider);
    }
    if (options?.since) {
      conditions.push('startedAt >= ?');
      params.push(options.since);
    }
    if (options?.conversationId) {
      conditions.push('conversationId = ?');
      params.push(options.conversationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return alasql(
      `SELECT * FROM llm_calls ${where} ORDER BY startedAt DESC LIMIT ${limit}`,
      params
    ) as LlmCallRecord[];
  }

  getToolCallById(callId: string): ToolCallRecord | undefined {
    const rows = alasql('SELECT * FROM tool_calls WHERE id = ?', [callId]) as ToolCallRecord[];
    return rows[0];
  }

  getToolCalls(options?: ToolCallQueryOptions): ToolCallRecord[] {
    const limit = Math.min(options?.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.traceId) {
      conditions.push('traceId = ?');
      params.push(options.traceId);
    }
    if (options?.spanId) {
      conditions.push('spanId = ?');
      params.push(options.spanId);
    }
    if (options?.llmCallId) {
      conditions.push('llmCallId = ?');
      params.push(options.llmCallId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return alasql(
      `SELECT * FROM tool_calls ${where} ORDER BY startedAt DESC LIMIT ${limit}`,
      params
    ) as ToolCallRecord[];
  }

  // ============================================================
  // Stats
  // ============================================================

  getStats(since?: string): TraceStats {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (since) {
      conditions.push('startedAt >= ?');
      params.push(since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const traceRows = alasql(`SELECT COUNT(*) as cnt FROM traces ${where}`, params) as Array<{ cnt: number }>;
    const llmRows = alasql(`SELECT COUNT(*) as cnt FROM llm_calls ${where}`, params) as Array<{ cnt: number }>;
    const toolRows = alasql(`SELECT COUNT(*) as cnt FROM tool_calls ${where}`, params) as Array<{ cnt: number }>;

    const tokenRows = alasql(
      `SELECT COALESCE(SUM(totalInputTokens), 0) as inputTok, COALESCE(SUM(totalOutputTokens), 0) as outputTok, AVG(durationMs) as avgDur FROM traces ${where}`,
      params
    ) as Array<{ inputTok: number; outputTok: number; avgDur: number }>;

    return {
      totalTraces: traceRows[0]?.cnt || 0,
      totalLlmCalls: llmRows[0]?.cnt || 0,
      totalToolCalls: toolRows[0]?.cnt || 0,
      totalInputTokens: tokenRows[0]?.inputTok || 0,
      totalOutputTokens: tokenRows[0]?.outputTok || 0,
      avgDurationMs: Math.round(tokenRows[0]?.avgDur || 0),
    };
  }

  // ============================================================
  // Maintenance
  // ============================================================

  cleanup(retentionDays?: number): number {
    const days = retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Delete in order: tool_calls, llm_calls, trace_spans, traces
    const toolCount = alasql('SELECT COUNT(*) as cnt FROM tool_calls WHERE startedAt < ?', [cutoff]) as Array<{ cnt: number }>;
    alasql('DELETE FROM tool_calls WHERE startedAt < ?', [cutoff]);

    const llmCount = alasql('SELECT COUNT(*) as cnt FROM llm_calls WHERE startedAt < ?', [cutoff]) as Array<{ cnt: number }>;
    alasql('DELETE FROM llm_calls WHERE startedAt < ?', [cutoff]);

    alasql('DELETE FROM trace_spans WHERE startedAt < ?', [cutoff]);

    const traceCount = alasql('SELECT COUNT(*) as cnt FROM traces WHERE startedAt < ?', [cutoff]) as Array<{ cnt: number }>;
    alasql('DELETE FROM traces WHERE startedAt < ?', [cutoff]);

    const total = (traceCount[0]?.cnt || 0) + (llmCount[0]?.cnt || 0) + (toolCount[0]?.cnt || 0);
    if (total > 0) {
      console.log(`[TraceStore] Cleaned up ${total} trace records older than ${days} days`);
    }
    return total;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private broadcast(data: Record<string, unknown>): void {
    if (this.channel) {
      this.channel.broadcast(data);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let globalTraceStore: TraceStore | null = null;

export function getTraceStore(): TraceStore {
  if (!globalTraceStore) {
    globalTraceStore = new TraceStore();
  }
  return globalTraceStore;
}
