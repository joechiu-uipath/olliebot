/**
 * AgentChatMessage — renders a single chat message.
 *
 * Supports:
 * - User messages
 * - Assistant messages (with agent name/emoji, streaming indicator)
 * - Tool events (expandable details)
 * - Delegation events
 * - Task run events
 * - Collapsible agent messages (for agents with collapseResponseByDefault)
 * - Citations and usage stats
 */

import { memo, useCallback } from 'react';
import { MessageContent } from '../MessageContent';
import { CitationPanel } from '../CitationPanel';
import { AudioPlayer } from '../AudioPlayer';
import { CodeBlock } from '../CodeBlock';

const DEFAULT_AGENT_ICON = '🤖';
const DELEGATION_MISSION_MAX_LENGTH = 500;

// Empty Sets for default values (avoids React Compiler issues with `new Set()` in destructuring)
const EMPTY_SET = new Set();

/**
 * Format token count with K/M suffix.
 */
function formatTokenCount(count) {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return String(count);
}

/**
 * Check if an agent type should collapse by default.
 */
function shouldCollapseByDefault(agentType, agentName, agentTemplates) {
  if (!agentTemplates || !agentType) return false;
  const template = agentTemplates.find((t) => t.type === agentType);
  return template?.collapseResponseByDefault || false;
}

/**
 * Helper to check if a value is a data URL image.
 */
function isDataUrlImage(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Helper to check if result contains audio data (tool-agnostic).
 * Audio can be in obj.audio (legacy) or obj.output.audio (nested from native tools).
 */
function isAudioResult(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.audio && typeof obj.audio === 'string' && obj.audio.length > 100) {
    return true;
  }
  if (obj.output && typeof obj.output === 'object' && obj.output.audio && typeof obj.output.audio === 'string' && obj.output.audio.length > 100) {
    return true;
  }
  return false;
}

/**
 * Helper to extract audio data from result (handles both legacy and nested structures).
 */
function getAudioData(obj) {
  if (obj.audio && typeof obj.audio === 'string') {
    return { audio: obj.audio, mimeType: obj.mimeType };
  }
  if (obj.output && typeof obj.output === 'object' && obj.output.audio) {
    return { audio: obj.output.audio, mimeType: obj.output.mimeType };
  }
  return null;
}

/**
 * Helper to render output that might contain markdown code blocks.
 */
