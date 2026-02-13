/**
 * Mission Mode — Level 4 Continuous Agent UI
 *
 * Self-contained module (mirrors App.Eval.jsx pattern).
 * Exports: useMissionMode hook, MissionSidebarContent, MissionMainContent
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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
  }, [location.pathname]);

  // Load missions list
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

  useEffect(() => {
    if (location.pathname.startsWith('/mission')) {
      loadMissions();
    }
  }, [location.pathname, loadMissions]);

  const loadMission = useCallback(async (slug) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMission(data);
      }
    } catch (err) {
      console.error('[Mission] Failed to load mission:', err);
    } finally {
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
    await fetch(`${API_BASE}/${slug}/pause`, { method: 'POST' });
    loadMission(slug);
    loadMissions();
  }, [loadMission, loadMissions]);

  const handleResumeMission = useCallback(async (slug) => {
    await fetch(`${API_BASE}/${slug}/resume`, { method: 'POST' });
    loadMission(slug);
    loadMissions();
  }, [loadMission, loadMissions]);

  const refreshDashboard = useCallback(() => {
    if (selectedMission) loadMission(selectedMission.slug);
    if (selectedPillar && selectedMission) loadPillar(selectedMission.slug, selectedPillar.slug);
  }, [selectedMission, selectedPillar, loadMission, loadPillar]);

  return {
    missions,
    selectedMission,
    selectedPillar,
    selectedTodo,
    missionTab,
    pillarTab,
    loading,
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
  } = missionMode;

  return (
    <div className="mission-sidebar">
      <div className="sidebar-section-header">MISSIONS</div>

      {missions.length === 0 && (
        <div className="mission-sidebar-empty">
          No missions yet. Create a .md file in <code>/user/missions/</code>
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
            {m.name}
          </div>
          <div className="mission-sidebar-item-meta">
            {m.status === 'active' ? 'Active' : m.status === 'paused' ? 'Paused' : 'Archived'}
          </div>
        </div>
      ))}

      {selectedMission?.pillars && selectedMission.pillars.length > 0 && (
        <>
          <div className="sidebar-section-header" style={{ marginTop: '16px' }}>PILLARS</div>
          {selectedMission.pillars.map(p => (
            <div
              key={p.slug}
              className={`mission-sidebar-item pillar ${selectedPillar?.slug === p.slug ? 'active' : ''}`}
              onClick={() => handleSelectPillar(selectedMission.slug, p.slug)}
            >
              <div className="mission-sidebar-item-name">
                <span className={`pillar-health ${getPillarHealth(p)}`} />
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
});

function getPillarHealth(pillar) {
  if (!pillar.metrics || pillar.metrics.length === 0) return 'unknown';
  const degrading = pillar.metrics.filter(m => m.trend === 'degrading').length;
  const improving = pillar.metrics.filter(m => m.trend === 'improving').length;
  if (degrading > pillar.metrics.length / 2) return 'red';
  if (improving >= pillar.metrics.length / 2) return 'green';
  return 'yellow';
}

// ============================================================================
// Main Content Component
// ============================================================================

export const MissionMainContent = memo(function MissionMainContent({ missionMode }) {
  const {
    selectedMission,
    selectedPillar,
    selectedTodo,
    missionTab,
    pillarTab,
    loading,
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
    return <div className="mission-loading">Loading...</div>;
  }

  if (!selectedMission) {
    return (
      <div className="mission-empty-state">
        <div className="mission-empty-icon">🎯</div>
        <h2>Missions</h2>
        <p>Select a mission from the sidebar, or create one by adding a .md file to <code>/user/missions/</code></p>
      </div>
    );
  }

  // Pillar detail view
  if (selectedPillar) {
    return (
      <div className="mission-content">
        <div className="mission-breadcrumb">
          <button className="mission-back-btn" onClick={handleBack}>←</button>
          <span>{selectedMission.name}</span>
          <span className="mission-breadcrumb-sep">/</span>
          <span className="mission-breadcrumb-current">{selectedPillar.name}</span>
        </div>

        <div className="mission-tabs">
          {['dashboard', 'metrics', 'strategy', 'todos'].map(tab => (
            <button
              key={tab}
              className={`mission-tab ${pillarTab === tab ? 'active' : ''}`}
              onClick={() => handlePillarTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="mission-tab-content">
          {pillarTab === 'dashboard' && (
            <PillarDashboard missionSlug={selectedMission.slug} pillarSlug={selectedPillar.slug} onRefresh={refreshDashboard} />
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
            <TodoExecution todoId={selectedTodo} onBack={handleBack} />
          )}
        </div>
      </div>
    );
  }

  // Mission view
  return (
    <div className="mission-content">
      <div className="mission-breadcrumb">
        <button className="mission-back-btn" onClick={handleBack}>←</button>
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

      <div className="mission-tabs">
        {['dashboard', 'pillars', 'config'].map(tab => (
          <button
            key={tab}
            className={`mission-tab ${missionTab === tab ? 'active' : ''}`}
            onClick={() => handleMissionTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="mission-tab-content">
        {missionTab === 'dashboard' && (
          <MissionDashboard missionSlug={selectedMission.slug} onRefresh={refreshDashboard} />
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
    </div>
  );
});

// ============================================================================
// Sub-components
// ============================================================================

function MissionDashboard({ missionSlug, onRefresh }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/${missionSlug}/dashboard`)
      .then(res => {
        if (res.ok) return res.text();
        throw new Error('Not generated yet');
      })
      .then(setHtml)
      .catch(() => setError('Dashboard not generated yet. The Mission Lead will create it during the next cycle.'));
  }, [missionSlug]);

  return (
    <div className="mission-dashboard-container">
      <div className="mission-dashboard-header">
        <span>Mission Dashboard</span>
        <button className="mission-refresh-btn" onClick={onRefresh}>↻ Refresh</button>
      </div>
      {error && <div className="mission-dashboard-placeholder">{error}</div>}
      {html && (
        <iframe
          className="mission-dashboard-iframe"
          srcDoc={html}
          sandbox="allow-scripts"
          title="Mission Dashboard"
        />
      )}
    </div>
  );
}

function PillarDashboard({ missionSlug, pillarSlug, onRefresh }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/${missionSlug}/pillars/${pillarSlug}/dashboard`)
      .then(res => {
        if (res.ok) return res.text();
        throw new Error('Not generated yet');
      })
      .then(setHtml)
      .catch(() => setError('Dashboard not generated yet.'));
  }, [missionSlug, pillarSlug]);

  return (
    <div className="mission-dashboard-container">
      <div className="mission-dashboard-header">
        <span>Pillar Dashboard</span>
        <button className="mission-refresh-btn" onClick={onRefresh}>↻ Refresh</button>
      </div>
      {error && <div className="mission-dashboard-placeholder">{error}</div>}
      {html && (
        <iframe
          className="mission-dashboard-iframe"
          srcDoc={html}
          sandbox="allow-scripts"
          title="Pillar Dashboard"
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
              <span className={`pillar-health-indicator ${health}`} />
              <span className="pillar-card-name">{p.name}</span>
            </div>
            <div className="pillar-card-metrics">
              {(p.metrics || []).slice(0, 3).map(m => (
                <div key={m.id} className="pillar-card-metric">
                  <span className="metric-name">{m.name}</span>
                  <span className="metric-value">{m.current || '—'}</span>
                  <span className="metric-target">→ {m.target}</span>
                </div>
              ))}
            </div>
            <div className="pillar-card-footer">
              TODOs: {p.todosByStatus?.pending || 0} pending, {p.todosByStatus?.in_progress || 0} active
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
  try {
    configObj = typeof mission.jsonConfig === 'string' ? JSON.parse(mission.jsonConfig) : mission.jsonConfig;
  } catch { /* ignore */ }

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
          <span className="metrics-target">{m.target}</span>
          <span className={`metrics-trend ${m.trend}`}>
            {m.trend === 'improving' ? '↗' : m.trend === 'degrading' ? '↘' : m.trend === 'stable' ? '→' : '?'}
            {' '}{m.trend}
          </span>
        </div>
      ))}
      {metrics.length === 0 && <div className="mission-dashboard-placeholder">No metrics defined.</div>}
    </div>
  );
}

