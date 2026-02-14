/**
 * Mission Mode — Level 4 Continuous Agent UI
 *
 * Self-contained module (mirrors App.Eval.jsx pattern).
 * Exports: useMissionMode hook, MissionSidebarContent, MissionMainContent
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MissionChat } from './components/mission/MissionChat';

const API_BASE = '/api/missions';

// ============================================================================
// Hook: useMissionMode
// ============================================================================

export function useMissionMode() {
  const navigate = useNavigate();
  const location = useLocation();

  const [missions, setMissions] = useState([]);
  const [selectedMission, setSelectedMission] = useState(null);
  const [selectedPillar, setSelectedPillar] = useState(null);
  const [selectedTodo, setSelectedTodo] = useState(null);
  const [missionTab, setMissionTab] = useState('dashboard'); // dashboard | pillars | config
  const [pillarTab, setPillarTab] = useState('dashboard');    // dashboard | metrics | strategy | todos
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load functions (defined before useEffects for React Compiler)
  const loadMissions = useCallback(async () => {
    try {
      const res = await fetch(API_BASE);
      if (res.ok) {
        const data = await res.json();
        setMissions(data);
      }
    } catch (err) {
      console.error('[Mission] Failed to load missions:', err);
    }
  }, []);

  const loadMission = useCallback(async (slug) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMission(data);
      } else {
        setError('Failed to load mission');
      }
      setLoading(false);
    } catch (err) {
      console.error('[Mission] Failed to load mission:', err);
      setError('Failed to load mission');
      setLoading(false);
    }
  }, []);

  const loadPillar = useCallback(async (missionSlug, pillarSlug) => {
    try {
      const res = await fetch(`${API_BASE}/${missionSlug}/pillars/${pillarSlug}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedPillar(data);
      }
    } catch (err) {
      console.error('[Mission] Failed to load pillar:', err);
    }
  }, []);

  // Derive state from URL
  useEffect(() => {
    if (!location.pathname.startsWith('/mission')) return;

    const parts = location.pathname.split('/').filter(Boolean);
    // /mission => index
    // /mission/:slug => mission view
    // /mission/:slug/pillars => mission pillars tab
    // /mission/:slug/config => mission config tab
    // /mission/:slug/pillar/:pillarSlug => pillar view
    // /mission/:slug/pillar/:pillarSlug/metrics => pillar metrics tab
    // /mission/:slug/pillar/:pillarSlug/strategy => pillar strategy tab
    // /mission/:slug/pillar/:pillarSlug/todos => pillar todos tab
    // /mission/:slug/pillar/:pillarSlug/todo/:todoId => todo execution

    if (parts.length >= 2) {
      const slug = parts[1];
      loadMission(slug);

      if (parts[2] === 'pillar' && parts[3]) {
        loadPillar(slug, parts[3]);
        if (parts[4] === 'todo' && parts[5]) {
          setSelectedTodo(parts[5]);
          setPillarTab('todos');
        } else {
          setSelectedTodo(null);
          setPillarTab(parts[4] || 'dashboard');
        }
      } else {
        setSelectedPillar(null);
        setSelectedTodo(null);
        setMissionTab(parts[2] || 'dashboard');
      }
    } else {
      setSelectedMission(null);
      setSelectedPillar(null);
      setSelectedTodo(null);
    }
  }, [location.pathname, loadMission, loadPillar]);

  // Load missions list — only when entering mission mode, not on every sub-nav
  useEffect(() => {
    if (location.pathname.startsWith('/mission')) {
      loadMissions();
    }
  }, [location.pathname.startsWith('/mission'), loadMissions]);

  const handleSelectMission = useCallback((slug) => {
    navigate(`/mission/${slug}`);
  }, [navigate]);

  const handleSelectPillar = useCallback((missionSlug, pillarSlug) => {
    navigate(`/mission/${missionSlug}/pillar/${pillarSlug}`);
  }, [navigate]);

  const handleSelectTodo = useCallback((missionSlug, pillarSlug, todoId) => {
    navigate(`/mission/${missionSlug}/pillar/${pillarSlug}/todo/${todoId}`);
  }, [navigate]);

  const handleBack = useCallback(() => {
    if (selectedTodo) {
      navigate(`/mission/${selectedMission?.slug}/pillar/${selectedPillar?.slug}/todos`);
    } else if (selectedPillar) {
      navigate(`/mission/${selectedMission?.slug}`);
    } else {
      navigate('/mission');
    }
  }, [navigate, selectedMission, selectedPillar, selectedTodo]);

  const handleMissionTab = useCallback((tab) => {
    if (selectedMission) {
      navigate(tab === 'dashboard' ? `/mission/${selectedMission.slug}` : `/mission/${selectedMission.slug}/${tab}`);
    }
  }, [navigate, selectedMission]);

  const handlePillarTab = useCallback((tab) => {
    if (selectedMission && selectedPillar) {
      navigate(tab === 'dashboard'
        ? `/mission/${selectedMission.slug}/pillar/${selectedPillar.slug}`
        : `/mission/${selectedMission.slug}/pillar/${selectedPillar.slug}/${tab}`
      );
    }
  }, [navigate, selectedMission, selectedPillar]);

  const handlePauseMission = useCallback(async (slug) => {
    try {
      await fetch(`${API_BASE}/${slug}/pause`, { method: 'POST' });
      loadMission(slug);
      loadMissions();
    } catch (err) {
      console.error('[Mission] Failed to pause:', err);
    }
  }, [loadMission, loadMissions]);

  const handleResumeMission = useCallback(async (slug) => {
    try {
      await fetch(`${API_BASE}/${slug}/resume`, { method: 'POST' });
      loadMission(slug);
      loadMissions();
    } catch (err) {
      console.error('[Mission] Failed to resume:', err);
    }
  }, [loadMission, loadMissions]);

  const refreshDashboard = useCallback(() => {
    if (selectedMission) loadMission(selectedMission.slug);
    if (selectedPillar && selectedMission) loadPillar(selectedMission.slug, selectedPillar.slug);
  }, [selectedMission, selectedPillar, loadMission, loadPillar]);

  const triggerCycle = useCallback(async (slug) => {
    try {
      await fetch(`${API_BASE}/${slug}/cycle`, { method: 'POST' });
      // Reload mission data after cycle trigger
      loadMission(slug);
      loadMissions();
    } catch (err) {
      console.error('[Mission] Failed to trigger cycle:', err);
    }
  }, [loadMission, loadMissions]);

  return {
    missions,
    selectedMission,
    selectedPillar,
    selectedTodo,
    missionTab,
    pillarTab,
    loading,
    error,
    handleSelectMission,
    handleSelectPillar,
    handleSelectTodo,
    handleBack,
    handleMissionTab,
    handlePillarTab,
    handlePauseMission,
    handleResumeMission,
    refreshDashboard,
    loadMissions,
    triggerCycle,
  };
}

// ============================================================================
// Sidebar Component
// ============================================================================

export const MissionSidebarContent = memo(function MissionSidebarContent({ missionMode }) {
  const {
    missions,
    selectedMission,
    selectedPillar,
    handleSelectMission,
    handleSelectPillar,
    triggerCycle,
  } = missionMode;

  return (
    <div className="mission-sidebar">
      <div className="mission-sidebar-section-header">MISSIONS</div>

      {missions.length === 0 && (
        <div className="mission-sidebar-empty">
          No missions yet. Create a <code>.md</code> file in <code>/user/missions/</code> to get started.
        </div>
      )}

      {missions.map(m => (
        <div
          key={m.slug}
          className={`mission-sidebar-item ${selectedMission?.slug === m.slug ? 'active' : ''}`}
          onClick={() => handleSelectMission(m.slug)}
        >
          <div className="mission-sidebar-item-name">
            <span className={`mission-status-dot ${m.status}`} />
            <span className="mission-sidebar-item-text">{m.name}</span>
            {m.status === 'active' && (
              <button
                className="mission-cycle-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerCycle(m.slug);
                }}
                title="Trigger mission cycle"
              >
                ⟳
              </button>
            )}
          </div>
          <div className="mission-sidebar-item-meta">
            {m.status === 'active' ? 'Active' : m.status === 'paused' ? 'Paused' : 'Archived'}
            {m.pillarCount != null && ` · ${m.pillarCount} pillar${m.pillarCount !== 1 ? 's' : ''}`}
            {m.lastCycleAt && ` · Last cycle: ${formatTimeAgo(m.lastCycleAt)}`}
          </div>
        </div>
      ))}

      {selectedMission?.pillars && selectedMission.pillars.length > 0 && (
        <>
          <div className="mission-sidebar-section-header" style={{ marginTop: '16px' }}>PILLARS</div>
          {selectedMission.pillars.map(p => (
            <div
              key={p.slug}
              className={`mission-sidebar-item pillar ${selectedPillar?.slug === p.slug ? 'active' : ''}`}
              onClick={() => handleSelectPillar(selectedMission.slug, p.slug)}
            >
              <div className="mission-sidebar-item-name">
                <span className={`pillar-health-dot ${getPillarHealth(p)}`} />
                {p.name}
              </div>
              <div className="mission-sidebar-item-meta">
                {p.todosByStatus?.in_progress || 0} active, {p.todosByStatus?.pending || 0} pending
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}, (prev, next) => {
  // Custom comparison: only re-render when relevant state changes
  const pm = prev.missionMode;
  const nm = next.missionMode;
  return pm.missions === nm.missions
    && pm.selectedMission === nm.selectedMission
    && pm.selectedPillar === nm.selectedPillar;
});

// ============================================================================
// Main Content Component
// ============================================================================

export const MissionMainContent = memo(function MissionMainContent({ missionMode, sendMessage, subscribe }) {
  const {
    selectedMission,
    selectedPillar,
    selectedTodo,
    missionTab,
    pillarTab,
    loading,
    error,
    handleBack,
    handleMissionTab,
    handlePillarTab,
    handleSelectPillar,
    handleSelectTodo,
    handlePauseMission,
    handleResumeMission,
    refreshDashboard,
  } = missionMode;

  if (loading) {
    return <div className="mission-loading">Loading mission...</div>;
  }

  if (error) {
    return (
      <div className="mission-empty-state">
        <div className="mission-empty-icon">!</div>
        <h2>Something went wrong</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!selectedMission) {
    return (
      <div className="mission-empty-state">
        <div className="mission-empty-icon">🎯</div>
        <h2>Missions</h2>
        <p>Select a mission from the sidebar, or create one by adding a <code>.md</code> file to <code>/user/missions/</code></p>
      </div>
    );
  }

  // Pillar detail view
  if (selectedPillar) {
    return (
      <div className="mission-content">
        <div className="mission-breadcrumb">
          <button className="mission-back-btn" onClick={handleBack} title="Back to mission">←</button>
          <span className="mission-breadcrumb-link" onClick={() => handleBack()}>{selectedMission.name}</span>
          <span className="mission-breadcrumb-sep">/</span>
          <span className="mission-breadcrumb-current">{selectedPillar.name}</span>
          <span className={`pillar-health-dot ${getPillarHealth(selectedPillar)}`} />
        </div>

        {selectedPillar.description && (
          <div className="mission-description">{selectedPillar.description}</div>
        )}

        <div className="mission-tabs">
          {['dashboard', 'metrics', 'strategy', 'todos'].map(tab => (
            <button
              key={tab}
              className={`mission-tab ${pillarTab === tab ? 'active' : ''}`}
              onClick={() => handlePillarTab(tab)}
            >
              {TAB_LABELS[tab] || tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="mission-tab-content">
          {pillarTab === 'dashboard' && (
            <DashboardViewer
              title="Pillar Dashboard"
              fetchUrl={`${API_BASE}/${selectedMission.slug}/pillars/${selectedPillar.slug}/dashboard`}
              onRefresh={refreshDashboard}
            />
          )}
          {pillarTab === 'metrics' && (
            <PillarMetrics metrics={selectedPillar.metrics || []} />
          )}
          {pillarTab === 'strategy' && (
            <PillarStrategies strategies={selectedPillar.strategies || []} />
          )}
          {pillarTab === 'todos' && !selectedTodo && (
            <PillarTodos
              todos={selectedPillar.todos || []}
              onSelectTodo={(todoId) => handleSelectTodo(selectedMission.slug, selectedPillar.slug, todoId)}
            />
          )}
          {pillarTab === 'todos' && selectedTodo && (
            <TodoExecution
              todoId={selectedTodo}
              missionSlug={selectedMission.slug}
              pillarSlug={selectedPillar.slug}
              onBack={handleBack}
              sendMessage={sendMessage}
              subscribe={subscribe}
            />
          )}
        </div>

        <MissionChat
          conversationId={selectedPillar.conversationId}
          contextLabel={`${selectedPillar.name} Chat`}
          placeholder={`Message about ${selectedPillar.name}...`}
          sendMessage={sendMessage}
          subscribe={subscribe}
        />
      </div>
    );
  }

  // Mission view
  return (
    <div className="mission-content">
      <div className="mission-breadcrumb">
        <button className="mission-back-btn" onClick={handleBack} title="Back to missions">←</button>
        <span className="mission-breadcrumb-current">{selectedMission.name}</span>
        <span className={`mission-status-badge ${selectedMission.status}`}>
          {selectedMission.status}
        </span>
        {selectedMission.status === 'active' ? (
          <button className="mission-action-btn" onClick={() => handlePauseMission(selectedMission.slug)}>Pause</button>
        ) : selectedMission.status === 'paused' ? (
          <button className="mission-action-btn" onClick={() => handleResumeMission(selectedMission.slug)}>Resume</button>
        ) : null}
      </div>

      {selectedMission.description && (
        <div className="mission-description">{selectedMission.description}</div>
      )}

      <div className="mission-tabs">
        {['dashboard', 'pillars', 'config'].map(tab => (
          <button
            key={tab}
            className={`mission-tab ${missionTab === tab ? 'active' : ''}`}
            onClick={() => handleMissionTab(tab)}
          >
            {TAB_LABELS[tab] || tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="mission-tab-content">
        {missionTab === 'dashboard' && (
          <DashboardViewer
            title="Mission Dashboard"
            fetchUrl={`${API_BASE}/${selectedMission.slug}/dashboard`}
            onRefresh={refreshDashboard}
          />
        )}
        {missionTab === 'pillars' && (
          <MissionPillarsView
            pillars={selectedMission.pillars || []}
            missionSlug={selectedMission.slug}
            onSelectPillar={(pillarSlug) => handleSelectPillar(selectedMission.slug, pillarSlug)}
          />
        )}
        {missionTab === 'config' && (
          <MissionConfig mission={selectedMission} />
        )}
      </div>

      <MissionChat
        conversationId={selectedMission.conversationId}
        contextLabel="Mission Chat"
        placeholder="Message the Mission Lead..."
        sendMessage={sendMessage}
        subscribe={subscribe}
      />
    </div>
  );
}, (prev, next) => {
  const pm = prev.missionMode;
  const nm = next.missionMode;
  return pm.selectedMission === nm.selectedMission
    && pm.selectedPillar === nm.selectedPillar
    && pm.selectedTodo === nm.selectedTodo
    && pm.missionTab === nm.missionTab
    && pm.pillarTab === nm.pillarTab
    && pm.loading === nm.loading
    && pm.error === nm.error
    && prev.sendMessage === next.sendMessage
    && prev.subscribe === next.subscribe;
});

// ============================================================================
// Shared constants
// ============================================================================

const TAB_LABELS = {
  dashboard: 'Dashboard',
  pillars: 'Pillars',
  config: 'Configuration',
  metrics: 'Metrics',
  strategy: 'Strategy',
  todos: 'TODOs',
};

const TODO_STATUS_ORDER = ['in_progress', 'pending', 'blocked', 'completed'];
const TODO_STATUS_ICONS = {
  in_progress: '🔵',
  completed: '✅',
  blocked: '🔴',
  pending: '⚪',
};

// ============================================================================
// Sub-components
// ============================================================================

/** Reusable dashboard viewer — serves both mission and pillar dashboards */
function DashboardViewer({ title, fetchUrl, onRefresh }) {
  const [html, setHtml] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFetchError(null);

    fetch(fetchUrl)
      .then(res => {
        if (res.ok) return res.text();
        throw new Error('Not generated yet');
      })
      .then(data => { if (!cancelled) setHtml(data); })
      .catch(() => { if (!cancelled) setFetchError('Dashboard not generated yet. The Mission Lead will create it during the next cycle.'); });

    return () => { cancelled = true; };
  }, [fetchUrl]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    onRefresh();
    // Brief visual feedback then clear
    setTimeout(() => setRefreshing(false), 600);
  }, [onRefresh]);

  return (
    <div className="mission-dashboard-container">
      <div className="mission-dashboard-header">
        <span>{title}</span>
        <button
          className="mission-refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : '↻ Refresh'}
        </button>
      </div>
      {fetchError && <div className="mission-dashboard-placeholder">{fetchError}</div>}
      {html && (
        <iframe
          className="mission-dashboard-iframe"
          srcDoc={html}
          sandbox="allow-scripts"
          title={title}
        />
      )}
    </div>
  );
}

