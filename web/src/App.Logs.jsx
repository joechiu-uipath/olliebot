/**
 * Logs mode components - provides execution trace visibility.
 * Shows LLM calls, agent spans, tool invocations, and full trace details.
 * Separated from App.jsx for cleaner code organization (follows App.Eval.jsx pattern).
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

// ============================================================
// Constants
// ============================================================

const API_BASE = '';
const POLL_INTERVAL_MS = 5000;

// ============================================================
// Hook: useLogsMode
// ============================================================

export function useLogsMode() {
  // Read traceId and llmCallId from URL search params (for deep-linking)
  const [searchParams] = useSearchParams();
  const urlTraceId = searchParams.get('traceId');
  const urlLlmCallId = searchParams.get('llmCallId');

  // Check if we're on the /traces route (to control polling)
  const location = useLocation();
  const isTracesRoute = location.pathname === '/traces';

  // Data
  const [traces, setTraces] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedTrace, setSelectedTrace] = useState(null); // full trace detail
  const [selectedLlmCall, setSelectedLlmCall] = useState(null); // single LLM call detail
  const [llmCalls, setLlmCalls] = useState([]); // flat LLM calls list

  // Filters
  const [activeView, setActiveView] = useState('traces'); // 'traces' | 'llm-calls'
  const [workloadFilter, setWorkloadFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Track which IDs we've already auto-loaded (to avoid re-fetching on re-renders)
  const lastHandledTraceIdRef = useRef(null);
  const lastHandledLlmCallIdRef = useRef(null);

  // Loading
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auto-refresh
  const intervalRef = useRef(null);

  // ---- Fetch helpers ----

  const fetchTraces = useCallback(async () => {
    const params = new URLSearchParams({ limit: '50' });
    if (statusFilter) params.set('status', statusFilter);
    const res = await fetch(`${API_BASE}/api/traces/traces?${params}`).catch(() => null);
    if (!res?.ok) {
      console.error('[Logs] Failed to fetch traces');
      return;
    }
    const data = await res.json();
    setTraces(data);
  }, [statusFilter]);

  const fetchLlmCalls = useCallback(async () => {
    const params = new URLSearchParams({ limit: '50' });
    if (workloadFilter) params.set('workload', workloadFilter);
    const res = await fetch(`${API_BASE}/api/traces/llm-calls?${params}`).catch(() => null);
    if (!res?.ok) {
      console.error('[Logs] Failed to fetch LLM calls');
      return;
    }
    const data = await res.json();
    setLlmCalls(data);
  }, [workloadFilter]);

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/traces/stats`).catch(() => null);
    if (!res?.ok) {
      console.error('[Logs] Failed to fetch stats');
      return;
    }
    const data = await res.json();
    setStats(data);
  }, []);

  const fetchFullTrace = useCallback(async (traceId) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`${API_BASE}/api/traces/traces/${traceId}`).catch(() => null);
    if (!res?.ok) {
      console.error('[Logs] Failed to fetch trace detail');
      setError('Failed to fetch trace');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setSelectedTrace(data);
    setLoading(false);
  }, []);

  const fetchLlmCallDetail = useCallback(async (callId) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`${API_BASE}/api/traces/llm-calls/${callId}`).catch(() => null);
    if (!res?.ok) {
      console.error('[Logs] Failed to fetch LLM call detail');
      setError('Failed to fetch LLM call');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setSelectedLlmCall(data);
    setLoading(false);
  }, []);

  // ---- Initial load + polling ----

  const refresh = useCallback(() => {
    fetchStats();
    if (activeView === 'traces') fetchTraces();
    else fetchLlmCalls();
  }, [activeView, fetchTraces, fetchLlmCalls, fetchStats]);

  // Only poll when on the /traces route
  useEffect(() => {
    if (!isTracesRoute) {
      return;
    }
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [refresh, isTracesRoute]);

  // Handle trace ID from URL (deep-link from chat)
  useEffect(() => {
    if (urlTraceId && urlTraceId !== lastHandledTraceIdRef.current) {
      lastHandledTraceIdRef.current = urlTraceId;
      fetchFullTrace(urlTraceId);
    }
  }, [urlTraceId, fetchFullTrace]);

  // Handle LLM call ID from URL (deep-link to specific call)
  useEffect(() => {
    if (urlLlmCallId && urlLlmCallId !== lastHandledLlmCallIdRef.current) {
      lastHandledLlmCallIdRef.current = urlLlmCallId;
      fetchLlmCallDetail(urlLlmCallId);
    } else if (!urlLlmCallId && lastHandledLlmCallIdRef.current) {
      // URL no longer has llmCallId - clear selection
      lastHandledLlmCallIdRef.current = null;
      setSelectedLlmCall(null);
    }
  }, [urlLlmCallId, fetchLlmCallDetail]);

  // ---- WebSocket handler for real-time updates ----

  const handleLogEvent = useCallback((data) => {
    const { type } = data;

    if (type === 'log_trace_start') {
      setTraces((prev) => [{
        id: data.traceId,
        triggerType: data.triggerType,
        triggerContent: data.triggerContent,
        conversationId: data.conversationId,
        startedAt: data.timestamp,
        status: 'running',
        llmCallCount: 0,
        toolCallCount: 0,
        agentCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        completedAt: null,
        durationMs: null,
      }, ...prev]);
    }

    if (type === 'log_trace_end') {
      setTraces((prev) => prev.map((t) =>
        t.id === data.traceId
          ? { ...t, status: data.status, durationMs: data.durationMs, completedAt: data.timestamp, ...(data.stats || {}) }
          : t
      ));
      // Refresh stats on trace end
      fetchStats();
    }

    if (type === 'log_llm_call_start') {
      setLlmCalls((prev) => [{
        id: data.callId,
        traceId: data.traceId,
        spanId: data.spanId,
        workload: data.workload,
        model: data.model,
        provider: data.provider,
        startedAt: data.timestamp,
        status: 'pending',
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      }, ...prev]);
      // Increment trace LLM count in local state
      setTraces((prev) => prev.map((t) =>
        t.id === data.traceId
          ? { ...t, llmCallCount: (t.llmCallCount || 0) + 1 }
          : t
      ));
    }

    if (type === 'log_llm_call_end') {
      setLlmCalls((prev) => prev.map((c) =>
        c.id === data.callId
          ? { ...c, status: data.status, durationMs: data.durationMs, inputTokens: data.inputTokens, outputTokens: data.outputTokens, stopReason: data.stopReason }
          : c
      ));
    }

    if (type === 'log_span_start') {
      // Increment trace agent count
      setTraces((prev) => prev.map((t) =>
        t.id === data.traceId
          ? { ...t, agentCount: (t.agentCount || 0) + 1 }
          : t
      ));
    }
  }, [fetchStats]);

  return {
    // Data
    traces,
    stats,
    llmCalls,
    selectedTrace,
    selectedLlmCall,

    // URL params (for navigation)
    urlTraceId,

    // View
    activeView,
    setActiveView,

    // Filters
    workloadFilter,
    setWorkloadFilter,
    statusFilter,
    setStatusFilter,

    // Actions
    fetchFullTrace,
    fetchLlmCallDetail,
    setSelectedTrace,
    setSelectedLlmCall,
    refresh,

    // Status
    loading,
    error,

    // WebSocket handler
    handleLogEvent,
  };
}

// ============================================================
// Helper components
// ============================================================

function formatDuration(ms) {
  if (ms == null) return '...';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function formatTokens(n) {
  if (n == null) return '-';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function savingsPercent(original, compressed) {
  const origNum = Number(original);
  const compNum = Number(compressed);

  if (!Number.isFinite(origNum) || !Number.isFinite(compNum) || origNum <= 0) {
    return 0;
  }

  const rawPercent = ((origNum - compNum) / origNum) * 100;
  const clampedPercent = Math.max(0, Math.min(100, rawPercent));

  return Math.round(clampedPercent * 100) / 100;
}

function StatusBadge({ status }) {
  const cls = status === 'running' || status === 'pending' || status === 'streaming'
    ? 'logs-badge running'
    : status === 'completed'
      ? 'logs-badge completed'
      : 'logs-badge error';
  return <span className={cls}>{status}</span>;
}

function WorkloadBadge({ workload }) {
  return <span className={`logs-badge workload-${workload}`}>{workload}</span>;
}

function StopReasonBadge({ stopReason }) {
  // Stop reasons that indicate failures/issues
  const errorReasons = ['content_filter', 'length', 'error', 'cancelled'];
  const isError = errorReasons.includes(stopReason);
  const cls = isError ? 'logs-badge error' : 'logs-badge completed';
  return <span className={cls}>{stopReason}</span>;
}

// ============================================================
// Sidebar: stats summary
// ============================================================

export const LogsSidebarContent = memo(function LogsSidebarContent({ logsMode }) {
  const { stats, activeView, setActiveView, statusFilter, setStatusFilter,
    workloadFilter, setWorkloadFilter, refresh } = logsMode;

  return (
    <div className="logs-sidebar">
      <div className="logs-sidebar-header">
        <h3>Traces</h3>
        <button className="logs-refresh-btn" onClick={refresh} title="Refresh">&#x21bb;</button>
      </div>

      {/* Stats summary */}
      {stats && (
        <div className="logs-stats-grid">
          <div className="logs-stat">
            <div className="logs-stat-value">{stats.totalTraces}</div>
            <div className="logs-stat-label">Traces</div>
          </div>
          <div className="logs-stat">
            <div className="logs-stat-value">{stats.totalLlmCalls}</div>
            <div className="logs-stat-label">LLM Calls</div>
          </div>
          <div className="logs-stat">
            <div className="logs-stat-value">{stats.totalToolCalls}</div>
            <div className="logs-stat-label">Tool Calls</div>
          </div>
          <div className="logs-stat">
            <div className="logs-stat-value">{formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}</div>
            <div className="logs-stat-label">Tokens</div>
          </div>
        </div>
      )}

      {/* Token Reduction Settings & Stats (only show when token reduction is currently enabled) */}
      {stats?.tokenReductionEnabled && stats?.tokenReduction && (
        <div className="logs-token-reduction-stats">
          <h4 className="logs-token-reduction-title">Token Reduction</h4>
          <div className="logs-stats-grid">
            <div className="logs-stat">
              <div className="logs-stat-value logs-stat-savings">{stats.tokenReduction.overallSavingsPercent}%</div>
              <div className="logs-stat-label">Saved</div>
            </div>
            <div className="logs-stat">
              <div className="logs-stat-value">{formatTokens(stats.tokenReduction.totalTokensSaved)}</div>
              <div className="logs-stat-label">Tokens Saved</div>
            </div>
            <div className="logs-stat">
              <div className="logs-stat-value">{stats.tokenReduction.totalCompressions}</div>
              <div className="logs-stat-label">Compressions</div>
            </div>
            <div className="logs-stat">
              <div className="logs-stat-value">{stats.tokenReduction.avgCompressionTimeMs}ms</div>
              <div className="logs-stat-label">Avg Time</div>
            </div>
          </div>
        </div>
      )}

      {/* View switcher */}
      <div className="logs-view-switcher">
        <button
          className={`logs-view-btn ${activeView === 'traces' ? 'active' : ''}`}
          onClick={() => setActiveView('traces')}
        >
          Traces
        </button>
        <button
          className={`logs-view-btn ${activeView === 'llm-calls' ? 'active' : ''}`}
          onClick={() => setActiveView('llm-calls')}
        >
          LLM Calls
        </button>
      </div>

      {/* Filters */}
      <div className="logs-filters">
        {activeView === 'traces' && (
          <select
            className="logs-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="error">Error</option>
          </select>
        )}
        {activeView === 'llm-calls' && (
          <select
            className="logs-filter-select"
            value={workloadFilter}
            onChange={(e) => setWorkloadFilter(e.target.value)}
          >
            <option value="">All workloads</option>
            <option value="main">Main</option>
            <option value="fast">Fast</option>
            <option value="embedding">Embedding</option>
            <option value="image_gen">Image Gen</option>
            <option value="browser">Browser</option>
            <option value="voice">Voice</option>
          </select>
        )}
      </div>
    </div>
  );
});

