import React, { useState, memo, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

/**
 * Source type icons for tooltip display
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
 * Citation tooltip component (non-interactive, display only)
 */
const CitationTooltip = memo(function CitationTooltip({ source, position }) {
  if (!source) return null;

  const icon = SOURCE_ICONS[source.type] || '📎';

  return (
    <div
      className="citation-tooltip"
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
      }}
    >
      <div className="citation-tooltip-header">
        <span className="citation-tooltip-icon">{icon}</span>
        <span className="citation-tooltip-domain">{source.domain || 'local'}</span>
      </div>
      {source.title && (
        <div className="citation-tooltip-title">{source.title}</div>
      )}
      {source.snippet && (
        <div className="citation-tooltip-snippet">"{source.snippet}"</div>
      )}
      {source.pageNumber && (
        <div className="citation-tooltip-page">Page {source.pageNumber}</div>
      )}
    </div>
  );
});

/**
 * Highlighted citation span with hover tooltip and click-to-scroll
 */
const CitationHighlight = memo(function CitationHighlight({ children, source, index, messageId }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipWidth = 320; // Approximate tooltip width
    const viewportWidth = window.innerWidth;

    // Calculate x position - shift left if it would overflow right edge
    let x = 0;
    if (rect.left + tooltipWidth > viewportWidth - 16) {
      // Tooltip would overflow - shift it left
      x = Math.min(0, viewportWidth - rect.left - tooltipWidth - 16);
    }

    setTooltipPosition({
      x,
      y: rect.height + 4,
    });
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const handleClick = (e) => {
    e.preventDefault();
    // Dispatch custom event to expand CitationPanel and scroll to this source
    if (source?.id) {
      window.dispatchEvent(
        new CustomEvent('citation-click', {
          detail: {
            sourceId: source.id,
            targetMessageId: messageId,
          },
        })
      );
    }
  };

  return (
    <span
      className="citation-highlight"
      data-citation-index={index}
      data-source-id={source?.id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick(e)}
    >
      {children}
      {showTooltip && (
        <CitationTooltip source={source} position={tooltipPosition} />
      )}
    </span>
  );
});

/**
 * Inject <mark> tags into markdown content for citation highlighting.
 * This preserves markdown structure while marking cited text.
 *
 * We store citation reference indices in a module-level map and only pass
 * a simple numeric ID in the class name (survives any sanitizer).
 *
 * @param {string} content - Original markdown content
 * @param {Array} references - Citation references with startIndex/endIndex
 * @returns {{ content: string, refMap: Map }} Content with marks and reference map
 */
let globalRefId = 0;
const globalRefMap = new Map();

function injectCitationMarks(content, references) {
  if (!references || references.length === 0) {
    return content;
  }

  // Sort references by startIndex in descending order so we can inject from end to start
  // This prevents index shifting issues
  const sortedRefs = [...references]
    .filter(ref => ref.startIndex >= 0 && ref.endIndex <= content.length && ref.startIndex < ref.endIndex)
    .sort((a, b) => b.startIndex - a.startIndex);

  let result = content;
  for (const ref of sortedRefs) {
    // Store reference data with a simple numeric ID
    const refId = ++globalRefId;
    globalRefMap.set(refId, {
      sourceId: ref.sourceIds?.[0] || '',
      index: ref.index || 0
    });

    // Use a simple class name that will survive sanitization: citeref{number}
    // Inject closing tag first (since we're going backwards)
    result = result.slice(0, ref.endIndex) + '</mark>' + result.slice(ref.endIndex);
    // Then inject opening tag with simple class
    result = result.slice(0, ref.startIndex) +
      `<mark class="citeref${refId}">` +
      result.slice(ref.startIndex);
  }

  return result;
}

/**
 * Get reference data by ID from global map
 */
function getRefData(refId) {
  return globalRefMap.get(refId);
}

/**
 * Cited content component - renders content with citation highlights
 * Uses <mark> tag injection to preserve markdown structure
 */
export const CitedContent = memo(function CitedContent({
  content,
  citations,
  messageId,
  html = false,
  isStreaming = false,
  rehypePlugins,
  remarkPlugins,
  components,
}) {
  // Check if we have citations
  const hasCitations = citations?.references?.length > 0;

  // Build source lookup map for the mark component
  const sources = citations?.sources;
  const sourceMap = useMemo(() => {
    if (!sources) return {};
    return Object.fromEntries(sources.map(s => [s.id, s]));
  }, [sources]);

  // Inject citation marks into content
  const references = citations?.references;
  const markedContent = useMemo(() => {
    if (!hasCitations || isStreaming) {
      return content;
    }
    return injectCitationMarks(content, references);
  }, [content, references, hasCitations, isStreaming]);

  // Create custom mark component that uses CitationHighlight
  const markComponent = useCallback(({ node, children, className, ...props }) => {
    // Parse refId from class name (format: citeref{number})
    // Check both className prop and node.properties.className
    const classFromProp = className || '';
    const classFromNode = node?.properties?.className;
    const classes = classFromProp || (Array.isArray(classFromNode) ? classFromNode.join(' ') : classFromNode) || '';

    let index = 0;
    let sourceId = '';

    const refMatch = classes.match(/citeref(\d+)/);
    if (refMatch) {
      const refId = parseInt(refMatch[1], 10);
      const refData = getRefData(refId);
      if (refData) {
        index = refData.index;
        sourceId = refData.sourceId;
      }
    }

    const source = sourceMap[sourceId];

    return (
      <CitationHighlight
        source={source}
        index={index}
        messageId={messageId}
      >
        {children}
      </CitationHighlight>
    );
  }, [sourceMap, messageId]);

  // Merge custom mark component with provided components
  const mergedComponents = useMemo(() => ({
    ...components,
    mark: markComponent,
  }), [components, markComponent]);

  // Build rehype plugins - need rehypeRaw to process the injected HTML
  const mergedRehypePlugins = useMemo(() => {
    const plugins = rehypePlugins ? [...rehypePlugins] : [];
    // Add rehypeRaw if not already present and we have citations
    if (hasCitations && !isStreaming) {
      // Check if rehypeRaw is already in the list
      const hasRehypeRaw = plugins.some(p =>
        p === rehypeRaw || (Array.isArray(p) && p[0] === rehypeRaw)
      );
      if (!hasRehypeRaw) {
        plugins.unshift(rehypeRaw);
      }
    }
    return plugins;
  }, [rehypePlugins, hasCitations, isStreaming]);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins || [remarkGfm]}
      rehypePlugins={mergedRehypePlugins}
      components={mergedComponents}
    >
      {markedContent}
    </ReactMarkdown>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.content === nextProps.content &&
    prevProps.citations === nextProps.citations &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.html === nextProps.html &&
    prevProps.isStreaming === nextProps.isStreaming
  );
});

export default CitedContent;
