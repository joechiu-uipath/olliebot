/**
 * TraceStore - Central service for managing execution traces.
 *
 * Handles the lifecycle of traces, spans, LLM calls, and tool calls.
 * Persists data to the shared better-sqlite3 database.
 * Provides query methods for the API layer.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type {
  TraceRecord,
  TraceSpan,
  LlmCallRecord,
  ToolCallRecord,
  LlmWorkload,
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
   * Initialize SQLite tables for tracing data.
   * Called during app startup after DB init.
   */
  init(): void {
    if (this.initialized) return;

    const db = getDb();

    db.rawRun(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        conversationId TEXT,
        turnId TEXT,
        triggerType TEXT NOT NULL,
        triggerContent TEXT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER,
        llmCallCount INTEGER NOT NULL DEFAULT 0,
        toolCallCount INTEGER NOT NULL DEFAULT 0,
        agentCount INTEGER NOT NULL DEFAULT 0,
        totalInputTokens INTEGER NOT NULL DEFAULT 0,
        totalOutputTokens INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running'
      )
    `);

    db.rawRun(`
      CREATE TABLE IF NOT EXISTS trace_spans (
        id TEXT PRIMARY KEY,
        traceId TEXT NOT NULL,
        parentSpanId TEXT,
        agentId TEXT NOT NULL,
        agentName TEXT NOT NULL,
        agentEmoji TEXT,
        agentType TEXT,
        agentRole TEXT,
        mission TEXT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER,
        llmCallCount INTEGER NOT NULL DEFAULT 0,
        toolCallCount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        error TEXT
      )
    `);

    db.rawRun(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id TEXT PRIMARY KEY,
        traceId TEXT,
        spanId TEXT,
        workload TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        messagesJson TEXT,
        systemPrompt TEXT,
        toolsJson TEXT,
        toolChoice TEXT,
        maxTokens INTEGER,
        temperature REAL,
        reasoningEffort TEXT,
        responseContent TEXT,
        responseToolUseJson TEXT,
        stopReason TEXT,
        inputTokens INTEGER,
        outputTokens INTEGER,
        streamChunksJson TEXT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER,
        callerAgentId TEXT,
        callerAgentName TEXT,
        callerPurpose TEXT,
        conversationId TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
      )
    `);

    db.rawRun(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        traceId TEXT,
        spanId TEXT,
        llmCallId TEXT,
        toolName TEXT NOT NULL,
        source TEXT NOT NULL,
        parametersJson TEXT,
        resultJson TEXT,
        filesJson TEXT,
        success INTEGER,
        error TEXT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER,
        callerAgentId TEXT,
        callerAgentName TEXT
      )
    `);

    db.rawRun(`
      CREATE TABLE IF NOT EXISTS token_reductions (
        id TEXT PRIMARY KEY,
        llmCallId TEXT NOT NULL REFERENCES llm_calls(id),
        provider TEXT NOT NULL,
        originalTokens INTEGER NOT NULL,
        compressedTokens INTEGER NOT NULL,
        compressionTimeMs INTEGER NOT NULL,
        originalText TEXT,
        compressedText TEXT,
        createdAt TEXT NOT NULL
      )
    `);

    // Migration: add filesJson column if missing (for existing databases)
    try {
      db.rawRun('ALTER TABLE tool_calls ADD COLUMN filesJson TEXT');
    } catch {
      // Column already exists, ignore
    }

    // Indexes for frequent query patterns
    db.rawExec(`
      CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(startedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
      CREATE INDEX IF NOT EXISTS idx_traces_conversation ON traces(conversationId);
      CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON trace_spans(traceId);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_trace ON llm_calls(traceId);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_span ON llm_calls(spanId);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_started ON llm_calls(startedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_workload ON llm_calls(workload);
      CREATE INDEX IF NOT EXISTS idx_token_reductions_llm_call ON token_reductions(llmCallId);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_trace ON tool_calls(traceId);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_span ON tool_calls(spanId);
    `);

    this.initialized = true;
    console.log('[TraceStore] Initialized tracing tables');

    // Run cleanup on startup to remove old traces
    const retentionDays = parseInt(process.env.TRACE_RETENTION_DAYS || '', 10) || DEFAULT_RETENTION_DAYS;
    this.cleanup(retentionDays);
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

    const db = getDb();
    db.rawRun(
      `INSERT INTO traces (id, conversationId, turnId, triggerType, triggerContent, startedAt, completedAt, durationMs, llmCallCount, toolCallCount, agentCount, totalInputTokens, totalOutputTokens, status)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, 0, 0, 'running')`,
      [id, opts.conversationId || null, opts.turnId || null, opts.triggerType, opts.triggerContent?.substring(0, 200) || null, now]
    );

    // Broadcast
    this.broadcast({
      type: 'log_trace_start',
      traceId: id,
      triggerType: opts.triggerType,
      triggerContent: opts.triggerContent?.substring(0, 200) || null,
      conversationId: opts.conversationId || null,
      timestamp: now,
    });

    return id;
  }

  endTrace(traceId: string, status: 'completed' | 'error' = 'completed'): void {
    const trace = this.getTraceById(traceId);
    if (!trace) return;

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(trace.startedAt).getTime();

    const db = getDb();
    db.rawRun(
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

    const db = getDb();
    db.rawRun(
      `INSERT INTO trace_spans (id, traceId, parentSpanId, agentId, agentName, agentEmoji, agentType, agentRole, mission, startedAt, completedAt, durationMs, llmCallCount, toolCallCount, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 'running', NULL)`,
      [id, opts.traceId, opts.parentSpanId || null, opts.agentId, opts.agentName, opts.agentEmoji, opts.agentType, opts.agentRole, opts.mission || null, now]
    );

    // Increment trace agent count
    db.rawRun('UPDATE traces SET agentCount = agentCount + 1 WHERE id = ?', [opts.traceId]);

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

    const db = getDb();
    db.rawRun(
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

    const db = getDb();
    db.rawRun(
      `INSERT INTO llm_calls (id, traceId, spanId, workload, provider, model, messagesJson, systemPrompt, toolsJson, toolChoice, maxTokens, temperature, reasoningEffort, responseContent, responseToolUseJson, stopReason, inputTokens, outputTokens, streamChunksJson, startedAt, completedAt, durationMs, callerAgentId, callerAgentName, callerPurpose, conversationId, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'pending', NULL)`,
      [
        opts.id,
        opts.traceId || null,
        opts.spanId || null,
        opts.workload,
        opts.provider,
        opts.model,
        messagesJson,
        systemPrompt,
        toolsJson,
        opts.toolChoice || null,
        opts.maxTokens || null,
        opts.temperature ?? null,
        opts.reasoningEffort || null,
        now,
        opts.callerAgentId || null,
        opts.callerAgentName || null,
        opts.callerPurpose || null,
        opts.conversationId || null,
      ]
    );

    // Increment counters on trace and span
    if (opts.traceId) {
      db.rawRun('UPDATE traces SET llmCallCount = llmCallCount + 1 WHERE id = ?', [opts.traceId]);
    }
    if (opts.spanId) {
      db.rawRun('UPDATE trace_spans SET llmCallCount = llmCallCount + 1 WHERE id = ?', [opts.spanId]);
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

    const db = getDb();
    db.rawRun(
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
        result.inputTokens ?? null,
        result.outputTokens ?? null,
        streamChunksJson,
        now,
        durationMs,
        'completed',
        callId,
      ]
    );

    // Update trace token totals
    if (call.traceId) {
      db.rawRun(
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

    const db = getDb();
    db.rawRun(
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
  // Token Reduction recording
  // ============================================================

  recordTokenReduction(callId: string, data: {
    provider: string;
    originalTokens: number;
    compressedTokens: number;
    compressionTimeMs: number;
    originalText?: string;
    compressedText?: string;
  }): void {
    const db = getDb();
    const id = uuid();
    const now = new Date().toISOString();
    // Truncate texts for storage (keep first 2000 chars for inspection)
    const originalText = data.originalText?.substring(0, 2000) || null;
    const compressedText = data.compressedText?.substring(0, 2000) || null;

    db.rawRun(
      `INSERT INTO token_reductions (id, llmCallId, provider, originalTokens, compressedTokens, compressionTimeMs, originalText, compressedText, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        callId,
        data.provider,
        data.originalTokens,
        data.compressedTokens,
        data.compressionTimeMs,
        originalText,
        compressedText,
        now,
      ]
    );
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

    const db = getDb();
    db.rawRun(
      `INSERT INTO tool_calls (id, traceId, spanId, llmCallId, toolName, source, parametersJson, resultJson, success, error, startedAt, completedAt, durationMs, callerAgentId, callerAgentName)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      [
        opts.id,
        opts.traceId || null,
        opts.spanId || null,
        opts.llmCallId || null,
        opts.toolName,
        opts.source,
        parametersJson,
        now,
        opts.callerAgentId || null,
        opts.callerAgentName || null,
      ]
    );

    // Increment counters
    if (opts.traceId) {
      db.rawRun('UPDATE traces SET toolCallCount = toolCallCount + 1 WHERE id = ?', [opts.traceId]);
    }
    if (opts.spanId) {
      db.rawRun('UPDATE trace_spans SET toolCallCount = toolCallCount + 1 WHERE id = ?', [opts.spanId]);
    }
  }

  completeToolCall(
    callId: string,
    result: unknown,
    success: boolean,
    error?: string,
    files?: Array<{ name: string; dataUrl: string; size: number; mediaType?: string }>
  ): void {
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

    let filesJson: string | null = null;
    if (files && files.length > 0) {
      try {
        filesJson = JSON.stringify(files);
      } catch { /* ignore serialization errors */ }
    }

    const db = getDb();
    db.rawRun(
      'UPDATE tool_calls SET resultJson = ?, filesJson = ?, success = ?, error = ?, completedAt = ?, durationMs = ? WHERE id = ?',
      [resultJson, filesJson, success ? 1 : 0, error || null, now, durationMs, callId]
    );
  }

  // ============================================================
  // Query methods
  // ============================================================

  getTraceById(traceId: string): TraceRecord | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM traces WHERE id = ?', [traceId]) as TraceRecord[];
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
    const db = getDb();
    params.push(limit);
    return db.rawQuery(
      `SELECT * FROM traces ${where} ORDER BY startedAt DESC LIMIT ?`,
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

    const db = getDb();
    const spans = db.rawQuery(
      'SELECT * FROM trace_spans WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as TraceSpan[];

    const llmCalls = db.rawQuery(
      `SELECT c.*,
        CASE WHEN tr.id IS NOT NULL THEN 1 ELSE NULL END AS tokenReductionEnabled,
        tr.provider AS tokenReductionProvider,
        tr.originalTokens AS tokenReductionOriginalTokens,
        tr.compressedTokens AS tokenReductionCompressedTokens,
        tr.compressionTimeMs AS tokenReductionTimeMs,
        tr.originalText AS tokenReductionOriginalText,
        tr.compressedText AS tokenReductionCompressedText
      FROM llm_calls c
      LEFT JOIN token_reductions tr ON tr.llmCallId = c.id
      WHERE c.traceId = ? ORDER BY c.startedAt ASC`,
      [traceId]
    ) as LlmCallRecord[];

    const toolCalls = db.rawQuery(
      'SELECT * FROM tool_calls WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as ToolCallRecord[];

    return { trace, spans, llmCalls, toolCalls };
  }

  getSpanById(spanId: string): TraceSpan | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM trace_spans WHERE id = ?', [spanId]) as TraceSpan[];
    return rows[0];
  }

  getSpansByTraceId(traceId: string): TraceSpan[] {
    const db = getDb();
    return db.rawQuery(
      'SELECT * FROM trace_spans WHERE traceId = ? ORDER BY startedAt ASC',
      [traceId]
    ) as TraceSpan[];
  }

  getLlmCallById(callId: string): LlmCallRecord | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      `SELECT c.*,
        CASE WHEN tr.id IS NOT NULL THEN 1 ELSE NULL END AS tokenReductionEnabled,
        tr.provider AS tokenReductionProvider,
        tr.originalTokens AS tokenReductionOriginalTokens,
        tr.compressedTokens AS tokenReductionCompressedTokens,
        tr.compressionTimeMs AS tokenReductionTimeMs,
        tr.originalText AS tokenReductionOriginalText,
        tr.compressedText AS tokenReductionCompressedText
      FROM llm_calls c
      LEFT JOIN token_reductions tr ON tr.llmCallId = c.id
      WHERE c.id = ?`,
      [callId]
    ) as LlmCallRecord[];
    return rows[0];
  }

  getLlmCalls(options?: LlmCallQueryOptions): LlmCallRecord[] {
    const limit = Math.min(options?.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.traceId) {
      conditions.push('c.traceId = ?');
      params.push(options.traceId);
    }
    if (options?.spanId) {
      conditions.push('c.spanId = ?');
      params.push(options.spanId);
    }
    if (options?.workload) {
      conditions.push('c.workload = ?');
      params.push(options.workload);
    }
    if (options?.provider) {
      conditions.push('c.provider = ?');
      params.push(options.provider);
    }
    if (options?.since) {
      conditions.push('c.startedAt >= ?');
      params.push(options.since);
    }
    if (options?.conversationId) {
      conditions.push('c.conversationId = ?');
      params.push(options.conversationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const db = getDb();
    params.push(limit);
    return db.rawQuery(
      `SELECT c.*,
        CASE WHEN tr.id IS NOT NULL THEN 1 ELSE NULL END AS tokenReductionEnabled,
        tr.provider AS tokenReductionProvider,
        tr.originalTokens AS tokenReductionOriginalTokens,
        tr.compressedTokens AS tokenReductionCompressedTokens,
        tr.compressionTimeMs AS tokenReductionTimeMs,
        tr.originalText AS tokenReductionOriginalText,
        tr.compressedText AS tokenReductionCompressedText
      FROM llm_calls c
      LEFT JOIN token_reductions tr ON tr.llmCallId = c.id
      ${where} ORDER BY c.startedAt DESC LIMIT ?`,
      params
    ) as LlmCallRecord[];
  }

  getToolCallById(callId: string): ToolCallRecord | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM tool_calls WHERE id = ?', [callId]) as ToolCallRecord[];
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
    const db = getDb();
    params.push(limit);
    return db.rawQuery(
      `SELECT * FROM tool_calls ${where} ORDER BY startedAt DESC LIMIT ?`,
      params
    ) as ToolCallRecord[];
  }

  // ============================================================
  // Stats
  // ============================================================

  getStats(since?: string): TraceStats {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (since) {
      conditions.push('startedAt >= ?');
      params.push(since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const traceRows = db.rawQuery(`SELECT COUNT(*) as cnt FROM traces ${where}`, params) as Array<{ cnt: number }>;
    const llmRows = db.rawQuery(`SELECT COUNT(*) as cnt FROM llm_calls ${where}`, params) as Array<{ cnt: number }>;
    const toolRows = db.rawQuery(`SELECT COUNT(*) as cnt FROM tool_calls ${where}`, params) as Array<{ cnt: number }>;

    const tokenRows = db.rawQuery(
      `SELECT COALESCE(SUM(totalInputTokens), 0) as inputTok, COALESCE(SUM(totalOutputTokens), 0) as outputTok, AVG(durationMs) as avgDur FROM traces ${where}`,
      params
    ) as Array<{ inputTok: number; outputTok: number; avgDur: number }>;

    // Token reduction stats (from dedicated token_reductions table)
    const trWhere = conditions.length > 0
      ? `WHERE ${conditions.map(c => c.replace('startedAt', 'createdAt')).join(' AND ')}`
      : '';
    const trRows = db.rawQuery(
      `SELECT
        COUNT(*) as cnt,
        COALESCE(SUM(originalTokens), 0) as origTok,
        COALESCE(SUM(compressedTokens), 0) as compTok,
        COALESCE(SUM(compressionTimeMs), 0) as totalTime,
        AVG(compressionTimeMs) as avgTime
      FROM token_reductions ${trWhere}`,
      params
    ) as Array<{ cnt: number; origTok: number; compTok: number; totalTime: number; avgTime: number }>;

    const trData = trRows[0];
    const tokensSaved = (trData?.origTok || 0) - (trData?.compTok || 0);
    const overallSavingsPercent = trData?.origTok > 0
      ? Math.round((tokensSaved / trData.origTok) * 10000) / 100
      : 0;

    return {
      totalTraces: traceRows[0]?.cnt || 0,
      totalLlmCalls: llmRows[0]?.cnt || 0,
      totalToolCalls: toolRows[0]?.cnt || 0,
      totalInputTokens: tokenRows[0]?.inputTok || 0,
      totalOutputTokens: tokenRows[0]?.outputTok || 0,
      avgDurationMs: Math.round(tokenRows[0]?.avgDur || 0),
      tokenReduction: trData?.cnt > 0 ? {
        totalCompressions: trData.cnt,
        totalOriginalTokens: trData.origTok,
        totalCompressedTokens: trData.compTok,
        totalTokensSaved: tokensSaved,
        overallSavingsPercent,
        totalCompressionTimeMs: trData.totalTime,
        avgCompressionTimeMs: Math.round(trData.avgTime || 0),
      } : undefined,
    };
  }

  // ============================================================
  // Maintenance
  // ============================================================

  cleanup(retentionDays?: number): number {
    const days = retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getDb();
    // Delete in order: token_reductions, tool_calls, llm_calls, trace_spans, traces
    db.rawRun('DELETE FROM token_reductions WHERE createdAt < ?', [cutoff]);
    const toolCount = db.rawRun('DELETE FROM tool_calls WHERE startedAt < ?', [cutoff]);
    const llmCount = db.rawRun('DELETE FROM llm_calls WHERE startedAt < ?', [cutoff]);
    db.rawRun('DELETE FROM trace_spans WHERE startedAt < ?', [cutoff]);
    const traceCount = db.rawRun('DELETE FROM traces WHERE startedAt < ?', [cutoff]);

    const total = traceCount + llmCount + toolCount;
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