// ============================================================
// Main content
// ============================================================

export const LogsMainContent = memo(function LogsMainContent({ logsMode }) {
  const navigate = useNavigate();
  const { activeView, traces, llmCalls, selectedTrace, selectedLlmCall,
    fetchFullTrace, fetchLlmCallDetail, setSelectedTrace, setSelectedLlmCall,
    urlTraceId, loading, error } = logsMode;

  // Select a trace (updates URL and fetches details)
  const handleSelectTrace = useCallback((traceId) => {
    navigate(`/traces?traceId=${traceId}`, { replace: true });
    fetchFullTrace(traceId);
  }, [navigate, fetchFullTrace]);

  // Select an LLM call from trace detail (updates URL with llmCallId)
  const handleSelectLlmCall = useCallback((callId) => {
    const traceId = urlTraceId || selectedTrace?.trace?.id;
    if (traceId) {
      navigate(`/traces?traceId=${traceId}&llmCallId=${callId}`, { replace: true });
    }
    fetchLlmCallDetail(callId);
  }, [navigate, urlTraceId, selectedTrace, fetchLlmCallDetail]);

  // Select an LLM call from the global LLM calls list (includes call's own traceId for back navigation)
  const handleSelectLlmCallFromList = useCallback((call) => {
    if (call.traceId) {
      navigate(`/traces?traceId=${call.traceId}&llmCallId=${call.id}`, { replace: true });
    } else {
      navigate(`/traces?llmCallId=${call.id}`, { replace: true });
    }
    fetchLlmCallDetail(call.id);
  }, [navigate, fetchLlmCallDetail]);

  // Back from trace detail to traces list
  const handleBackToTraces = useCallback(() => {
    navigate('/traces', { replace: true });
    setSelectedTrace(null);
    setSelectedLlmCall(null);
  }, [navigate, setSelectedTrace, setSelectedLlmCall]);

  // Back from LLM call detail to trace detail (or traces list if no trace context)
  const handleBackToTrace = useCallback(() => {
    const traceId = urlTraceId || selectedTrace?.trace?.id;
    if (traceId) {
      navigate(`/traces?traceId=${traceId}`, { replace: true });
    } else {
      // No trace context - go back to traces list
      navigate('/traces', { replace: true });
    }
    setSelectedLlmCall(null);
  }, [navigate, urlTraceId, selectedTrace, setSelectedLlmCall]);

  // ---- Detail views ----
  if (selectedLlmCall) {
    // Get sibling LLM calls from the same trace for prev/next navigation
    const siblingCalls = selectedTrace?.llmCalls || [];
    return (
      <LlmCallDetailView
        call={selectedLlmCall}
        onBack={handleBackToTrace}
        siblingCalls={siblingCalls}
        onSelectLlmCall={handleSelectLlmCall}
      />
    );
  }
  if (selectedTrace) {
    return (
      <TraceDetailView
        trace={selectedTrace}
        onBack={handleBackToTraces}
        onSelectLlmCall={handleSelectLlmCall}
        loading={loading}
      />
    );
  }

  // ---- List views ----
  return (
    <div className="logs-main">
      {error && <div className="logs-error">{error}</div>}

      {activeView === 'traces' && (
        <div className="logs-list">
          <div className="logs-list-header">
            <span className="logs-col-trigger">Trigger</span>
            <span className="logs-col-agents">Agents</span>
            <span className="logs-col-llm">LLM</span>
            <span className="logs-col-tools">Tools</span>
            <span className="logs-col-tokens">Tokens</span>
            <span className="logs-col-duration">Duration</span>
            <span className="logs-col-status">Status</span>
            <span className="logs-col-time">Time</span>
          </div>
          {traces.length === 0 && !loading && (
            <div className="logs-empty">No traces yet. Send a message to generate traces.</div>
          )}
          {traces.map((t) => (
            <div key={t.id} className="logs-list-row" onClick={() => handleSelectTrace(t.id)}>
              <span className="logs-col-trigger" title={t.triggerContent || ''}>
                <span className="logs-trigger-type">{t.triggerType === 'user_message' ? '💬' : t.triggerType === 'task_run' ? '⏰' : '⚙️'}</span>
                {t.triggerContent ? t.triggerContent.substring(0, 40) : t.triggerType}
              </span>
              <span className="logs-col-agents">{t.agentCount}</span>
              <span className="logs-col-llm">{t.llmCallCount}</span>
              <span className="logs-col-tools">{t.toolCallCount}</span>
              <span className="logs-col-tokens">{formatTokens((t.totalInputTokens || 0) + (t.totalOutputTokens || 0))}</span>
              <span className="logs-col-duration">{formatDuration(t.durationMs)}</span>
              <span className="logs-col-status"><StatusBadge status={t.status} /></span>
              <span className="logs-col-time">{formatTimestamp(t.startedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {activeView === 'llm-calls' && (
        <div className="logs-list">
          <div className="logs-list-header">
            <span className="logs-col-workload">Workload</span>
            <span className="logs-col-model">Model</span>
            <span className="logs-col-agent">Agent</span>
            <span className="logs-col-tokens">In / Out</span>
            <span className="logs-col-duration">Duration</span>
            <span className="logs-col-status">Status</span>
            <span className="logs-col-time">Time</span>
          </div>
          {llmCalls.length === 0 && !loading && (
            <div className="logs-empty">No LLM calls yet.</div>
          )}
          {llmCalls.map((c) => (
            <div key={c.id} className="logs-list-row" onClick={() => handleSelectLlmCallFromList(c)}>
              <span className="logs-col-workload"><WorkloadBadge workload={c.workload} /></span>
              <span className="logs-col-model" title={c.model}>{c.model?.split('/').pop() || c.model}</span>
              <span className="logs-col-agent">{c.callerAgentName || '-'}</span>
              <span className="logs-col-tokens">{formatTokens(c.inputTokens)} / {formatTokens(c.outputTokens)}</span>
              <span className="logs-col-duration">{formatDuration(c.durationMs)}</span>
              <span className="logs-col-status"><StatusBadge status={c.status} /></span>
              <span className="logs-col-time">{formatTimestamp(c.startedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ============================================================
// Trace detail view
// ============================================================

const TraceDetailView = memo(function TraceDetailView({ trace, onBack, onSelectLlmCall, loading }) {
  if (!trace) return null;
  const { trace: t, spans, llmCalls, toolCalls } = trace;

  return (
    <div className="logs-detail">
      <div className="logs-detail-header">
        <button className="logs-back-btn" onClick={onBack}>&larr; Back</button>
        <h3>Trace: {t.triggerContent || t.triggerType}</h3>
        <StatusBadge status={t.status} />
      </div>

      {/* Trace summary */}
      <div className="logs-detail-summary">
        <div className="logs-detail-meta">
          <span>Duration: <strong>{formatDuration(t.durationMs)}</strong></span>
          <span>Agents: <strong>{t.agentCount}</strong></span>
          <span>LLM Calls: <strong>{t.llmCallCount}</strong></span>
          <span>Tool Calls: <strong>{t.toolCallCount}</strong></span>
          <span>Tokens: <strong>{formatTokens(t.totalInputTokens)} in / {formatTokens(t.totalOutputTokens)} out</strong></span>
          <span>Started: <strong>{formatTimestamp(t.startedAt)}</strong></span>
        </div>
      </div>

      {/* Agent Spans */}
      {spans.length > 0 && (
        <div className="logs-detail-section">
          <h4>Agent Spans ({spans.length})</h4>
          <div className="logs-spans">
            {spans.map((s) => (
              <div key={s.id} className={`logs-span-card ${s.status}`}>
                <div className="logs-span-header">
                  <span className="logs-span-emoji">{s.agentEmoji}</span>
                  <span className="logs-span-name">{s.agentName}</span>
                  <span className="logs-span-type">{s.agentType}</span>
                  <StatusBadge status={s.status} />
                  <span className="logs-span-duration">{formatDuration(s.durationMs)}</span>
                </div>
                {s.mission && <div className="logs-span-mission">{s.mission}</div>}
                <div className="logs-span-stats">
                  LLM: {s.llmCallCount} | Tools: {s.toolCallCount}
                  {s.error && <span className="logs-span-error"> | Error: {s.error}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LLM Calls */}
      {llmCalls.length > 0 && (
        <div className="logs-detail-section">
          <h4>LLM Calls ({llmCalls.length})</h4>
          <div className="logs-llm-calls">
            {[...llmCalls]
              .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
              .map((c, index) => (
              <div key={c.id} className="logs-llm-card" onClick={() => onSelectLlmCall(c.id)}>
                <div className="logs-llm-header">
                  <span className="logs-llm-seq">{index + 1}</span>
                  <WorkloadBadge workload={c.workload} />
                  <span className="logs-llm-model">{c.model}</span>
                  <span className="logs-llm-agent">{c.callerAgentName || ''}</span>
                  {c.status !== 'completed' && <StatusBadge status={c.status} />}
                  <span className="logs-llm-duration">{formatDuration(c.durationMs)}</span>
                </div>
                <div className="logs-llm-stats">
                  {formatTokens(c.inputTokens)} in / {formatTokens(c.outputTokens)} out
                  {c.tokenReductionEnabled === 1 && c.tokenReductionOriginalTokens > c.tokenReductionCompressedTokens && (
                    <span className="logs-token-reduction-inline"> | compressed: {savingsPercent(c.tokenReductionOriginalTokens, c.tokenReductionCompressedTokens)}% saved</span>
                  )}
                  {c.callerPurpose && <span> | {c.callerPurpose}</span>}
                  {c.stopReason && <span> | stop: <StopReasonBadge stopReason={c.stopReason} /></span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <div className="logs-detail-section">
          <h4>Tool Calls ({toolCalls.length})</h4>
          <div className="logs-tool-calls">
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================================
// LLM Call detail view
// ============================================================

const LlmCallDetailView = memo(function LlmCallDetailView({ call, onBack, siblingCalls = [], onSelectLlmCall }) {
  const [showMessages, setShowMessages] = useState(false);
  const [showResponse, setShowResponse] = useState(true);
  const [showRawRequest, setShowRawRequest] = useState(false);
  const [showTokenReduction, setShowTokenReduction] = useState(true);

  if (!call) return null;

  // Find current position and prev/next calls (sorted by startedAt)
  const sortedSiblings = [...siblingCalls].sort((a, b) =>
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  const currentIndex = sortedSiblings.findIndex(c => c.id === call.id);
  const prevCall = currentIndex > 0 ? sortedSiblings[currentIndex - 1] : null;
  const nextCall = currentIndex >= 0 && currentIndex < sortedSiblings.length - 1
    ? sortedSiblings[currentIndex + 1]
    : null;
  const hasNavigation = siblingCalls.length > 1 && currentIndex >= 0;

  let parsedMessages = null;
  if (call.messagesJson) {
    try { parsedMessages = JSON.parse(call.messagesJson); } catch { /* skip */ }
  }
  // Filter out system messages (shown separately above)
  const nonSystemMessages = parsedMessages?.filter(msg => msg.role !== 'system') ?? [];

  let parsedToolUse = null;
  if (call.responseToolUseJson) {
    try { parsedToolUse = JSON.parse(call.responseToolUseJson); } catch { /* skip */ }
  }

  let parsedTools = null;
  if (call.toolsJson) {
    try { parsedTools = JSON.parse(call.toolsJson); } catch { /* skip */ }
  }

  return (
    <div className="logs-detail">
      <div className="logs-detail-header">
        <button className="logs-back-btn" onClick={onBack}>&larr; Back</button>
        <h3>LLM Call Detail</h3>
        {call.status !== 'completed' && <StatusBadge status={call.status} />}
        {/* Prev/Next navigation within same trace */}
        {hasNavigation && (
          <div className="logs-call-nav">
            <button
              className="logs-nav-btn"
              onClick={() => prevCall && onSelectLlmCall(prevCall.id)}
              disabled={!prevCall}
              title={prevCall ? `Previous: ${prevCall.model} (${prevCall.callerAgentName || prevCall.workload})` : 'No previous call'}
            >
              ◀ Prev
            </button>
            <span className="logs-nav-position">{currentIndex + 1} / {sortedSiblings.length}</span>
            <button
              className="logs-nav-btn"
              onClick={() => nextCall && onSelectLlmCall(nextCall.id)}
              disabled={!nextCall}
              title={nextCall ? `Next: ${nextCall.model} (${nextCall.callerAgentName || nextCall.workload})` : 'No next call'}
            >
              Next ▶
            </button>
          </div>
        )}
      </div>

      {/* Call metadata */}
      <div className="logs-detail-summary">
        <div className="logs-detail-meta">
          <span>Model: <strong>{call.model}</strong></span>
          <span>Provider: <strong>{call.provider}</strong></span>
          <span>Workload: <strong><WorkloadBadge workload={call.workload} /></strong></span>
          <span>Duration: <strong>{formatDuration(call.durationMs)}</strong></span>
          <span>Tokens: <strong>{formatTokens(call.inputTokens)} in / {formatTokens(call.outputTokens)} out</strong></span>
          {call.stopReason && <span>Stop Reason: <StopReasonBadge stopReason={call.stopReason} /></span>}
          {call.callerAgentName && <span>Agent: <strong>{call.callerAgentName}</strong></span>}
          {call.callerPurpose && <span>Output: <strong>{call.callerPurpose}</strong></span>}
          {call.maxTokens && <span>Max Tokens: <strong>{call.maxTokens}</strong></span>}
          {call.temperature != null && <span>Temperature: <strong>{call.temperature}</strong></span>}
          {call.reasoningEffort && <span>Reasoning: <strong>{call.reasoningEffort}</strong></span>}
          <span>Started: <strong>{formatTimestamp(call.startedAt)}</strong></span>
        </div>
      </div>

      {call.error && (
        <div className="logs-detail-section">
          <h4>Error</h4>
          <pre className="logs-json-block logs-error-block">{call.error}</pre>
        </div>
      )}

      {/* Token Reduction (Prompt Compression) - only show when actual compression happened */}
      {call.tokenReductionEnabled === 1 && call.tokenReductionOriginalTokens > call.tokenReductionCompressedTokens && (
        <div className="logs-detail-section logs-token-reduction-section">
          <h4 className="logs-collapsible" onClick={() => setShowTokenReduction(!showTokenReduction)}>
            {showTokenReduction ? '▾' : '▸'} Token Reduction
            <span className="logs-token-reduction-badge">
              {savingsPercent(call.tokenReductionOriginalTokens, call.tokenReductionCompressedTokens)}% saved
            </span>
          </h4>
          {showTokenReduction && (
            <div className="logs-token-reduction-detail">
              <div className="logs-token-reduction-meta">
                <span>Provider: <strong>{call.tokenReductionProvider}</strong></span>
                <span>Original: <strong>{formatTokens(call.tokenReductionOriginalTokens)} tokens</strong></span>
                <span>Compressed: <strong>{formatTokens(call.tokenReductionCompressedTokens)} tokens</strong></span>
                <span>Saved: <strong>{formatTokens(call.tokenReductionOriginalTokens - call.tokenReductionCompressedTokens)} tokens ({savingsPercent(call.tokenReductionOriginalTokens, call.tokenReductionCompressedTokens)}%)</strong></span>
                <span>Compression Time: <strong>{formatDuration(call.tokenReductionTimeMs)}</strong></span>
              </div>
              {call.tokenReductionOriginalText && (
                <div className="logs-token-reduction-compare">
                  <div className="logs-token-reduction-before">
                    <div className="logs-token-reduction-compare-title">Before Compression</div>
                    <pre className="logs-text-block">{call.tokenReductionOriginalText}</pre>
                  </div>
                  <div className="logs-token-reduction-after">
                    <div className="logs-token-reduction-compare-title">After Compression</div>
                    <pre className="logs-text-block">{call.tokenReductionCompressedText}</pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* System Prompt */}
      {call.systemPrompt && (
        <div className="logs-detail-section">
          <h4 className="logs-collapsible" onClick={() => {}}>System Prompt</h4>
          <pre className="logs-text-block">{call.systemPrompt}</pre>
        </div>
      )}

      {/* Available Tools */}
      {parsedTools && parsedTools.length > 0 && (() => {
        // Build a map of tool name -> tool use details for highlighting
        const toolUseMap = new Map();
        if (call.stopReason === 'tool_use' && parsedToolUse) {
          for (const tu of parsedToolUse) {
            // A tool can be called multiple times, so store as array
            if (!toolUseMap.has(tu.name)) {
              toolUseMap.set(tu.name, []);
            }
            toolUseMap.get(tu.name).push(tu);
          }
        }

        return (
          <div className="logs-detail-section">
            <h4>Tools Available ({parsedTools.length}){toolUseMap.size > 0 && <span className="logs-tools-used-count"> · {toolUseMap.size} used</span>}</h4>
            <div className="logs-tools-list">
              {parsedTools.map((t, i) => {
                const usages = toolUseMap.get(t.name);
                const isUsed = !!usages;
                const tooltipContent = isUsed
                  ? usages.map((u, idx) =>
                      `${usages.length > 1 ? `[${idx + 1}] ` : ''}${JSON.stringify(u.input, null, 2)}`
                    ).join('\n\n')
                  : null;

                return (
                  <span
                    key={i}
                    className={`logs-tool-chip ${isUsed ? 'used' : ''}`}
                    title={tooltipContent}
                  >
                    {t.name}
                    {isUsed && usages.length > 1 && <span className="logs-tool-chip-count">×{usages.length}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Messages (collapsible - can be large) - system messages filtered out since shown above */}
      {nonSystemMessages.length > 0 && (
        <div className="logs-detail-section">
          <h4 className="logs-collapsible" onClick={() => setShowMessages(!showMessages)}>
            {showMessages ? '▾' : '▸'} Messages ({nonSystemMessages.length})
          </h4>
          {showMessages && (
            <div className="logs-messages-list">
              {nonSystemMessages.map((msg, i) => {
                // Determine content to display
                let displayContent = '';
                let hasToolResult = false;

                if (typeof msg.content === 'string') {
                  displayContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                  // Handle content blocks (text, tool_use, tool_result, etc.)
                  const parts = msg.content.map(block => {
                    if (block.type === 'text') return block.text;
                    if (block.type === 'tool_use') return `[Tool Use: ${block.name}]\n${JSON.stringify(block.input, null, 2)}`;
                    if (block.type === 'tool_result') {
                      hasToolResult = true;
                      return `[Tool Result: ${block.tool_use_id}]\n${typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}`;
                    }
                    return JSON.stringify(block, null, 2);
                  });
                  displayContent = parts.join('\n\n');
                } else if (msg.content) {
                  displayContent = JSON.stringify(msg.content, null, 2);
                }

                // For assistant messages with toolUse property, show tool use details
                if (!displayContent && msg.role === 'assistant' && msg.toolUse && msg.toolUse.length > 0) {
                  const toolUseParts = msg.toolUse.map(tu =>
                    `[Tool Use: ${tu.name}]\n${JSON.stringify(tu.input, null, 2)}`
                  );
                  displayContent = toolUseParts.join('\n\n');
                }

                // Determine display role - OpenAI uses "tool" role for tool results
                const isOpenAIProvider = call.provider === 'openai' || call.provider === 'azure_openai';
                let displayRole = msg.role;
                if (hasToolResult && msg.role === 'user' && isOpenAIProvider) {
                  displayRole = 'tool';
                }

                return (
                  <div key={i} className={`logs-message logs-message-${displayRole}`}>
                    <div className="logs-message-role">{displayRole}</div>
                    <pre className="logs-message-content">
                      {displayContent?.substring(0, 2000) || (
                        <span className="logs-empty-content">(empty)</span>
                      )}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Raw Request Body (reconstructed from stored fields) */}
      <div className="logs-detail-section">
        <h4 className="logs-collapsible" onClick={() => setShowRawRequest(!showRawRequest)}>
          {showRawRequest ? '▾' : '▸'} Raw Request Body
        </h4>
        {showRawRequest && (
          <pre className="logs-json-block">{JSON.stringify({
            model: call.model,
            ...(call.systemPrompt && { system: call.systemPrompt }),
            messages: parsedMessages || [],
            ...(parsedTools && parsedTools.length > 0 && { tools: parsedTools }),
            ...(call.toolChoice && { tool_choice: call.toolChoice }),
            ...(call.maxTokens && { max_tokens: call.maxTokens }),
            ...(call.temperature != null && { temperature: call.temperature }),
            ...(call.reasoningEffort && { reasoning_effort: call.reasoningEffort }),
          }, null, 2)}</pre>
        )}
      </div>

      {/* Response */}
      <div className="logs-detail-section">
        <h4 className="logs-collapsible" onClick={() => setShowResponse(!showResponse)}>
          {showResponse ? '▾' : '▸'} Response
        </h4>
        {showResponse && (
          <>
            {call.responseContent && (
              <pre className="logs-text-block">{call.responseContent}</pre>
            )}
            {parsedToolUse && parsedToolUse.length > 0 && (
              <div className="logs-tool-use-list">
                <div className="logs-tool-use-header">Tool Use Requests:</div>
                {parsedToolUse.map((tu, i) => (
                  <div key={i} className="logs-tool-use-item">
                    <span className="logs-tool-use-name">{tu.name}</span>
                    <pre className="logs-json-block">{JSON.stringify(tu.input, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ============================================================
// Tool call card (used in trace detail)
// ============================================================

const ToolCallCard = memo(function ToolCallCard({ call }) {
  const [expanded, setExpanded] = useState(false);

  let parsedParams = null;
  if (call.parametersJson) {
    try { parsedParams = JSON.parse(call.parametersJson); } catch { /* skip */ }
  }

  let parsedResult = null;
  if (call.resultJson) {
    try { parsedResult = JSON.parse(call.resultJson); } catch { parsedResult = call.resultJson; }
  }

  let parsedFiles = null;
  if (call.filesJson) {
    try { parsedFiles = JSON.parse(call.filesJson); } catch { /* skip */ }
  }

  const success = call.success === 1;

  return (
    <div className={`logs-tool-card ${success ? 'success' : call.success === 0 ? 'failure' : ''}`}>
      <div className="logs-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="logs-tool-expand">{expanded ? '▾' : '▸'}</span>
        <span className={`logs-tool-status-icon ${success ? 'success' : 'failure'}`}>
          {success ? '✓' : call.success === 0 ? '✗' : '...'}
        </span>
        <span className="logs-tool-name">{call.toolName}</span>
        <span className="logs-tool-source">{call.source}</span>
        <span className="logs-tool-duration">{formatDuration(call.durationMs)}</span>
        {call.callerAgentName && <span className="logs-tool-agent">{call.callerAgentName}</span>}
      </div>
      {expanded && (
        <div className="logs-tool-detail">
          {parsedParams && (
            <div className="logs-tool-section">
              <div className="logs-tool-section-title">Parameters</div>
              <pre className="logs-json-block">{JSON.stringify(parsedParams, null, 2)}</pre>
            </div>
          )}
          {/* Render file attachments (screenshots, images) */}
          {parsedFiles && parsedFiles.length > 0 && (
            <div className="logs-tool-section">
              <div className="logs-tool-section-title">Files ({parsedFiles.length})</div>
              <div className="logs-tool-files">
                {parsedFiles.map((file, idx) => (
                  <div key={idx} className="logs-tool-file">
                    {file.mediaType?.startsWith('image/') || file.dataUrl?.startsWith('data:image/') ? (
                      <img
                        src={file.dataUrl}
                        alt={file.name || 'Screenshot'}
                        className="logs-tool-image"
                        style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }}
                      />
                    ) : (
                      <div className="logs-tool-file-info">
                        <span>{file.name}</span>
                        {file.size && <span> ({Math.round(file.size / 1024)}KB)</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {parsedResult && (
            <div className="logs-tool-section">
              <div className="logs-tool-section-title">Result</div>
              <pre className="logs-json-block">
                {typeof parsedResult === 'string'
                  ? parsedResult.substring(0, 5000)
                  : JSON.stringify(parsedResult, null, 2)?.substring(0, 5000)}
              </pre>
            </div>
          )}
          {call.error && (
            <div className="logs-tool-section">
              <div className="logs-tool-section-title">Error</div>
              <pre className="logs-json-block logs-error-block">{call.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
