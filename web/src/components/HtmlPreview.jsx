import React, { useState, useEffect, useRef, memo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/themes/prism-tomorrow.css';

const DEFAULT_HEIGHT = 450;
const MIN_HEIGHT = 300;
const HEIGHT_STEP = 100;

/**
 * HtmlPreview component - renders HTML with toggle between raw code and preview
 * Preview uses sandboxed iframe for security (no JavaScript execution by default)
 *
 * When isStreaming is true, only raw HTML view is shown to prevent flashing.
 * When streaming ends:
 *   - If no JavaScript detected: auto-switches to preview mode (safe)
 *   - If JavaScript present (script tags, inline handlers, javascript: URLs):
 *     stays in raw mode, shows red "Execute" button
 *     User must explicitly click "Execute" to allow JavaScript execution
 */
// Check if HTML contains JavaScript (script tags or inline event handlers)
const hasJavaScript = (htmlContent) => {
  // Check for <script> tags
  if (/<script[\s>]/i.test(htmlContent)) return true;
  // Check for inline event handlers (onclick, onload, onerror, etc.)
  if (/\son\w+\s*=/i.test(htmlContent)) return true;
  // Check for javascript: URLs
  if (/javascript:/i.test(htmlContent)) return true;
  return false;
};

const HtmlPreview = memo(function HtmlPreview({ html, className = '', isStreaming = false }) {
  // Initialize to 'raw' if streaming OR if HTML contains scripts (require explicit Execute)
  const [viewMode, setViewMode] = useState(() => {
    if (isStreaming || hasJavaScript(html)) return 'raw';
    return 'preview';
  });
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [jsExecutionAllowed, setJsExecutionAllowed] = useState(false);
  const prevStreamingRef = useRef(isStreaming);
  const codeRef = useRef(null);
  const iframeRef = useRef(null);
  const modalIframeRef = useRef(null);
  const modalCodeRef = useRef(null);

  // Track the last HTML written to each iframe to avoid unnecessary rewrites
  const lastWrittenHtmlRef = useRef(null);
  const lastWrittenModalHtmlRef = useRef(null);

  const increaseHeight = () => setHeight((h) => h + HEIGHT_STEP);
  const decreaseHeight = () => setHeight((h) => Math.max(MIN_HEIGHT, h - HEIGHT_STEP));

  // Defer heavy rendering until browser is idle
  useEffect(() => {
    const scheduleRender = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    const id = scheduleRender(() => setIsReady(true), { timeout: 100 });
    return () => {
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
  }, []);

  // Detect if HTML contains script tags
  const containsScripts = hasJavaScript(html);

  // Auto-switch to preview when streaming ends (only if no scripts)
  useEffect(() => {
    // If streaming just ended (was true, now false), switch to preview only if no scripts
    if (prevStreamingRef.current && !isStreaming) {
      if (!hasJavaScript(html)) {
        setViewMode('preview');
      }
      // If there are scripts, stay in raw mode - user must explicitly click Execute
    }
    // If streaming just started, switch to raw and reset JS execution permission
    if (!prevStreamingRef.current && isStreaming) {
      setViewMode('raw');
      setJsExecutionAllowed(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, html]);

  // Highlight code when switching to raw mode
  useEffect(() => {
    if (viewMode === 'raw' && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
    if (viewMode === 'raw' && isFullscreen && modalCodeRef.current) {
      Prism.highlightElement(modalCodeRef.current);
    }
  }, [viewMode, html, isFullscreen]);

  // Helper to write HTML to an iframe and adjust its height to fit content
  const writeToIframe = (iframe, htmlContent) => {
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            html, body {
              margin: 0;
              padding: 0;
              overflow: hidden;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              line-height: 1.5;
              color: #333;
              padding: 12px;
              background: #fff;
            }
            /* Scrollbar styling */
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
            ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: #a1a1a1; }
            img { max-width: 100%; height: auto; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #f5f5f5; }
            a { color: #0066cc; }
            pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
            code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
          </style>
        </head>
        <body>${htmlContent}</body>
        </html>
      `);
      doc.close();

      // After content loads, set iframe height to match content
      // This ensures iframe doesn't scroll internally
      setTimeout(() => {
        if (doc.body) {
          const contentHeight = doc.body.scrollHeight;
          iframe.style.height = `${contentHeight}px`;
        }
      }, 0);
    }
  };

  // Update iframe content when in preview mode - only if html actually changed
  // Also write if iframe is empty (e.g., after switching from raw mode, when isReady becomes true, or after jsExecutionAllowed changes)
  useEffect(() => {
    if (isReady && viewMode === 'preview') {
      const iframe = iframeRef.current;
      const needsWrite = html !== lastWrittenHtmlRef.current ||
        !iframe?.contentDocument?.body?.innerHTML;
      if (needsWrite) {
        writeToIframe(iframe, html);
        lastWrittenHtmlRef.current = html;
      }
    }
  }, [isReady, viewMode, html, jsExecutionAllowed, writeToIframe]);

  // Update modal iframe content when fullscreen is open - only if html actually changed
  useEffect(() => {
    if (isReady && isFullscreen && viewMode === 'preview') {
      const iframe = modalIframeRef.current;
      const needsWrite = html !== lastWrittenModalHtmlRef.current ||
        !iframe?.contentDocument?.body?.innerHTML;
      if (needsWrite) {
        writeToIframe(iframe, html);
        lastWrittenModalHtmlRef.current = html;
      }
    }
  }, [isReady, isFullscreen, viewMode, html, jsExecutionAllowed, writeToIframe]);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isFullscreen]);

  // Determine effective view mode (forced to raw while streaming)
  const effectiveViewMode = isStreaming ? 'raw' : viewMode;

  return (
    <div className={`html-preview ${className}`}>
      <div className="html-preview-header">
        <div className="html-preview-tabs">
          {containsScripts ? (
            <button
              className={`html-preview-tab html-preview-tab-execute ${effectiveViewMode === 'preview' ? 'active' : ''}`}
              onClick={() => {
                if (isStreaming) return;
                if (!jsExecutionAllowed) setJsExecutionAllowed(true);
                setViewMode('preview');
              }}
              disabled={isStreaming}
              title={isStreaming ? 'Execute disabled while streaming' : 'Execute JavaScript in sandboxed iframe'}
            >
              Execute
            </button>
          ) : (
            <button
              className={`html-preview-tab ${effectiveViewMode === 'preview' ? 'active' : ''}`}
              onClick={() => !isStreaming && setViewMode('preview')}
              disabled={isStreaming}
              title={isStreaming ? 'Preview disabled while streaming' : 'Preview'}
            >
              Preview
            </button>
          )}
          <button
            className={`html-preview-tab ${effectiveViewMode === 'raw' ? 'active' : ''}`}
            onClick={() => setViewMode('raw')}
          >
            HTML
          </button>
        </div>
        <div className="html-preview-controls">
          <button
            className="html-preview-size-btn"
            onClick={decreaseHeight}
            disabled={height <= MIN_HEIGHT}
            title="Decrease height"
          >
            −
          </button>
          <button
            className="html-preview-size-btn"
            onClick={increaseHeight}
            title="Increase height"
          >
            +
          </button>
          <button
            className="html-preview-size-btn html-preview-fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
            title="Open fullscreen"
          >
            ⛶
          </button>
        </div>
      </div>

      <div className="html-preview-content" style={{ height: `${height}px` }}>
        {!isReady ? (
          <div className="html-preview-placeholder">
            <span className="html-preview-placeholder-text">Loading preview...</span>
          </div>
        ) : effectiveViewMode === 'preview' ? (
          <div className="html-preview-iframe-wrapper">
            <iframe
              key={`iframe-${jsExecutionAllowed}`}
              ref={iframeRef}
              className="html-preview-iframe"
              sandbox={jsExecutionAllowed ? 'allow-same-origin allow-scripts' : 'allow-same-origin'}
              title="HTML Preview"
              scrolling="no"
            />
          </div>
        ) : (
          <pre className="html-preview-code">
            <code ref={codeRef} className="language-markup">
              {html}
            </code>
          </pre>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="html-preview-modal-overlay">
          <div className="html-preview-modal">
            <div className="html-preview-modal-header">
              <div className="html-preview-tabs">
                {containsScripts ? (
                  <button
                    className={`html-preview-tab html-preview-tab-execute ${effectiveViewMode === 'preview' ? 'active' : ''}`}
                    onClick={() => {
                      if (isStreaming) return;
                      if (!jsExecutionAllowed) setJsExecutionAllowed(true);
                      setViewMode('preview');
                    }}
                    disabled={isStreaming}
                    title={isStreaming ? 'Execute disabled while streaming' : 'Execute JavaScript in sandboxed iframe'}
                  >
                    Execute
                  </button>
                ) : (
                  <button
                    className={`html-preview-tab ${effectiveViewMode === 'preview' ? 'active' : ''}`}
                    onClick={() => !isStreaming && setViewMode('preview')}
                    disabled={isStreaming}
                    title={isStreaming ? 'Preview disabled while streaming' : 'Preview'}
                  >
                    Preview
                  </button>
                )}
                <button
                  className={`html-preview-tab ${effectiveViewMode === 'raw' ? 'active' : ''}`}
                  onClick={() => setViewMode('raw')}
                >
                  HTML
                </button>
              </div>
              <button
                className="html-preview-modal-close"
                onClick={() => setIsFullscreen(false)}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <div className="html-preview-modal-content">
              {effectiveViewMode === 'preview' ? (
                <div className="html-preview-iframe-wrapper">
                  <iframe
                    key={`modal-iframe-${jsExecutionAllowed}`}
                    ref={modalIframeRef}
                    className="html-preview-iframe"
                    sandbox={jsExecutionAllowed ? 'allow-same-origin allow-scripts' : 'allow-same-origin'}
                    title="HTML Preview Fullscreen"
                    scrolling="no"
                  />
                </div>
              ) : (
                <pre className="html-preview-code">
                  <code ref={modalCodeRef} className="language-markup">
                    {html}
                  </code>
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default HtmlPreview;