function renderOutput(output) {
  if (typeof output !== 'string') {
    const entries = Object.entries(output).filter(([key]) =>
      !['audio', 'mimeType', 'files'].includes(key)
    );
    if (entries.length === 0) return null;
    return (
      <div className="tool-result-properties">
        {entries.map(([key, value]) => (
          <div key={key} className="tool-result-property">
            <span className="tool-result-key">{key}:</span>{' '}
            <span className="tool-result-value">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Normalize escaped newlines (literal \n) to actual newlines
  let normalizedOutput = output;
  if (output.includes('\\n')) {
    normalizedOutput = output.replace(/\\n/g, '\n');
  }

  // Check for markdown code blocks (```language ... ```)
  const codeBlockRegex = /^```(\w+)?\n([\s\S]*?)\n```$/;
  const match = normalizedOutput.match(codeBlockRegex);
  if (match) {
    const language = match[1] || 'text';
    const code = match[2];
    return <CodeBlock language={language}>{code}</CodeBlock>;
  }

  // Plain text output (use normalized version so newlines display properly)
  return <pre className="tool-details-content" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{normalizedOutput}</pre>;
}

/**
 * Render tool result with special handling for images and audio.
 * files parameter is for files passed separately from result.
 */
function renderToolResult(result, files) {
  // Handle files passed as separate parameter (takes precedence)
  if (files && Array.isArray(files) && files.length > 0) {
    const imageFiles = files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:image/'));
    const audioFiles = files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:audio/'));
    const hasMediaFiles = imageFiles.length > 0 || audioFiles.length > 0;

    if (hasMediaFiles) {
      return (
        <div className="tool-result-with-media">
          {imageFiles.map((file, idx) => (
            <div key={`img-${idx}`} className="tool-result-image">
              {imageFiles.length > 1 && <div className="tool-result-image-label">{file.name}:</div>}
              <img src={file.dataUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
            </div>
          ))}
          {audioFiles.map((file, idx) => (
            <div key={`audio-${idx}`} className="tool-result-audio">
              {audioFiles.length > 1 && <div className="tool-result-audio-label">{file.name}:</div>}
              <AudioPlayer
                audioDataUrl={file.dataUrl}
                mimeType={file.mediaType}
              />
            </div>
          ))}
          {result && renderOutput(result)}
        </div>
      );
    }
  }

  if (!result) return <em>No output</em>;

  // If result is a string, try to parse it as JSON first
  let parsedResult = result;
  if (typeof result === 'string') {
    // Check if it's a direct image data URL
    if (isDataUrlImage(result)) {
      return (
        <div className="tool-result-image">
          <img src={result} alt="Tool result" style={{ maxWidth: '100%', maxHeight: '400px' }} />
        </div>
      );
    }

    // Try to parse as JSON (result might be stringified, possibly double-stringified)
    let trimmed = result.trim();
    // Handle double-stringified JSON (starts and ends with ")
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      let unwrapped = null;
      try {
        unwrapped = JSON.parse(trimmed);
      } catch {
        // Continue with original
      }
      if (unwrapped && typeof unwrapped === 'string') {
        trimmed = unwrapped.trim();
      }
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Not valid JSON
      }
      if (parsed === null) {
        return <pre className="tool-details-content">{result}</pre>;
      }
      parsedResult = parsed;
    } else {
      // Not JSON - check if it's a code block or plain text
      return renderOutput(trimmed);
    }
  }

  // If parsedResult is an object, check for special content types
  if (typeof parsedResult === 'object' && parsedResult !== null) {
    // Check for files array with dataUrl (from tools like run_python, speak, create_image)
    if (parsedResult.files && Array.isArray(parsedResult.files) && parsedResult.files.length > 0) {
      const imageFiles = parsedResult.files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:image/'));
      const audioFiles = parsedResult.files.filter(f => f.dataUrl && f.dataUrl.startsWith('data:audio/'));
      const hasMediaFiles = imageFiles.length > 0 || audioFiles.length > 0;

      if (hasMediaFiles) {
        return (
          <div className="tool-result-with-media">
            {imageFiles.map((file, idx) => (
              <div key={`img-${idx}`} className="tool-result-image">
                {imageFiles.length > 1 && <div className="tool-result-image-label">{file.name}:</div>}
                <img src={file.dataUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
              </div>
            ))}
            {audioFiles.map((file, idx) => (
              <div key={`audio-${idx}`} className="tool-result-audio">
                {audioFiles.length > 1 && <div className="tool-result-audio-label">{file.name}:</div>}
                <AudioPlayer
                  audioDataUrl={file.dataUrl}
                  mimeType={file.mediaType}
                />
              </div>
            ))}
            {parsedResult.output && (
              <div className="tool-result-output" style={{ marginTop: '0.5rem' }}>
                {renderOutput(parsedResult.output)}
              </div>
            )}
          </div>
        );
      }
    }

    // Check for audio result (any tool returning audio data)
    if (isAudioResult(parsedResult)) {
      const audioData = getAudioData(parsedResult);
      const nonAudioEntries = Object.entries(parsedResult).filter(
        ([key, value]) => {
          if (key === 'audio' || key === 'mimeType') return false;
          if (key === 'output' && typeof value === 'object' && value && 'audio' in value) return false;
          return true;
        }
      );

      return (
        <div className="tool-result-with-audio">
          <AudioPlayer
            audioBase64={audioData.audio}
            mimeType={audioData.mimeType || 'audio/pcm;rate=24000'}
          />
          {nonAudioEntries.length > 0 && (
            <div className="tool-result-properties">
              {nonAudioEntries.map(([key, value]) => (
                <div key={key} className="tool-result-property">
                  <span className="tool-result-key">{key}:</span>{' '}
                  <span className="tool-result-value">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Check for image data URLs
    const imageEntries = Object.entries(parsedResult).filter(
      ([, value]) => isDataUrlImage(value)
    );
    const hasImageData = imageEntries.length > 0;

    if (hasImageData) {
      const nonImageEntries = Object.entries(parsedResult).filter(
        ([, value]) => !isDataUrlImage(value)
      );

      return (
        <div className="tool-result-with-image">
          {imageEntries.map(([key, value]) => (
            <div key={key} className="tool-result-image">
              <div className="tool-result-image-label">{key}:</div>
              <img src={value} alt={key} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
            </div>
          ))}
          {nonImageEntries.map(([key, value]) => (
            <div key={key} className="tool-result-property">
              <span className="tool-result-key">{key}:</span>{' '}
              <span className="tool-result-value">
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // Check for output property (from tools like generate_python, run_python without files)
    if (parsedResult.output !== undefined) {
      return (
        <div className="tool-result-with-output">
          {renderOutput(parsedResult.output)}
          {parsedResult.error && (
            <div className="tool-result-error" style={{ marginTop: '0.5rem', color: '#ff6b6b' }}>
              <pre className="tool-details-content" style={{ margin: 0 }}>{parsedResult.error}</pre>
            </div>
          )}
        </div>
      );
    }
  }

  // Default: render as JSON
  return <pre className="tool-details-content">{JSON.stringify(parsedResult, null, 2)}</pre>;
}

/**
 * @typedef {Object} AgentChatMessageProps
 * @property {Object} msg - The message object
 * @property {Object} [options] - Rendering options
 * @property {boolean} [options.showToolDetails=true] - Show expandable tool details
 * @property {boolean} [options.showUsageStats=true] - Show token usage stats
 * @property {boolean} [options.showCitations=true] - Show citation panel
 * @property {Array} [options.agentTemplates] - Agent templates for collapse settings
 * @property {Set} [options.expandedTools] - Set of expanded tool IDs
 * @property {Set} [options.expandedAgentMessages] - Set of expanded agent message IDs
 * @property {Function} [options.onToggleToolExpand] - Callback: (toolId) => void
 * @property {Function} [options.onToggleAgentExpand] - Callback: (messageId) => void
 * @property {Function} [options.onTraceClick] - Callback: (traceId) => void
 */

export const AgentChatMessage = memo(function AgentChatMessage({ msg, options = {} }) {
  const {
    showToolDetails = true,
    showUsageStats = true,
    showCitations = true,
    agentTemplates = [],
    expandedTools = EMPTY_SET,
    expandedAgentMessages = EMPTY_SET,
    onToggleToolExpand,
    onToggleAgentExpand,
    onTraceClick,
  } = options;

  const handleToolClick = useCallback(() => {
    if (onToggleToolExpand) {
      onToggleToolExpand(msg.id);
    }
  }, [onToggleToolExpand, msg.id]);

  const handleAgentHeaderClick = useCallback(() => {
    if (onToggleAgentExpand) {
      onToggleAgentExpand(msg.id);
    }
  }, [onToggleAgentExpand, msg.id]);

  const handleTraceClick = useCallback(() => {
    if (onTraceClick && msg.usage?.traceId) {
      onTraceClick(msg.usage.traceId);
    }
  }, [onTraceClick, msg.usage]);

  // ============================================================================
  // Tool Event
  // ============================================================================

  if (msg.role === 'tool') {
    const isExpanded = expandedTools.has(msg.id);

    return (
      <div className={`tool-event-wrapper ${isExpanded ? 'expanded' : ''}`}>
        <div
          className={`tool-event ${msg.status}`}
          onClick={showToolDetails ? handleToolClick : undefined}
          style={showToolDetails ? { cursor: 'pointer' } : undefined}
        >
          <span className="tool-icon">
            {msg.source === 'mcp' ? '🔌' : msg.source === 'skill' ? '⚡' : '🔧'}
          </span>
          <span className="tool-status-indicator">
            {msg.status === 'running' ? '◐' : msg.status === 'completed' ? '✓' : '✗'}
          </span>
          <span className="tool-name">{msg.toolName}</span>
          {msg.parameters?.task && (
            <span className="tool-mission">{msg.parameters.task}</span>
          )}
          {msg.status === 'running' && msg.progress && (
            <span className="tool-progress">
              <span className="tool-progress-bar">
                <span
                  className="tool-progress-fill"
                  style={{
                    width: msg.progress.total
                      ? `${Math.min(100, (msg.progress.current / msg.progress.total) * 100)}%`
                      : '0%',
                  }}
                />
              </span>
              {msg.progress.message && (
                <span className="tool-progress-message">{msg.progress.message}</span>
              )}
            </span>
          )}
          {msg.durationMs !== undefined && (
            <span className="tool-duration">{msg.durationMs}ms</span>
          )}
          {showToolDetails && (
            <span className="tool-expand-icon">{isExpanded ? '▼' : '▶'}</span>
          )}
        </div>
        {showToolDetails && isExpanded && (
          <div className="tool-details">
            {(msg.agentName || msg.agentEmoji) && (
              <div className="tool-details-section">
                <div className="tool-details-label">Called By</div>
                <div className="tool-details-agent">
                  {msg.agentEmoji && <span className="tool-agent-emoji">{msg.agentEmoji}</span>}
                  {msg.agentName && <span className="tool-agent-name">{msg.agentName}</span>}
                </div>
              </div>
            )}
            {msg.parameters && Object.keys(msg.parameters).length > 0 && (
              <div className="tool-details-section">
                <div className="tool-details-label">Parameters</div>
                <pre className="tool-details-content">
                  {JSON.stringify(msg.parameters, null, 2)}
                </pre>
              </div>
            )}
            {(msg.result || msg.files) && (
              <div className="tool-details-section">
                <div className="tool-details-label">Response</div>
                {renderToolResult(msg.result, msg.files)}
              </div>
            )}
            {msg.error && (
              <div className="tool-details-section error">
                <div className="tool-details-label">Error</div>
                <pre className="tool-details-content">{msg.error}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // Delegation Event
  // ============================================================================

  if (msg.role === 'delegation') {
    const mission = msg.mission || '';
    const truncatedMission =
      mission.length > DELEGATION_MISSION_MAX_LENGTH
        ? mission.slice(0, DELEGATION_MISSION_MAX_LENGTH) + '...'
        : mission;

    return (
      <div className="delegation-event">
        <span className="delegation-icon">🎯</span>
        <span className="delegation-agent">
          {msg.agentEmoji} {msg.agentName}
        </span>
        <span className="delegation-mission" title={mission}>
          {truncatedMission}
        </span>
      </div>
    );
  }

  // ============================================================================
  // Task Run Event
  // ============================================================================

  if (msg.role === 'task_run') {
    return (
      <div className="task-run-event">
        <span className="task-run-icon">📋</span>
        <span className="task-run-label">Running Task</span>
        <span className="task-run-name">{msg.taskName}</span>
        {msg.taskDescription && (
          <span className="task-run-description">{msg.taskDescription}</span>
        )}
      </div>
    );
  }

  // ============================================================================
  // Collapsible Agent Message
  // ============================================================================

  if (shouldCollapseByDefault(msg.agentType, msg.agentName, agentTemplates)) {
    const isExpanded = expandedAgentMessages.has(msg.id);

    return (
      <div className={`collapsible-agent-message ${isExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="collapsible-agent-header" onClick={handleAgentHeaderClick}>
          <span className="collapsible-agent-icon">{msg.agentEmoji || '📚'}</span>
          <span className="collapsible-agent-name">{msg.agentName || 'Agent'}</span>
          <span className="collapsible-agent-preview">
            {msg.content
              ? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')
              : 'Processing...'}
          </span>
          <span className="collapsible-agent-expand-icon">{isExpanded ? '▼' : '▶'}</span>
        </div>
        {isExpanded && (
          <MessageBody
            msg={msg}
            showUsageStats={showUsageStats}
            showCitations={showCitations}
            onTraceClick={onTraceClick ? handleTraceClick : undefined}
          />
        )}
      </div>
    );
  }

  // ============================================================================
  // Standard Message (User or Assistant)
  // ============================================================================

  return (
    <MessageBody
      msg={msg}
      showUsageStats={showUsageStats}
      showCitations={showCitations}
      onTraceClick={onTraceClick ? handleTraceClick : undefined}
    />
  );
});

/**
 * MessageBody — renders the actual message content (used by both standard and collapsible).
 */
const MessageBody = memo(function MessageBody({ msg, showUsageStats, showCitations, onTraceClick }) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';

  return (
    <div
      className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}
    >
      <div className="message-avatar">
        {msg.isError ? '⚠️' : isUser ? '👤' : msg.agentEmoji || DEFAULT_AGENT_ICON}
      </div>
      <div className="message-content">
        {msg.agentName && isAssistant && <div className="agent-name">{msg.agentName}</div>}
        <MessageContent
          content={msg.content}
          html={msg.html}
          isStreaming={msg.isStreaming}
          citations={msg.citations}
          messageId={msg.id}
        />
        {showCitations && isAssistant && msg.citations && !msg.isStreaming && (
          <CitationPanel citations={msg.citations} messageId={msg.id} />
        )}
        {showUsageStats && isAssistant && msg.usage && !msg.isStreaming && (
          <div className="message-usage-footer">
            {formatTokenCount(msg.usage.inputTokens)} in / {formatTokenCount(msg.usage.outputTokens)}{' '}
            out ·{' '}
            {msg.usage.llmDurationMs > 0
              ? Math.round(msg.usage.outputTokens / (msg.usage.llmDurationMs / 1000))
              : '?'}{' '}
            tok/s · {(msg.usage.llmDurationMs / 1000).toFixed(1)}s
            {msg.usage.modelId ? ` · ${msg.usage.modelId}` : ''}
            {msg.usage.traceId && onTraceClick && (
              <button
                type="button"
                className="trace-link"
                onClick={onTraceClick}
                title="View trace details"
                aria-label="View trace details"
              >
                📋
              </button>
            )}
          </div>
        )}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="message-attachments">
            {msg.attachments.map((att, attIndex) => (
              <div key={attIndex} className="message-attachment-chip">
                <span className="attachment-icon">
                  {att.type?.startsWith('image/') ? '🖼️' : '📎'}
                </span>
                <span className="attachment-name" title={att.name}>
                  {att.name?.length > 25 ? att.name.slice(0, 22) + '...' : att.name}
                </span>
                {att.size && (
                  <span className="attachment-size">
                    {att.size < 1024
                      ? `${att.size}B`
                      : att.size < 1024 * 1024
                        ? `${(att.size / 1024).toFixed(1)}KB`
                        : `${(att.size / (1024 * 1024)).toFixed(1)}MB`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {msg.agentCommand && (
          <div className="message-reasoning-chip message-command-chip">
            <span className="reasoning-chip-icon">{msg.agentCommand.icon}</span>
            <span className="reasoning-chip-label">{msg.agentCommand.command}</span>
          </div>
        )}
        {msg.messageType && !msg.agentCommand && (
          <div className="message-reasoning-chip message-type-chip">
            <span className="reasoning-chip-icon">🔬</span>
            <span className="reasoning-chip-label">
              {msg.messageType === 'deep_research' ? 'Deep Research' : msg.messageType}
            </span>
          </div>
        )}
        {msg.reasoningMode && (
          <div className="message-reasoning-chip">
            <span className="reasoning-chip-icon">🧠</span>
            <span className="reasoning-chip-label">
              {msg.reasoningMode === 'xhigh' ? 'Think+' : 'Think'}
            </span>
          </div>
        )}
        {msg.isStreaming && !msg.content && (
          <span className="typing-indicator">
            <span className="dot"></span>
            <span className="dot"></span>
            <span className="dot"></span>
          </span>
        )}
        {msg.isStreaming && msg.content && (
          <span className="streaming-cursor"></span>
        )}
        {msg.buttons && msg.buttons.length > 0 && (
          <div className="message-buttons">
            {msg.buttons.map((btn, i) => (
              <button
                key={i}
                type="button"
                className="message-button"
                onClick={() => {
                  if (btn.action === 'link' && btn.url) {
                    window.open(btn.url, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