function MissionPillarsView({ pillars, missionSlug, onSelectPillar }) {
  return (
    <div className="mission-pillars-grid">
      {pillars.map(p => {
        const health = getPillarHealth(p);
        return (
          <div key={p.slug} className="mission-pillar-card" onClick={() => onSelectPillar(p.slug)}>
            <div className="pillar-card-header">
              <span className={`pillar-health-dot large ${health}`} />
              <span className="pillar-card-name">{p.name}</span>
            </div>
            {p.description && (
              <div className="pillar-card-description">{p.description}</div>
            )}
            <div className="pillar-card-metrics">
              {(p.metrics || []).slice(0, 3).map(m => (
                <div key={m.id} className="pillar-card-metric">
                  <span className="metric-name">{m.name}</span>
                  <span className="metric-value">{m.current || '—'}</span>
                  <span className="metric-target">→ {formatMetricTarget(m.target)}</span>
                </div>
              ))}
            </div>
            <div className="pillar-card-footer">
              <span>TODOs: {p.todosByStatus?.pending || 0} pending, {p.todosByStatus?.in_progress || 0} active</span>
              <span className="pillar-card-link">View →</span>
            </div>
          </div>
        );
      })}
      {pillars.length === 0 && (
        <div className="mission-dashboard-placeholder">No pillars defined. Add them to the mission .md file.</div>
      )}
    </div>
  );
}

