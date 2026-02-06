/**
 * Computer Use Sessions Accordion Component
 *
 * Unified display for both browser and desktop automation sessions.
 * Shows thumbnails of screenshots that update in real-time.
 * Clicking a session opens a preview modal.
 */

import React, { memo, useMemo } from 'react';

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
 * Sandbox type labels
 */
const SANDBOX_LABELS = {
  'windows-sandbox': 'WinSandbox',
  'hyperv': 'Hyper-V',
  'virtualbox': 'VBox',
  'tart': 'Tart',
};

/**
 * Computer Use Sessions accordion component.
 * Combines browser sessions and desktop sessions in a single section.
 */
export const ComputerUseSessions = memo(function ComputerUseSessions({
  browserSessions = [],
  desktopSessions = [],
  browserScreenshots = {},
  desktopScreenshots = {},
  selectedSessionId,
  onSelectSession,
  onCloseBrowserSession,
  onCloseDesktopSession,
  expanded,
  onToggle,
}) {
  // Merge sessions into a unified list with a kind tag
  const allSessions = useMemo(() => {
    const browser = browserSessions.map((s) => ({ ...s, _kind: 'browser' }));
    const desktop = desktopSessions.map((s) => ({ ...s, _kind: 'desktop' }));
    return [...browser, ...desktop];
  }, [browserSessions, desktopSessions]);

  const totalCount = allSessions.length;

  return (
    <div className="accordion">
      <button
        className={`accordion-header ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <span className="accordion-icon">🖥️</span>
        <span className="accordion-title">Computer Use</span>
        {totalCount > 0 && (
          <span className="accordion-count">{totalCount}</span>
        )}
        <span className="accordion-arrow">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="accordion-content">
          {totalCount === 0 ? (
            <div className="accordion-empty">No active sessions</div>
          ) : (
            allSessions.map((session) => {
              const isBrowser = session._kind === 'browser';
              const screenshot = isBrowser
                ? browserScreenshots[session.id]
                : desktopScreenshots[session.id];
              const onClose = isBrowser ? onCloseBrowserSession : onCloseDesktopSession;
              const icon = isBrowser ? '🌐' : '🖥️';

              return (
                <div
                  key={session.id}
                  className={`browser-session-item ${
                    session.id === selectedSessionId ? 'selected' : ''
                  }`}
                  onClick={() => onSelectSession(session.id, session._kind)}
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
                        <span className="browser-session-thumbnail-icon">{icon}</span>
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
                      {isBrowser ? (
                        <>
                          {session.strategy === 'computer-use' ? 'CU' : 'DOM'}:{' '}
                          {session.provider}
                        </>
                      ) : (
                        <>
                          {icon} {SANDBOX_LABELS[session.sandbox?.type] || session.sandbox?.type}
                        </>
                      )}
                    </span>
                    {isBrowser && session.currentUrl && (
                      <span
                        className="browser-session-url"
                        title={session.currentUrl}
                      >
                        {getHostname(session.currentUrl)}
                      </span>
                    )}
                    {!isBrowser && session.viewport && (
                      <span className="browser-session-url" title="Viewport size">
                        {session.viewport.width}x{session.viewport.height}
                      </span>
                    )}
                  </div>

                  {/* Close button */}
                  {onClose && (
                    <button
                      className="browser-session-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(session.id);
                      }}
                      title="Close session"
                    >
                      x
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
  return (
    prevProps.browserSessions === nextProps.browserSessions &&
    prevProps.desktopSessions === nextProps.desktopSessions &&
    prevProps.browserScreenshots === nextProps.browserScreenshots &&
    prevProps.desktopScreenshots === nextProps.desktopScreenshots &&
    prevProps.selectedSessionId === nextProps.selectedSessionId &&
    prevProps.onSelectSession === nextProps.onSelectSession &&
    prevProps.onCloseBrowserSession === nextProps.onCloseBrowserSession &&
    prevProps.onCloseDesktopSession === nextProps.onCloseDesktopSession &&
    prevProps.expanded === nextProps.expanded &&
    prevProps.onToggle === nextProps.onToggle
  );
});

/**
 * Extracts hostname from URL for display.
 */
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default ComputerUseSessions;
