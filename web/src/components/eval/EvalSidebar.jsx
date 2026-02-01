import { useState, useEffect } from 'react';

export function EvalSidebar({
  onSelectEvaluation,
  onSelectSuite,
  selectedEvaluation,
  selectedSuite,
}) {
  const [evaluations, setEvaluations] = useState([]);
  const [suites, setSuites] = useState([]);
  const [recentResults, setRecentResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState({
    evaluations: true,
    suites: true,
    results: false,
  });

  // Group evaluations by target type
  const groupedEvaluations = evaluations.reduce((acc, evaluation) => {
    const target = evaluation.target.startsWith('sub-agent:')
      ? 'sub-agents'
      : evaluation.target;
    if (!acc[target]) acc[target] = [];
    acc[target].push(evaluation);
    return acc;
  }, {});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [evalsRes, suitesRes] = await Promise.all([
        fetch('/api/eval/list'),
        fetch('/api/eval/suites'),
      ]);

      if (evalsRes.ok) {
        const data = await evalsRes.json();
        setEvaluations(data.evaluations || []);
      }

      if (suitesRes.ok) {
        const data = await suitesRes.json();
        setSuites(data.suites || []);
      }
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (loading) {
    return (
      <div className="eval-sidebar">
        <div className="eval-sidebar-header">
          <h3>Evaluations</h3>
        </div>
        <div className="eval-sidebar-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="eval-sidebar">
      <div className="eval-sidebar-header">
        <h3>Evaluations</h3>
        <button className="refresh-btn" onClick={loadData} title="Refresh">
          ↻
        </button>
      </div>

      {/* Evaluations Section */}
      <div className="eval-section">
        <div
          className="eval-section-header"
          onClick={() => toggleSection('evaluations')}
        >
          <span className="expand-icon">{expandedSections.evaluations ? '▼' : '▶'}</span>
          <span>Evaluations ({evaluations.length})</span>
        </div>

        {expandedSections.evaluations && (
          <div className="eval-section-content">
            {Object.entries(groupedEvaluations).map(([target, evals]) => (
              <div key={target} className="eval-group">
                <div className="eval-group-header">
                  {target === 'supervisor' ? '🤖 Supervisor' :
                   target === 'sub-agents' ? '👥 Sub-Agents' :
                   target === 'tool-generator' ? '🔧 Tool Generator' : target}
                </div>
                {evals.map(evaluation => (
                  <div
                    key={evaluation.id}
                    className={`eval-item ${selectedEvaluation?.id === evaluation.id ? 'selected' : ''}`}
                    onClick={() => onSelectEvaluation(evaluation)}
                  >
                    <span className="eval-item-name">{evaluation.name}</span>
                    <span className="eval-item-tags">
                      {evaluation.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="eval-tag">{tag}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {evaluations.length === 0 && (
              <div className="eval-empty">No evaluations found</div>
            )}
          </div>
        )}
      </div>

      {/* Suites Section */}
      <div className="eval-section">
        <div
          className="eval-section-header"
          onClick={() => toggleSection('suites')}
        >
          <span className="expand-icon">{expandedSections.suites ? '▼' : '▶'}</span>
          <span>Suites ({suites.length})</span>
        </div>

        {expandedSections.suites && (
          <div className="eval-section-content">
            {suites.map(suite => (
              <div
                key={suite.id}
                className={`eval-item suite-item ${selectedSuite?.id === suite.id ? 'selected' : ''}`}
                onClick={() => onSelectSuite(suite)}
              >
                <span className="eval-item-name">📦 {suite.name}</span>
                <span className="eval-item-count">{suite.evaluationCount} evals</span>
              </div>
            ))}
            {suites.length === 0 && (
              <div className="eval-empty">No suites found</div>
            )}
          </div>
        )}
      </div>

      {/* Recent Results Section */}
      <div className="eval-section">
        <div
          className="eval-section-header"
          onClick={() => toggleSection('results')}
        >
          <span className="expand-icon">{expandedSections.results ? '▼' : '▶'}</span>
          <span>Recent Results</span>
        </div>

        {expandedSections.results && (
          <div className="eval-section-content">
            {recentResults.length === 0 && (
              <div className="eval-empty">No recent results</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
