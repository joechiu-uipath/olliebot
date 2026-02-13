/**
 * AgentChatInput — standalone input component for AgentChat.
 *
 * This is a copy of ChatInput for AgentChat to be fully standalone.
 * TODO: Refactor to share code after AgentChat integration is complete.
 *
 * Features:
 * - Text input with multi-line support
 * - File attachments (drag-drop, paste, click)
 * - Voice-to-text (push-to-talk)
 * - Hashtag menu for reasoning modes and agent commands
 * - Reasoning mode chips (Think, Think+)
 * - Agent command chips
 */

import { useState, useRef, useEffect, useImperativeHandle, memo, useCallback, forwardRef } from 'react';
import { useVoiceToText } from './useVoiceToText';

export const AgentChatInput = memo(forwardRef(function AgentChatInput({
  onSubmit,
  onInputChange,
  onKeyDown: parentKeyDown,
  onPaste,
  attachments,
  onRemoveAttachment,
  isConnected = true,
  isResponsePending,
  reasoningMode,
  messageType,
  onReasoningModeChange,
  onMessageTypeChange,
  modelCapabilities,
  commandTriggers = [],
  agentCommand,
  onAgentCommandChange,
}, ref) {
  const [input, setInput] = useState('');
  const [hashtagMenuOpen, setHashtagMenuOpen] = useState(false);
  const [hashtagMenuPosition, setHashtagMenuPosition] = useState({ top: 0, left: 0 });
  const [hashtagMenuIndex, setHashtagMenuIndex] = useState(0);
  const [voiceAutoSubmit, setVoiceAutoSubmit] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [voiceInputWasEmpty, setVoiceInputWasEmpty] = useState(false);
  const [voiceModeOn, setVoiceModeOn] = useState(false);
  const textareaRef = useRef(null);

  // Voice-to-text hook
  const {
    isRecording,
    isConnecting,
    isFlushing,
    isWsConnected,
    startRecording,
    stopRecording,
    prepareRecording,
    releaseRecording,
  } = useVoiceToText({
    onTranscript: useCallback((text) => {
      setInput(text);
      if (onInputChange) {
        onInputChange(text);
      }
    }, [onInputChange]),
    onFinalTranscript: useCallback(() => {
      setVoiceAutoSubmit(true);
    }, []),
    onError: useCallback((error) => {
      setVoiceError(error);
      setTimeout(() => setVoiceError(null), 3000);
    }, []),
  });

  const voiceSubmitTimerRef = useRef(null);

  // Handle auto-submit after voice recording
  useEffect(() => {
    if (voiceAutoSubmit && !isRecording && !isConnecting) {
      setVoiceAutoSubmit(false);
      setVoiceInputWasEmpty(false);

      if (voiceSubmitTimerRef.current) {
        clearTimeout(voiceSubmitTimerRef.current);
      }

      voiceSubmitTimerRef.current = setTimeout(() => {
        voiceSubmitTimerRef.current = null;
        const currentInput = textareaRef.current?.value || '';
        if (currentInput.trim()) {
          onSubmit(currentInput);
          setInput('');
        }
      }, 500);
    }
  }, [voiceAutoSubmit, isRecording, isConnecting, onSubmit]);

  useEffect(() => {
    return () => {
      if (voiceSubmitTimerRef.current) {
        clearTimeout(voiceSubmitTimerRef.current);
      }
    };
  }, []);

  const handleVoiceToggle = useCallback(async () => {
    if (voiceModeOn) {
      releaseRecording();
      setVoiceModeOn(false);
    } else {
      setVoiceModeOn(true);
      await prepareRecording();
      setTimeout(() => {
        if (!isRecording && !isConnecting && !isFlushing && isConnected && !isResponsePending && !input.trim()) {
          setVoiceInputWasEmpty(true);
          startRecording();
        }
      }, 200);
    }
  }, [voiceModeOn, releaseRecording, prepareRecording, isRecording, isConnecting, isFlushing, isConnected, isResponsePending, input, startRecording]);

  const handleVoiceMouseEnter = useCallback(() => {
    if (!voiceModeOn) return;
    if (isRecording || isConnecting || !isConnected || !isWsConnected || isResponsePending || input.trim()) return;

    setVoiceInputWasEmpty(true);
    startRecording();
  }, [voiceModeOn, isRecording, isConnecting, isConnected, isWsConnected, isResponsePending, input, startRecording]);

  const handleVoiceMouseLeave = useCallback(() => {
    if (isRecording || isConnecting) {
      stopRecording();
    }
  }, [isRecording, isConnecting, stopRecording]);

  useImperativeHandle(ref, () => ({
    clear: () => setInput(''),
    focus: () => textareaRef.current?.focus(),
    getValue: () => input,
  }));

  // Build hashtag menu options
  const hashtagMenuOptions = [];

  if (modelCapabilities && modelCapabilities.reasoningEfforts) {
    for (let i = 0; i < modelCapabilities.reasoningEfforts.length; i++) {
      const effort = modelCapabilities.reasoningEfforts[i];
      if (effort === 'high') {
        hashtagMenuOptions.push({
          id: 'high',
          type: 'reasoning',
          label: 'Think',
          icon: '🧠',
          desc: 'Extended thinking mode',
        });
      } else if (effort === 'xhigh') {
        hashtagMenuOptions.push({
          id: 'xhigh',
          type: 'reasoning',
          label: 'Think+',
          icon: '🧠',
          desc: 'Maximum thinking depth',
        });
      }
    }
  }

  for (let i = 0; i < commandTriggers.length; i++) {
    const trigger = commandTriggers[i];
    hashtagMenuOptions.push({
      id: trigger.command,
      type: 'agent_command',
      label: trigger.command,
      icon: trigger.agentEmoji,
      desc: trigger.description,
      agentType: trigger.agentType,
    });
  }

  const handleLocalInputChange = (e) => {
    const newValue = e.target.value;
    setInput(newValue);

    if (onInputChange) {
      onInputChange(newValue);
    }

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');

    if (lastHashIndex !== -1) {
      const textAfterHash = textBeforeCursor.slice(lastHashIndex + 1);
      const charBeforeHash = lastHashIndex > 0 ? textBeforeCursor[lastHashIndex - 1] : ' ';
      if ((charBeforeHash === ' ' || charBeforeHash === '\n' || lastHashIndex === 0) && !textAfterHash.includes(' ')) {
        const textarea = textareaRef.current;
        if (textarea) {
          const rect = textarea.getBoundingClientRect();
          setHashtagMenuPosition({
            top: rect.top - 8,
            left: rect.left,
          });
        }
        setHashtagMenuOpen(true);
        setHashtagMenuIndex(0);
        return;
      }
    }
    setHashtagMenuOpen(false);
  };

  const handleHashtagMenuSelect = (option) => {
    const cursorPos = textareaRef.current ? textareaRef.current.selectionStart : input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');

    if (lastHashIndex !== -1) {
      const newInput = input.slice(0, lastHashIndex) + input.slice(cursorPos);
      setInput(newInput);
    }

    if (option.type === 'agent_command') {
      onAgentCommandChange({ command: option.label, icon: option.icon });
      onReasoningModeChange(null);
      onMessageTypeChange(null);
    } else if (option.type === 'message_type') {
      onAgentCommandChange(null);
      onReasoningModeChange(null);
      onMessageTypeChange(option.id);
    } else if (option.type === 'reasoning') {
      onAgentCommandChange(null);
      onMessageTypeChange(null);
      onReasoningModeChange(option.id);
    }

    setHashtagMenuOpen(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleLocalKeyDown = (e) => {
    if (hashtagMenuOpen && hashtagMenuOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHashtagMenuIndex((prev) => (prev + 1) % hashtagMenuOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHashtagMenuIndex((prev) => (prev - 1 + hashtagMenuOptions.length) % hashtagMenuOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleHashtagMenuSelect(hashtagMenuOptions[hashtagMenuIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setHashtagMenuOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() || attachments.length > 0) {
        handleLocalSubmit(e);
      }
      return;
    }

    if (parentKeyDown) {
      parentKeyDown(e);
    }
  };

  const handleLocalSubmit = (e) => {
    if (e) e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    if (!isConnected || isResponsePending) return;

    onSubmit(input);
    setInput('');
    setHashtagMenuOpen(false);
  };

  return (
    <form className="agent-chat-input-form" onSubmit={handleLocalSubmit}>
      <div className="agent-chat-input-wrapper">
        {/* Chips bar */}
        {(attachments.length > 0 || reasoningMode || messageType || agentCommand) && (
          <div className="agent-chat-attachments-bar">
            {attachments.map((attachment, index) => (
              <div key={index} className="agent-chat-attachment-chip">
                <span className="agent-chat-attachment-icon">
                  {attachment.type.startsWith('image/') ? '🖼️' : '📎'}
                </span>
                <span className="agent-chat-attachment-name">{attachment.name}</span>
                <button
                  type="button"
                  className="agent-chat-attachment-remove"
                  onClick={() => onRemoveAttachment(index)}
                >
                  ×
                </button>
              </div>
            ))}

            {agentCommand && (
              <div className="agent-chat-hashtag-chip agent-chat-hashtag-chip-command">
                <span className="agent-chat-hashtag-chip-icon">{agentCommand.icon}</span>
                <span className="agent-chat-hashtag-chip-label">{agentCommand.command}</span>
                <button
                  type="button"
                  className="agent-chat-hashtag-chip-remove"
                  onClick={() => onAgentCommandChange(null)}
                  title="Remove command"
                >
                  ×
                </button>
              </div>
            )}

            {messageType && !agentCommand && (
              <div className="agent-chat-hashtag-chip agent-chat-hashtag-chip-research">
                <span className="agent-chat-hashtag-chip-icon">🔬</span>
                <span className="agent-chat-hashtag-chip-label">
                  {messageType === 'deep_research' ? 'Deep Research' : messageType}
                </span>
                <button
                  type="button"
                  className="agent-chat-hashtag-chip-remove"
                  onClick={() => onMessageTypeChange(null)}
                  title="Remove message type"
                >
                  ×
                </button>
              </div>
            )}

            {reasoningMode && (
              <div className="agent-chat-hashtag-chip">
                <span className="agent-chat-hashtag-chip-icon">🧠</span>
                <span className="agent-chat-hashtag-chip-label">
                  {reasoningMode === 'xhigh' ? 'Think+' : 'Think'}
                </span>
                <button
                  type="button"
                  className="agent-chat-hashtag-chip-remove"
                  onClick={() => onReasoningModeChange(null)}
                  title="Remove reasoning mode"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* Hashtag context menu */}
        {hashtagMenuOpen && hashtagMenuOptions.length > 0 && (
          <div
            className="agent-chat-hashtag-menu"
            style={{ top: hashtagMenuPosition.top, left: hashtagMenuPosition.left }}
          >
            {hashtagMenuOptions.map((option, index) => (
              <button
                key={option.id}
                type="button"
                className={`agent-chat-hashtag-menu-item ${hashtagMenuIndex === index ? 'selected' : ''}`}
                onClick={() => handleHashtagMenuSelect(option)}
                onMouseEnter={() => setHashtagMenuIndex(index)}
              >
                <span>{option.icon} {option.label}</span>
                <span className="agent-chat-hashtag-menu-item-desc">{option.desc}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleLocalInputChange}
          onKeyDown={handleLocalKeyDown}
          onPaste={onPaste}
          placeholder={
            isRecording
              ? "Listening..."
              : isConnecting
              ? "Connecting..."
              : !isConnected
              ? "Connecting to server..."
              : isResponsePending
              ? "Waiting for response..."
              : "Type a message... (Shift + Enter for new line)"
          }
          disabled={isResponsePending}
          readOnly={isRecording && voiceInputWasEmpty}
          rows={3}
          autoFocus
        />
        {voiceError && (
          <div className="agent-chat-voice-error">{voiceError}</div>
        )}
      </div>
      <div className="agent-chat-button-stack">
        <button
          type="button"
          className={`agent-chat-voice-button ${voiceModeOn ? 'voice-on' : ''} ${isRecording ? 'recording' : ''} ${isConnecting ? 'connecting' : ''}`}
          onClick={handleVoiceToggle}
          onMouseEnter={handleVoiceMouseEnter}
          onMouseLeave={handleVoiceMouseLeave}
          disabled={!isConnected || isResponsePending || isFlushing || (voiceModeOn && !isWsConnected)}
          title={voiceModeOn ? "Voice ON - hover to talk, click to turn OFF" : "Click to enable voice mode"}
        >
          {isConnecting ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="32">
                <animate attributeName="stroke-dashoffset" dur="1s" repeatCount="indefinite" values="32;0" />
              </circle>
            </svg>
          ) : isRecording ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6">
                <animate attributeName="r" dur="0.8s" repeatCount="indefinite" values="6;8;6" />
              </circle>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
        <button type="submit" disabled={!isConnected || isResponsePending || (!input.trim() && attachments.length === 0)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </form>
  );
}), (prevProps, nextProps) => {
  return (
    prevProps.attachments === nextProps.attachments &&
    prevProps.isConnected === nextProps.isConnected &&
    prevProps.isResponsePending === nextProps.isResponsePending &&
    prevProps.reasoningMode === nextProps.reasoningMode &&
    prevProps.messageType === nextProps.messageType &&
    prevProps.modelCapabilities === nextProps.modelCapabilities &&
    prevProps.commandTriggers === nextProps.commandTriggers &&
    prevProps.agentCommand === nextProps.agentCommand
  );
});