function PillarStrategies({ strategies }) {
  return (
    <div className="pillar-strategies-list">
      {strategies.map((s, i) => (
        <div key={s.id} className="strategy-item">
          <div className="strategy-number">{i + 1}.</div>
          <div className="strategy-content">
            <div className="strategy-description">{s.description}</div>
            <div className="strategy-meta">
              Status: {s.status} · Last reviewed: {new Date(s.lastReviewedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
      {strategies.length === 0 && <div className="mission-dashboard-placeholder">No strategies defined.</div>}
    </div>
  );
}

function PillarTodos({ todos, onSelectTodo }) {
  const grouped = {
    in_progress: todos.filter(t => t.status === 'in_progress'),
    pending: todos.filter(t => t.status === 'pending'),
    blocked: todos.filter(t => t.status === 'blocked'),
    completed: todos.filter(t => t.status === 'completed'),
  };

  return (
    <div className="pillar-todos">
      {Object.entries(grouped).map(([status, items]) => (
        items.length > 0 && (
          <div key={status} className="todo-group">
            <div className="todo-group-header">
              {status.replace('_', ' ').toUpperCase()} ({items.length})
            </div>
            {items.map(todo => (
              <div
                key={todo.id}
                className={`todo-item ${todo.status}`}
                onClick={() => todo.conversationId && onSelectTodo(todo.id)}
              >
                <span className={`todo-status-icon ${todo.status}`}>
                  {todo.status === 'in_progress' ? '🔵' : todo.status === 'completed' ? '✅' : todo.status === 'blocked' ? '🔴' : '⚪'}
                </span>
                <div className="todo-item-content">
                  <div className="todo-title">{todo.title}</div>
                  <div className="todo-meta">
                    Priority: {todo.priority}
                    {todo.assignedAgent && ` · Agent: ${todo.assignedAgent}`}
                    {todo.startedAt && ` · Started: ${formatTimeAgo(todo.startedAt)}`}
                  </div>
                </div>
                {todo.conversationId && (
                  <span className="todo-view-btn">View →</span>
                )}
              </div>
            ))}
          </div>
        )
      ))}
      {todos.length === 0 && (
        <div className="mission-dashboard-placeholder">
          No TODOs yet. Chat with the Mission Lead to create tasks.
        </div>
      )}
    </div>
  );
}

function TodoExecution({ todoId, onBack }) {
  const [todo, setTodo] = useState(null);

  useEffect(() => {
    // We'd need the full path context but for now just show the todoId
    setTodo({ id: todoId });
  }, [todoId]);

  return (
    <div className="todo-execution">
      <div className="todo-execution-header">
        <button className="mission-back-btn" onClick={onBack}>← Back to TODOs</button>
        <span>Task Execution: {todoId}</span>
      </div>
      <div className="mission-dashboard-placeholder">
        Task execution view will display the conversation log for this TODO.
        <br />This connects to the TODO's conversation via its conversationId.
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
