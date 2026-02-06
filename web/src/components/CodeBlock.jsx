import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import HtmlPreview from './HtmlPreview';

/**
 * Code block component with copy button and language header.
 * Uses deferred rendering for faster initial display.
 */
export function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const hasLanguage = language && language !== 'text';

  // Defer syntax highlighting until browser is idle
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

  const handleCopy = async () => {
    let success = false;
    try {
      await navigator.clipboard.writeText(children);
      success = true;
    } catch (err) {
      console.error('Failed to copy:', err);
    }
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`code-block-container ${hasLanguage ? 'has-header' : ''}`}>
      {hasLanguage && (
        <div className="code-block-header">
          <span className="code-block-language">{language}</span>
        </div>
      )}
      <button
        className={`code-copy-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {isReady ? (
        <SyntaxHighlighter
          style={oneDark}
          language={language || 'text'}
          PreTag="div"
          className="code-block-highlighted"
          customStyle={{
            margin: 0,
            borderRadius: hasLanguage ? '0 0 6px 6px' : '6px',
            fontSize: '13px',
          }}
        >
          {children}
        </SyntaxHighlighter>
      ) : (
        <div
          className="code-block-placeholder"
          style={{
            margin: 0,
            padding: '1em',
            borderRadius: hasLanguage ? '0 0 6px 6px' : '6px',
            fontSize: '13px',
            background: '#282c34',
            color: '#abb2bf',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            maxHeight: '200px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Static markdown components that don't depend on props (defined once, reused)
const staticMarkdownComponents = {
  pre({ children }) {
    return <div className="code-block-wrapper">{children}</div>;
  },
  table({ children }) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
};

/**
 * Factory to create code component for markdown rendering.
 * Only recreated when isStreaming changes.
 */
function createCodeComponent(isStreaming) {
  return function CodeComponent({ node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : null;
    const isBlock = match || (node?.tagName === 'code' && node?.parent?.tagName === 'pre');

    if (isBlock) {
      const codeContent = String(children).replace(/\n$/, '');
      if (language === 'html' || language === 'htm') {
        return <HtmlPreview html={codeContent} isStreaming={isStreaming} />;
      }
      return <CodeBlock language={language}>{codeContent}</CodeBlock>;
    }
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  };
}

// Cache for markdown components keyed by isStreaming value
const markdownComponentsCache = new Map();

/**
 * Get markdown components for ReactMarkdown.
 * Caches components to avoid recreating them on every render.
 */
export function getMarkdownComponents(isStreaming) {
  if (!markdownComponentsCache.has(isStreaming)) {
    markdownComponentsCache.set(isStreaming, {
      ...staticMarkdownComponents,
      code: createCodeComponent(isStreaming),
    });
  }
  return markdownComponentsCache.get(isStreaming);
}

export default CodeBlock;
