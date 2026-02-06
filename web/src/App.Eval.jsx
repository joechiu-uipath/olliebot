/**
 * Eval mode components - handles evaluation running and results viewing.
 * Separated from App.jsx for cleaner code organization.
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { EvalSidebar, EvalRunner } from './components/eval';

/**
 * Hook to manage eval mode state and handlers.
 * Returns state and handlers for use in sidebar and content components.
 */
export function useEvalMode() {
  const navigate = useNavigate();
  const location = useLocation();

  // Eval state
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [selectedSuite, setSelectedSuite] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);

  // Sync URL to eval state
  useEffect(() => {
    const path = location.pathname;

    if (path === '/eval') {
      setSelectedEvaluation(null);
      setSelectedSuite(null);
      setSelectedResult(null);
      setViewingResults(null);
    } else if (path.startsWith('/eval/result/')) {
      const resultPath = decodeURIComponent(path.slice(13));
      if (resultPath && (!selectedResult || selectedResult.filePath !== resultPath)) {
        const resultInfo = { filePath: resultPath };
        setSelectedResult(resultInfo);
        setSelectedEvaluation(null);
        setSelectedSuite(null);
        fetch(`/api/eval/result/${encodeURIComponent(resultPath)}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.result) setViewingResults(data.result);
          })
          .catch(err => console.error('Failed to load result:', err));
      }
    } else if (path.startsWith('/eval/suite/')) {
      const suitePath = decodeURIComponent(path.slice(12));
      if (suitePath && (!selectedSuite || selectedSuite.suitePath !== suitePath)) {
        setSelectedSuite({ suitePath });
        setSelectedEvaluation(null);
        setSelectedResult(null);
        setViewingResults(null);
      }
    } else if (path.startsWith('/eval/')) {
      const evalPath = decodeURIComponent(path.slice(6));
      if (evalPath && (!selectedEvaluation || selectedEvaluation.path !== evalPath)) {
        setSelectedEvaluation({ path: evalPath });
        setSelectedSuite(null);
        setSelectedResult(null);
        setViewingResults(null);
      }
    }
  }, [location.pathname, selectedEvaluation, selectedResult, selectedSuite]);

  // Handlers
  const handleSelectEvaluation = useCallback((evaluation) => {
    if (evaluation) {
      navigate(`/eval/${encodeURIComponent(evaluation.path)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleSelectSuite = useCallback((suite) => {
    if (suite) {
      navigate(`/eval/suite/${encodeURIComponent(suite.suitePath)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleSelectResult = useCallback((resultInfo) => {
    if (resultInfo) {
      navigate(`/eval/result/${encodeURIComponent(resultInfo.filePath)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleEvalBack = useCallback(() => {
    navigate('/eval');
  }, [navigate]);

  return {
    // State
    selectedEvaluation,
    selectedSuite,
    selectedResult,
    viewingResults,
    // Handlers
    handleSelectEvaluation,
    handleSelectSuite,
    handleSelectResult,
    handleEvalBack,
  };
}

/**
 * EvalSidebarContent - renders the eval sidebar content.
 * Memoized to prevent re-renders when parent (App.jsx) updates unrelated state.
 */
export const EvalSidebarContent = memo(function EvalSidebarContent({ evalMode }) {
  return (
    <EvalSidebar
      onSelectEvaluation={evalMode.handleSelectEvaluation}
      onSelectSuite={evalMode.handleSelectSuite}
      onSelectResult={evalMode.handleSelectResult}
      selectedEvaluation={evalMode.selectedEvaluation}
      selectedSuite={evalMode.selectedSuite}
      selectedResult={evalMode.selectedResult}
    />
  );
}, (prevProps, nextProps) => {
  // Only re-render when selection state changes
  const prev = prevProps.evalMode;
  const next = nextProps.evalMode;
  return (
    prev.selectedEvaluation === next.selectedEvaluation &&
    prev.selectedSuite === next.selectedSuite &&
    prev.selectedResult === next.selectedResult
  );
});

/**
 * EvalMainContent - renders the eval main content area.
 * Memoized to prevent re-renders when parent (App.jsx) updates unrelated state.
 */
export const EvalMainContent = memo(function EvalMainContent({ evalMode, evalState }) {
  return (
    <main className="eval-container">
      <EvalRunner
        evaluation={evalMode.selectedEvaluation}
        suite={evalMode.selectedSuite}
        viewingResults={evalMode.viewingResults}
        onBack={evalMode.handleEvalBack}
        evalState={evalState}
      />
    </main>
  );
}, (prevProps, nextProps) => {
  // Only re-render when relevant state changes
  const prev = prevProps.evalMode;
  const next = nextProps.evalMode;
  return (
    prev.selectedEvaluation === next.selectedEvaluation &&
    prev.selectedSuite === next.selectedSuite &&
    prev.viewingResults === next.viewingResults &&
    prevProps.evalState === nextProps.evalState
  );
});
