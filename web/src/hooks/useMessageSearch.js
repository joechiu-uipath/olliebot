import { useState, useCallback, useRef } from 'react';

/**
 * Hook for searching messages across all conversations using hybrid search.
 * Combines FTS (full-text) and embedding-based semantic search with RRF fusion.
 * Features debounced search, pagination, and request cancellation.
 */
export function useMessageSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPagination, setSearchPagination] = useState(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const abortControllerRef = useRef(null);

  const search = useCallback(async (query, loadMore = false) => {
    // Cancel any pending search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!query.trim()) {
      setSearchResults([]);
      setSearchPagination(null);
      setIsSearchMode(false);
      return;
    }

    setIsSearchMode(true);
    setIsSearching(true);
    abortControllerRef.current = new AbortController();

    try {
      const params = new URLSearchParams({
        q: query,
        limit: '20',
        includeTotal: 'true',
        mode: 'hybrid',
      });

      if (loadMore && searchPagination?.oldestCursor) {
        params.set('before', searchPagination.oldestCursor);
      }

      const res = await fetch(`/api/messages/search?${params}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) throw new Error('Search failed');

      const data = await res.json();

      setSearchResults(prev => loadMore ? [...prev, ...data.items] : data.items);
      setSearchPagination(data.pagination);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[MessageSearch] Search error:', error);
      }
    } finally {
      setIsSearching(false);
    }
  }, [searchPagination?.oldestCursor]);

  const clearSearch = useCallback(() => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setSearchQuery('');
    setSearchResults([]);
    setSearchPagination(null);
    setIsSearchMode(false);
    setIsSearching(false);
  }, []);

  const loadMoreResults = useCallback(() => {
    if (searchQuery && searchPagination?.hasOlder && !isSearching) {
      search(searchQuery, true);
    }
  }, [searchQuery, searchPagination?.hasOlder, isSearching, search]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    searchPagination,
    isSearchMode,
    search,
    clearSearch,
    loadMoreResults,
  };
}