function MissionConfig({ mission }) {
  let configObj = {};
  if (typeof mission.jsonConfig === 'string') {
    try {
      configObj = JSON.parse(mission.jsonConfig);
    } catch { /* ignore parse error */ }
  } else {
    configObj = mission.jsonConfig || {};
  }

  return (
    <div className="mission-config">
      <div className="mission-config-section">
        <h3>Source File</h3>
        <code className="mission-config-path">{mission.mdFile}</code>
      </div>
      <div className="mission-config-section">
        <h3>Runtime Configuration</h3>
        <pre className="mission-config-json">{JSON.stringify(configObj, null, 2)}</pre>
      </div>
    </div>
  );
}

function PillarMetrics({ metrics }) {
  return (
    <div className="pillar-metrics-table">
      <div className="metrics-header">
        <span>Metric</span><span>Current</span><span>Target</span><span>Trend</span>
      </div>
      {metrics.map(m => (
        <div key={m.id} className="metrics-row">
          <span className="metrics-name">{m.name}</span>
          <span className="metrics-current">{m.current || '—'}</span>
          <span className="metrics-target">{formatMetricTarget(m.target)}</span>
          <span className={`metrics-trend ${m.trend}`}>
            {TREND_ICONS[m.trend] || '?'} {m.trend}
          </span>
        </div>
      ))}
      {metrics.length === 0 && <div className="mission-dashboard-placeholder">No metrics defined yet.</div>}
    </div>
  );
}

