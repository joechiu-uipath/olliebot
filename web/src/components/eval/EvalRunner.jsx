import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { EvalResults } from './EvalResults';
import { EvalJsonEditor } from './EvalJsonEditor';
import { EvalInputBar } from './EvalInputBar';

export const EvalRunner = memo(function EvalRunner({ evaluation, suite, viewingResults, onBack, evalState }) {
  const [evalDetails, setEvalDetails] = useState(null);
  // Local results state for viewing past results (viewingResults prop)
  // Fresh run results come from evalState.results

  // Clear shared eval state when selection changes
  useEffect(() => {
    if (evalState) {
      evalState.setResults(null);
      evalState.setError(null);
      evalState.setProgress(null);
      evalState.setLoading(false);
      evalState.setJobId(null);
    }
  }, [evaluation, suite, viewingResults]);

  // Check for active jobs on mount (UI recovery)
  useEffect(() => {
    const checkActiveJobs = async () => {
      if (!evalState) return;
      try {
        const res = await fetch('/api/eval/jobs');
        if (res.ok) {
          const data = await res.json();
          const jobs = data.jobs;
          if (jobs) {
            const runningJob = jobs.find(job => job.status === 'running');
            if (runningJob) {
              evalState.setJobId(runningJob.jobId);
              evalState.setLoading(true);
              evalState.setProgress({ current: 0, total: 1 }); // Will be updated by WebSocket
            }
          }
        }
      } catch (err) {
        console.error('Failed to check active jobs:', err);
      }
    };
    checkActiveJobs();
  }, []);

  const loadEvaluationDetails = useCallback(async (path) => {
    try {
      const res = await fetch(`/api/eval/${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setEvalDetails(data.evaluation);
      }
    } catch (err) {
      console.error('Failed to load evaluation details:', err);
    }
  }, []);

  // Load evaluation details when selected
  useEffect(() => {
    if (evaluation) {
      loadEvaluationDetails(evaluation.path);
    } else {
      setEvalDetails(null);
    }
  }, [evaluation, loadEvaluationDetails]);

  // Use ref for evaluation path to keep callback stable
  const evaluationRef = useRef(evaluation);
  useEffect(() => { evaluationRef.current = evaluation; }, [evaluation]);

  // Use ref for evalState to keep callback stable
  const evalStateRef = useRef(evalState);
  useEffect(() => { evalStateRef.current = evalState; }, [evalState]);

  const runEvaluation = useCallback(async (config) => {
    const currentEvaluation = evaluationRef.current;
    const state = evalStateRef.current;
    if (!currentEvaluation || !state) return;

    state.setLoading(true);
    state.setError(null);
    state.setResults(null);
    state.setProgress({ current: 0, total: config.runs });

    try {
      const res = await fetch('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluationPath: currentEvaluation.path,
          runs: config.runs,
          alternativePrompt: config.alternativePrompt,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[EvalRunner] Started evaluation with jobId:', data.jobId);
        state.setJobId(data.jobId);
      } else {
        state.setError('Failed to start evaluation');
        state.setLoading(false);
      }
    } catch (err) {
      state.setError(err.message);
      state.setLoading(false);
    }
  }, []);

  const runSuite = useCallback(async () => {
    const state = evalStateRef.current;
    if (!suite || !state) return;

    state.setLoading(true);
    state.setError(null);
    state.setResults(null);

    try {
      const res = await fetch('/api/eval/suite/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suitePath: suite.suitePath,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[EvalRunner] Started suite with jobId:', data.jobId);
        state.setJobId(data.jobId);
      } else {
        state.setError('Failed to start suite');
        state.setLoading(false);
      }
    } catch (err) {
      state.setError(err.message);
      state.setLoading(false);
    }
  }, [suite]);

  // Handle save from JSON editor - memoized for EvalJsonEditor
  const handleSave = useCallback((updatedEval) => {
    setEvalDetails(updatedEval);
  }, []);

  // Handle close results - memoized for EvalResults
  const handleCloseResults = useCallback(() => {
    const state = evalStateRef.current;
    if (state) {
      state.setResults(null);
      state.setJobId(null);
    }
  }, []);

  // Get values from evalState (with defaults for safety)
  const loading = evalState?.loading ?? false;
  const progress = evalState?.progress ?? null;
  const results = evalState?.results ?? null;
  const error = evalState?.error ?? null;

  // Show results if available (from a fresh run)
  if (results) {
    return (
      <EvalResults
        results={results}
        onClose={handleCloseResults}
      />
    );
  }

  // Show past results if viewing from sidebar
  if (viewingResults) {
    return (
      <EvalResults
        results={viewingResults}
        onClose={onBack}
      />
    );
  }

  // Show suite view
  if (suite) {
    return (
      <div className="eval-runner">
        <div className="eval-runner-header">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h2>📦 {suite.name}</h2>
        </div>

        <div className="eval-runner-content">
          <div className="eval-info-card">
            <p className="eval-description">{suite.description}</p>
            <div className="eval-meta">
              <span>Evaluations: {suite.evaluations?.length || 0}</span>
            </div>
          </div>

          <div className="eval-actions">
            <button
              className="run-btn primary"
              onClick={runSuite}
              disabled={loading}
            >
              {loading ? 'Running...' : 'Run Suite'}
            </button>
          </div>

          {loading && progress && (
            <div className="eval-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <span className="progress-text">
                {progress.current} / {progress.total} runs
              </span>
            </div>
          )}

          {error && (
            <div className="eval-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show evaluation view with JSON editor
  if (evaluation) {
    return (
      <div className="eval-runner">
        <div className="eval-runner-content eval-runner-content-full">
          {/* JSON Editor */}
          <EvalJsonEditor
            evaluation={evaluation}
            evalDetails={evalDetails}
            onSave={handleSave}
          />

          {error && (
            <div className="eval-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {/* Bottom bar - anchored like chat input */}
        <EvalInputBar
          onRun={runEvaluation}
          loading={loading}
          progress={progress}
        />
      </div>
    );
  }

  // Empty state
  return (
    <div className="eval-runner empty">
      <div className="eval-empty-state">
        <h2>📊 Prompt Evaluation</h2>
        <p>Select an evaluation or suite from the sidebar to get started.</p>
        <p className="hint">
          Evaluations test your prompts against expected behaviors,
          tool usage, and response quality.
        </p>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when value props change
  // Callbacks are not compared since they may have new references but same behavior
  return (
    prevProps.evaluation === nextProps.evaluation &&
    prevProps.suite === nextProps.suite &&
    prevProps.viewingResults === nextProps.viewingResults &&
    prevProps.evalState === nextProps.evalState
  );
});
