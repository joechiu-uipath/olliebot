/**
 * Tracing Types
 *
 * Core type definitions for the execution tracing system.
 * Traces capture the full lifecycle of multi-agent execution:
 *   Trace → Spans (agents) → LLM Calls → Tool Calls
 */

// ============================================================
// Workload classification for LLM calls
// ============================================================

export type LlmWorkload = 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice';

// ============================================================
// Trace: Top-level execution triggered by a user message or task
// ============================================================

export interface TraceRecord {
  id: string;
  conversationId: string | null;
  turnId: string | null;
  triggerType: 'user_message' | 'task_run' | 'system';
  triggerContent: string | null;

  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  // Aggregate stats (updated as children complete)
  llmCallCount: number;
  toolCallCount: number;
  agentCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;

  status: 'running' | 'completed' | 'error';
}

// ============================================================
// TraceSpan: One agent's execution within a trace
// ============================================================

export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId: string | null;

  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentType: string;
  agentRole: 'supervisor' | 'worker' | 'specialist';
  mission: string | null;

  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  llmCallCount: number;
  toolCallCount: number;

  status: 'running' | 'completed' | 'error';
  error: string | null;
}

// ============================================================
// LlmCallRecord: A single LLM API invocation
// ============================================================

export interface LlmCallRecord {
  id: string;
  traceId: string | null;
  spanId: string | null;
  workload: LlmWorkload;
  provider: string;
  model: string;

  // Request
  messagesJson: string | null;       // JSON-serialized message array
  systemPrompt: string | null;
  toolsJson: string | null;          // JSON-serialized tools array
  toolChoice: string | null;
  maxTokens: number | null;
  temperature: number | null;
  reasoningEffort: string | null;

  // Response (assembled from streaming chunks, NOT raw SSE events)
  responseContent: string | null;
  responseToolUseJson: string | null; // JSON-serialized tool use array
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;

  // Optional: individual stream chunks with timestamps (only when TRACE_STORE_STREAM_CHUNKS=true)
  streamChunksJson: string | null;

  // Timing
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  // Context
  callerAgentId: string | null;
  callerAgentName: string | null;
  callerPurpose: string | null;
  conversationId: string | null;

  // Status
  status: 'pending' | 'streaming' | 'completed' | 'error';
  error: string | null;
}

// ============================================================
// ToolCallRecord: A single tool invocation
// ============================================================

export interface ToolCallRecord {
  id: string;
  traceId: string | null;
  spanId: string | null;
  llmCallId: string | null;

  toolName: string;
  source: 'native' | 'mcp' | 'user';
  parametersJson: string | null;

  resultJson: string | null;
  success: number | null;     // 0 or 1 (AlaSQL doesn't have boolean)
  error: string | null;

  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  callerAgentId: string | null;
  callerAgentName: string | null;
}

// ============================================================
// Context passed to TracingLLMService for associating calls
// ============================================================

export interface TraceContext {
  traceId?: string;
  spanId?: string;
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  purpose?: string;
}

// ============================================================
// Query options
// ============================================================

export interface TraceQueryOptions {
  limit?: number;
  conversationId?: string;
  status?: string;
  since?: string;
}

export interface LlmCallQueryOptions {
  limit?: number;
  traceId?: string;
  spanId?: string;
  workload?: LlmWorkload;
  provider?: string;
  since?: string;
  conversationId?: string;
}

export interface ToolCallQueryOptions {
  limit?: number;
  traceId?: string;
  spanId?: string;
  llmCallId?: string;
}

export interface TraceStats {
  totalTraces: number;
  totalLlmCalls: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
}
