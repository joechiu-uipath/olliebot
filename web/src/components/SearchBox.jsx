import { useState, useEffect, useRef, memo } from 'react';

/**
 * SearchBox component - Compact search input with debounced search,
 * clear button, and loading spinner.
 */
export const SearchBox = memo(function SearchBox({
  value,
  onChange,
  onSearch,
  onClear,
  isSearching,
  placeholder = 'Search...',
}) {
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounced search - triggers after 300ms of no typing
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (value.trim()) {
      debounceRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, onSearch]);

  const handleClear = () => {
    onChange('');
    onClear();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleClear();
    } else if (e.key === 'Enter') {
      // Immediate search on Enter
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (value.trim()) {
        onSearch(value);
      }
    }
  };

  return (
    <div className="search-box">
      <span className="search-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="search-input"
      />
      {isSearching && <span className="search-spinner" />}
      {value && !isSearching && (
        <button
          className="search-clear-btn"
          onClick={handleClear}
          title="Clear search (Esc)"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
});
