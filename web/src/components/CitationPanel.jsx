import React, { useState, useEffect, useRef, memo, useCallback } from 'react';

/**
 * Source type icons
 */
const SOURCE_ICONS = {
  web: '🌐',
  file: '📄',
  api: '🔌',
  database: '🗄️',
  memory: '🧠',
  skill: '⚡',
  mcp: '🔗',
};

/**
 * Check if a source is a viewable PDF
 */
function isPdfSource(source) {
  return (
    source.type === 'file' &&
    source.title &&
    source.title.toLowerCase().endsWith('.pdf') &&
    source.projectId
  );
}

/**
 * Build PDF URL from source
 */
function buildPdfUrl(source) {
  if (!source.projectId || !source.title) return null;
  return `/api/rag/projects/${encodeURIComponent(source.projectId)}/documents/${encodeURIComponent(source.title)}`;
}

/**
 * Individual source card component
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
const SourceCard = memo(function SourceCard({ index, source, isHighlighted }) {
  const icon = SOURCE_ICONS[source.type] || '📎';
  const isPdf = isPdfSource(source);

  const handlePdfClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const pdfUrl = buildPdfUrl(source);
    if (pdfUrl) {
      window.dispatchEvent(
        new CustomEvent('pdf-view', {
          detail: {
            fileUrl: pdfUrl,
            filename: source.title,
            initialPage: source.pageNumber || 1,
          },
        })
      );
    }
  }, [source]);

  return (
    <div
      id={`citation-source-${source.id}`}
      className={`source-card ${isHighlighted ? 'highlighted' : ''}`}
    >
      <div className="source-header">
        <span className="source-index">[{index}]</span>
        <span className="source-icon">{icon}</span>
        <span className="source-domain">{source.domain || 'local'}</span>
        {source.uri && source.type === 'web' && (
          <a
            href={source.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
            onClick={(e) => e.stopPropagation()}
          >
            Visit
          </a>
        )}
        {source.pageNumber && (
          <span className="source-page">Page {source.pageNumber}</span>
        )}
      </div>
      {source.title && (
        isPdf ? (
          <div
            className="source-title source-title-link"
            onClick={handlePdfClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handlePdfClick(e)}
          >
            {source.title}
          </div>
        ) : (
          <div className="source-title">{source.title}</div>
        )
      )}
      {source.snippet && (
        <div className="source-snippet">"{source.snippet}"</div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.source === nextProps.source &&
    prevProps.isHighlighted === nextProps.isHighlighted
  );
});

/**
 * Citation panel component - displays citation sources for a message
 * Listens for 'citation-click' custom events to expand and scroll to specific sources.
 */
export const CitationPanel = memo(function CitationPanel({ citations, messageId }) {
  const [expanded, setExpanded] = useState(false);
  const [highlightedSourceId, setHighlightedSourceId] = useState(null);
  const panelRef = useRef(null);

  // Listen for citation click events
  useEffect(() => {
    const handleCitationClick = (event) => {
      const { sourceId, targetMessageId } = event.detail;

      // Only respond if this panel belongs to the target message
      if (targetMessageId && messageId && targetMessageId !== messageId) {
        return;
      }

      // Check if this source belongs to this panel
      const hasSource = citations?.sources?.some((s) => s.id === sourceId);
      if (!hasSource) return;

      // Expand the panel
      setExpanded(true);

      // Highlight the source temporarily
      setHighlightedSourceId(sourceId);

      // Scroll to the source after a short delay (to allow expansion)
      setTimeout(() => {
        const sourceElement = document.getElementById(`citation-source-${sourceId}`);
        if (sourceElement) {
          sourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Remove highlight after animation
        setTimeout(() => {
          setHighlightedSourceId(null);
        }, 2000);
      }, 100);
    };

    window.addEventListener('citation-click', handleCitationClick);
    return () => window.removeEventListener('citation-click', handleCitationClick);
  }, [citations, messageId]);

  // Don't render if no citations or no sources
  if (!citations?.sources || citations.sources.length === 0) {
    return null;
  }

  const { sources } = citations;
  const sourceCount = sources.length;

  return (
    <div className="citation-panel" ref={panelRef}>
      <button
        className="citation-panel-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="citation-panel-icon">📚</span>
        <span className="citation-panel-text">
          {sourceCount} source{sourceCount !== 1 ? 's' : ''} used
        </span>
        <span className="citation-panel-arrow">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="citation-source-list">
          {sources.map((source, i) => (
            <SourceCard
              key={source.id || i}
              index={i + 1}
              source={source}
              isHighlighted={source.id === highlightedSourceId}
            />
          ))}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.citations === nextProps.citations &&
    prevProps.messageId === nextProps.messageId
  );
});

// Keep backward compatibility
export const SourcePanel = CitationPanel;

export default CitationPanel;
