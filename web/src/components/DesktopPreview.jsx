/**
 * Desktop Preview Component
 *
 * Modal that shows a live screenshot preview of the selected desktop session.
 * Overlays click markers for visualization.
 */

import React, { memo } from 'react';
import { ClickOverlay } from './ClickOverlay';

/**
 * Sandbox type display names
 */
const SANDBOX_LABELS = {
  'windows-sandbox': 'Windows Sandbox',
  'hyperv': 'Hyper-V VM',
  'virtualbox': 'VirtualBox',
  'tart': 'Tart VM',
};

/**
 * Platform display names
 */
const PLATFORM_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/**
 * Desktop preview modal component.
 */
export const DesktopPreview = memo(function DesktopPreview({
  session,
  screenshot,
  clickMarkers = [],
  onClose,
  onCloseSession,
}) {
  if (!session) {
    return null;
  }

  const sandboxLabel = SANDBOX_LABELS[session.sandbox?.type] || session.sandbox?.type || 'Unknown';
  const platformLabel = PLATFORM_LABELS[session.sandbox?.platform] || session.sandbox?.platform || 'Unknown';

  return (
    <div className="browser-preview-overlay" onClick={onClose}>
      <div
        className="browser-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="browser-preview-header">
          <div className="browser-preview-title">
            <span className="browser-preview-icon">🖥️</span>
            <span className="browser-preview-name">{session.name}</span>
            <span className="browser-preview-url" title={`${sandboxLabel} - ${platformLabel}`}>
              {sandboxLabel}
            </span>
          </div>
          <button
            className="browser-preview-close"
            onClick={onClose}
            title="Close preview"
          >
            ×
          </button>
        </div>

        {/* Viewport with screenshot */}
        <div className="browser-preview-viewport">
          {screenshot?.screenshot ? (
            <>
              <img
                src={`data:image/png;base64,${screenshot.screenshot}`}
                alt={`Desktop session: ${session.name}`}
                className="browser-preview-screenshot"
              />
              <ClickOverlay
                markers={clickMarkers.filter((m) => m.sessionId === session.id)}
                viewportSize={session.viewport || { width: 1024, height: 768 }}
              />
            </>
          ) : (
            <div className="browser-preview-loading">
              <span>
                {session.status === 'provisioning'
                  ? 'Provisioning sandbox...'
                  : session.status === 'starting'
                  ? 'Connecting to VNC...'
                  : 'Loading screenshot...'}
              </span>
            </div>
          )}
        </div>

        {/* Footer with session info */}
        <div className="browser-preview-footer">
          <span className="browser-preview-strategy">
            Sandbox: {sandboxLabel}
          </span>
          <span className="browser-preview-provider">
            Platform: {platformLabel}
          </span>
          <span className="browser-preview-status" data-status={session.status}>
            Status: {session.status}
          </span>
          {session.viewport && (
            <span className="browser-preview-timestamp">
              {session.viewport.width}×{session.viewport.height}
            </span>
          )}
          {screenshot?.timestamp && (
            <span className="browser-preview-timestamp">
              Updated: {formatTime(screenshot.timestamp)}
            </span>
          )}
          {session.error && (
            <span className="browser-preview-error" title={session.error}>
              ⚠️ {session.error.slice(0, 50)}...
            </span>
          )}
          {onCloseSession && (
            <button
              className="browser-preview-close-session"
              onClick={() => {
                onCloseSession(session.id);
                onClose();
              }}
              title="Kill desktop session"
            >
              Kill Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Formats timestamp for display.
 */
function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return timestamp;
  }
}

export default DesktopPreview;
