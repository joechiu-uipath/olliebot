import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { getMarkdownComponents } from './CodeBlock';
import { CitedContent } from './CitedContent';

// Custom sanitize schema that allows mark tags for citations
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    mark: ['className', 'class'],
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className'],
  },
  // Allow citation-related class names
  clobber: [],
  clobberPrefix: '',
};

// Rehype plugin arrays (stable references)
const rehypePluginsWithHtml = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];
const rehypePluginsDefault = [[rehypeSanitize, sanitizeSchema]];

/**
 * Message content component for rendering markdown messages.
 * Supports citation highlighting when citations prop is provided.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
export const MessageContent = memo(function MessageContent({
  content,
  html = false,
  isStreaming = false,
  citations = null,
  messageId = null
}) {
  const components = getMarkdownComponents(isStreaming);
  const rehypePlugins = html ? rehypePluginsWithHtml : rehypePluginsDefault;

  // Use CitedContent when citations with references are available
  if (citations?.references?.length > 0 && !isStreaming) {
    return (
      <CitedContent
        content={content}
        citations={citations}
        messageId={messageId}
        html={html}
        isStreaming={isStreaming}
        rehypePlugins={rehypePlugins}
        remarkPlugins={[remarkGfm]}
        components={components}
      />
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - check each prop for equality
  return (
    prevProps.content === nextProps.content &&
    prevProps.html === nextProps.html &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.citations === nextProps.citations &&
    prevProps.messageId === nextProps.messageId
  );
});

export default MessageContent;
