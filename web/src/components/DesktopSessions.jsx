/**
 * Desktop Sessions Accordion Component
 *
 * Displays active sandboxed desktop sessions in the sidebar.
 * Shows thumbnails of desktop screenshots that update in real-time.
 * Clicking a session opens a preview modal.
 */

import React, { memo } from 'react';

/**
 * Status indicator colors
 */
const STATUS_COLORS = {
  provisioning: '#8b5cf6', // purple
  starting: '#3b82f6',     // blue
  active: '#22c55e',       // green
  busy: '#f59e0b',         // amber
  idle: '#eab308',         // yellow
  error: '#ef4444',        // red
  closed: '#6b7280',       // gray
};

/**
 * Sandbox type display names
 */
const SANDBOX_LABELS = {
  'windows-sandbox': 'WinSandbox',
  'hyperv': 'Hyper-V',
  'virtualbox': 'VBox',
  'tart': 'Tart',
};

/**
 * Platform icons
 */
const PLATFORM_ICONS = {
  windows: '🪟',
  macos: '🍎',
  linux: '🐧',
};

/**
 * Desktop Sessions accordion component.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
export const DesktopSessions = memo(function DesktopSessions({
  sessions = [],
  screenshots = {},
  selectedSessionId,
  onSelectSession,
  onCloseSession,
  expanded,
  onToggle,
}) {
  return (
    <div className="accordion">
      <button
        className={`accordion-header ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <span className="accordion-icon">🖥️</span>
        <span className="accordion-title">Desktop Sessions</span>
        {sessions.length > 0 && (
          <span className="accordion-count">{sessions.length}</span>
        )}
        <span className="accordion-arrow">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="accordion-content">
          {sessions.length === 0 ? (
            <div className="accordion-empty">No active sessions</div>
          ) : (
            sessions.map((session) => {
              const screenshot = screenshots[session.id];
              const platformIcon = PLATFORM_ICONS[session.sandbox?.platform] || '🖥️';
              const sandboxLabel = SANDBOX_LABELS[session.sandbox?.type] || session.sandbox?.type;

              return (
                <div
                  key={session.id}
                  className={`browser-session-item ${
                    session.id === selectedSessionId ? 'selected' : ''
                  }`}
                  onClick={() => onSelectSession(session.id)}
                >
                  {/* Thumbnail container */}
                  <div className="browser-session-thumbnail-container">
                    {screenshot?.screenshot ? (
                      <img
                        src={`data:image/png;base64,${screenshot.screenshot}`}
                        alt={session.name}
                        className="browser-session-thumbnail"
                      />
                    ) : (
                      <div className="browser-session-thumbnail-placeholder">
                        <span className="browser-session-thumbnail-icon">{platformIcon}</span>
                      </div>
                    )}
                    {/* Status indicator overlay */}
                    <span
                      className="browser-session-status-badge"
                      style={{ backgroundColor: STATUS_COLORS[session.status] || STATUS_COLORS.idle }}
                      title={session.status}
                    />
                  </div>

                  {/* Session info below thumbnail */}
                  <div className="browser-session-meta">
                    <span className="browser-session-name">{session.name}</span>
                    <span className="browser-session-strategy">
                      {platformIcon} {sandboxLabel}
                    </span>
                    {session.viewport && (
                      <span className="browser-session-url" title="Viewport size">
                        {session.viewport.width}×{session.viewport.height}
                      </span>
                    )}
                    {session.error && (
                      <span className="browser-session-error" title={session.error}>
                        ⚠️ Error
                      </span>
                    )}
                  </div>

                  {/* Close button */}
                  {onCloseSession && (
                    <button
                      className="browser-session-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseSession(session.id);
                      }}
                      title="Close session"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - check each prop for equality
  return (
    prevProps.sessions === nextProps.sessions &&
    prevProps.screenshots === nextProps.screenshots &&
    prevProps.selectedSessionId === nextProps.selectedSessionId &&
    prevProps.onSelectSession === nextProps.onSelectSession &&
    prevProps.onCloseSession === nextProps.onCloseSession &&
    prevProps.expanded === nextProps.expanded &&
    prevProps.onToggle === nextProps.onToggle
  );
});

export default DesktopSessions;
