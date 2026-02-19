import { memo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';

/**
 * Renders HTML snippet with highlighted marks safely.
 * The snippet comes from FTS5 with <mark> tags for highlighting.
 */
function HighlightedSnippet({ html }) {
  // The snippet only contains <mark> tags from our server, so this is safe
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Format a date string for display in search results.
 * Shows time for today, weekday+time for this week, otherwise month+day.
 */
function formatResultDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Today - show time
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 7) {
    // This week - show weekday and time
    return date.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  } else {
    // Older - show month and day
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

/**
 * SearchResults component - Displays paginated search results with infinite scroll.
 * Uses react-virtuoso for efficient rendering of large result sets.
 */
export const SearchResults = memo(function SearchResults({
  results,
  pagination,
  isLoading,
  onResultClick,
  onLoadMore,
}) {
  const handleEndReached = useCallback(() => {
    if (pagination?.hasOlder && !isLoading) {
      onLoadMore();
    }
  }, [pagination?.hasOlder, isLoading, onLoadMore]);

  // Empty state
  if (results.length === 0 && !isLoading) {
    return (
      <div className="search-results">
        <div className="search-no-results">
          <div className="search-no-results-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <div className="search-no-results-text">No messages found</div>
          <div className="search-no-results-hint">Try different keywords or check spelling</div>
        </div>
      </div>
    );
  }

  const renderItem = (index, result) => (
    <div
      key={result.id}
      className="search-result-item"
      onClick={() => onResultClick(result)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onResultClick(result);
        }
      }}
    >
      <div className="search-result-header">
        <span className="search-result-title" title={result.conversationTitle}>
          {result.conversationTitle || 'Untitled Chat'}
        </span>
        <span className="search-result-meta">
          <span className="search-result-rank" title="BM25 relevance score">
            {Math.abs(result.rank).toFixed(2)}
          </span>
          <span className="search-result-time">{formatResultDate(result.createdAt)}</span>
        </span>
      </div>
      <div className={`search-result-snippet ${result.role}`}>
        <span className="search-result-role">{result.role === 'user' ? 'You' : 'AI'}:</span>
        <HighlightedSnippet html={result.snippet} />
      </div>
    </div>
  );

  return (
    <div className="search-results">
      {pagination?.totalCount !== undefined && (
        <div className="search-results-count">
          {pagination.totalCount} result{pagination.totalCount !== 1 ? 's' : ''} found
        </div>
      )}
      <Virtuoso
        data={results}
        itemContent={renderItem}
        endReached={handleEndReached}
        overscan={200}
        className="search-results-virtuoso"
      />
      {isLoading && (
        <div className="search-loading">
          <span className="loading-spinner" /> Loading more...
        </div>
      )}
    </div>
  );
});