const TREND_ICONS = {
  improving: '↗',
  degrading: '↘',
  stable: '→',
  unknown: '?',
};

function PillarStrategies({ strategies }) {
  return (
    <div className="pillar-strategies-list">
      {strategies.map((s, i) => (
        <div key={s.id} className="strategy-item">
          <div className="strategy-number">{i + 1}.</div>
          <div className="strategy-content">
            <div className="strategy-description">{s.description}</div>
            <div className="strategy-meta">
              <span className={`strategy-status ${s.status}`}>{s.status}</span>
              <span className="strategy-meta-sep">·</span>
              Last reviewed: {new Date(s.lastReviewedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
      {strategies.length === 0 && <div className="mission-dashboard-placeholder">No strategies defined yet.</div>}
    </div>
  );
}

function PillarTodos({ todos, onSelectTodo }) {
  const [collapsedGroups, setCollapsedGroups] = useState({ completed: true });

  const grouped = {};
  for (const status of TODO_STATUS_ORDER) {
    const items = todos.filter(t => t.status === status);
    if (items.length > 0) grouped[status] = items;
  }

  const toggleGroup = (status) => {
    setCollapsedGroups(prev => ({ ...prev, [status]: !prev[status] }));
  };

  return (
    <div className="pillar-todos">
      {TODO_STATUS_ORDER.map(status => {
        const items = grouped[status];
        if (!items) return null;
        const isCollapsed = collapsedGroups[status];

        return (
          <div key={status} className="todo-group">
            <div
              className="todo-group-header"
              onClick={() => toggleGroup(status)}
              role="button"
              tabIndex={0}
            >
              <span className="todo-group-chevron">{isCollapsed ? '▸' : '▾'}</span>
              {status.replace('_', ' ').toUpperCase()} ({items.length})
            </div>
            {!isCollapsed && items.map(todo => (
              <div
                key={todo.id}
                className={`todo-item ${todo.status}`}
                onClick={() => todo.conversationId && onSelectTodo(todo.id)}
              >
                <span className="todo-status-icon">
                  {TODO_STATUS_ICONS[todo.status] || '⚪'}
                </span>
                <div className="todo-item-content">
                  <div className="todo-title">{todo.title}</div>
                  <div className="todo-meta">
                    Priority: {todo.priority}
                    {todo.assignedAgent && ` · Agent: ${todo.assignedAgent}`}
                    {todo.startedAt && ` · Started: ${formatTimeAgo(todo.startedAt)}`}
                    {todo.completedAt && ` · Completed: ${formatTimeAgo(todo.completedAt)}`}
                  </div>
                  {todo.outcome && (
                    <div className="todo-outcome">{todo.outcome}</div>
                  )}
                </div>
                {todo.conversationId && (
                  <span className="todo-view-btn">View →</span>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {todos.length === 0 && (
        <div className="mission-dashboard-placeholder">
          No TODOs yet. Chat with the Mission Lead to create tasks.
        </div>
      )}
    </div>
  );
}

function TodoExecution({ todoId, missionSlug, pillarSlug, onBack, sendMessage, subscribe }) {
  const [todo, setTodo] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/${missionSlug}/pillars/${pillarSlug}/todos`)
      .then(res => res.ok ? res.json() : [])
      .then(todos => {
        if (!cancelled) {
          const found = todos.find(t => t.id === todoId);
          setTodo(found || null);
          if (!found) setLoadError('TODO not found');
        }
      })
      .catch(() => { if (!cancelled) setLoadError('Failed to load TODO'); });

    return () => { cancelled = true; };
  }, [todoId, missionSlug, pillarSlug]);

  return (
    <div className="todo-execution">
      <div className="todo-execution-header">
        <button className="mission-back-btn" onClick={onBack}>← Back to TODOs</button>
      </div>
      {loadError && <div className="mission-dashboard-placeholder">{loadError}</div>}
      {todo && (
        <div className="todo-execution-detail">
          <h3 className="todo-execution-title">{todo.title}</h3>
          <div className="todo-execution-meta">
            <span className={`mission-status-badge ${todo.status}`}>{todo.status.replace('_', ' ')}</span>
            <span>Priority: {todo.priority}</span>
            {todo.assignedAgent && <span>Agent: {todo.assignedAgent}</span>}
            {todo.startedAt && <span>Started: {new Date(todo.startedAt).toLocaleString()}</span>}
            {todo.completedAt && <span>Completed: {new Date(todo.completedAt).toLocaleString()}</span>}
          </div>
          {todo.description && (
            <div className="todo-execution-description">{todo.description}</div>
          )}
          {todo.outcome && (
            <div className="todo-execution-section">
              <h4>Outcome</h4>
              <div className="todo-execution-outcome">{todo.outcome}</div>
            </div>
          )}
          {todo.conversationId && (
            <div className="todo-execution-section">
              <h4>Execution Log</h4>
              <MissionChat
                conversationId={todo.conversationId}
                contextLabel="Task Execution"
                placeholder="Intervene in this task..."
                sendMessage={sendMessage}
                subscribe={subscribe}
                readOnly={todo.status === 'completed'}
                defaultExpanded={true}
              />
            </div>
          )}
        </div>
      )}
      {!todo && !loadError && (
        <div className="mission-loading">Loading TODO details...</div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getPillarHealth(pillar) {
  if (!pillar.metrics || pillar.metrics.length === 0) return 'unknown';
  const degrading = pillar.metrics.filter(m => m.trend === 'degrading').length;
  const improving = pillar.metrics.filter(m => m.trend === 'improving').length;
  if (degrading > pillar.metrics.length / 2) return 'red';
  if (improving >= pillar.metrics.length / 2) return 'green';
  return 'yellow';
}

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatMetricTarget(target) {
  if (target == null) return '—';
  if (typeof target === 'string' || typeof target === 'number') return String(target);
  if (typeof target !== 'object') return String(target);

  const { operator, value } = target;
  if (value == null) return '—';

  const operatorSymbols = {
    '>=': '≥',
    '<=': '≤',
    '>': '>',
    '<': '<',
    '==': '=',
    '=': '=',
  };
  const symbol = operatorSymbols[operator] || operator || '';
  return symbol ? `${symbol} ${value}` : String(value);
}
