/**
 * useVoiceToText — hook for voice-to-text using OpenAI's Realtime API via WebSocket proxy.
 *
 * This is a standalone copy for AgentChat. The original lives at hooks/useVoiceToText.js.
 * TODO: Refactor to share code after AgentChat integration is complete.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export function useVoiceToText({ onTranscript, onFinalTranscript, onError } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isWsConnected, setIsWsConnected] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const sessionReadyRef = useRef(false);
  const audioBufferRef = useRef([]);
  const pendingStopRef = useRef(false);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(2000);
  const workletLoadedRef = useRef(false);
  const pendingAutoSubmitRef = useRef(false);
  const transcriptDebounceRef = useRef(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onFinalTranscript, onTranscript, onError]);

  const cleanupAudio = useCallback(() => {
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;

    if (processorRef.current) {
      processorRef.current.port.onmessage = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      workletLoadedRef.current = false;
    }
  }, []);

  const getWsUrl = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//localhost:3000/voice`;
  }, []);

  const handleWsMessage = useCallback((event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error('[Voice] Failed to parse message:', e);
      return;
    }

    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
      case 'session.ready': {
        sessionReadyRef.current = true;

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const audioMsg of audioBufferRef.current) {
            ws.send(audioMsg);
          }
        }
        audioBufferRef.current = [];

        if (pendingStopRef.current) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            ws.send(JSON.stringify({ type: 'voice.stop' }));
          }
          cleanupAudio();
          setIsRecording(false);
          setIsConnecting(false);
          setIsFlushing(false);
          pendingStopRef.current = false;

          if (accumulatedTranscriptRef.current.trim()) {
            if (transcriptDebounceRef.current) {
              clearTimeout(transcriptDebounceRef.current);
            }
            transcriptDebounceRef.current = setTimeout(() => {
              transcriptDebounceRef.current = null;
              if (pendingAutoSubmitRef.current) {
                pendingAutoSubmitRef.current = false;
                onFinalTranscriptRef.current?.();
              }
            }, 800);
          }
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (msg.transcript) {
          const separator = accumulatedTranscriptRef.current ? ' ' : '';
          const newTranscript = accumulatedTranscriptRef.current + separator + msg.transcript;
          accumulatedTranscriptRef.current = newTranscript;
          setTranscript(newTranscript);
          onTranscriptRef.current?.(newTranscript);

          if (pendingAutoSubmitRef.current) {
            if (transcriptDebounceRef.current) {
              clearTimeout(transcriptDebounceRef.current);
            }
            transcriptDebounceRef.current = setTimeout(() => {
              transcriptDebounceRef.current = null;
              if (pendingAutoSubmitRef.current) {
                pendingAutoSubmitRef.current = false;
                onFinalTranscriptRef.current?.();
              }
            }, 800);
          }
        }
        break;
      }

      case 'response.audio_transcript.delta': {
        if (msg.delta) {
          const newTranscript = accumulatedTranscriptRef.current + msg.delta;
          setTranscript(newTranscript);
          onTranscriptRef.current?.(newTranscript);

          if (pendingAutoSubmitRef.current) {
            if (transcriptDebounceRef.current) {
              clearTimeout(transcriptDebounceRef.current);
            }
            transcriptDebounceRef.current = setTimeout(() => {
              transcriptDebounceRef.current = null;
              if (pendingAutoSubmitRef.current) {
                pendingAutoSubmitRef.current = false;
                onFinalTranscriptRef.current?.();
              }
            }, 800);
          }
        }
        break;
      }

      case 'response.audio_transcript.done': {
        if (msg.transcript) {
          accumulatedTranscriptRef.current = msg.transcript;
          setTranscript(msg.transcript);
          onTranscriptRef.current?.(msg.transcript);

          if (pendingAutoSubmitRef.current) {
            if (transcriptDebounceRef.current) {
              clearTimeout(transcriptDebounceRef.current);
            }
            transcriptDebounceRef.current = setTimeout(() => {
              transcriptDebounceRef.current = null;
              if (pendingAutoSubmitRef.current) {
                pendingAutoSubmitRef.current = false;
                onFinalTranscriptRef.current?.();
              }
            }, 800);
          }
        }
        break;
      }

      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
        break;

      case 'error': {
        console.error('[Voice] Error:', msg.error);
        const errorMsg = (msg.error && msg.error.message) ? msg.error.message : 'Voice error';
        onErrorRef.current?.(errorMsg);
        break;
      }
    }
  }, [cleanupAudio]);

  const voiceModeActiveRef = useRef(false);
  const mountedRef = useRef(true);
  const connectRef = useRef(null);

  const MAX_RECONNECT_ATTEMPTS = 10;
  const INITIAL_RECONNECT_DELAY = 2000;
  const MAX_RECONNECT_DELAY = 30000;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (!voiceModeActiveRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = getWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      if (mountedRef.current) setIsWsConnected(true);
    };

    ws.onmessage = handleWsMessage;

    ws.onerror = (error) => {
      console.error('[Voice] WebSocket error:', error);
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        setIsWsConnected(false);
        wsRef.current = null;

        if (!voiceModeActiveRef.current) {
          return;
        }

        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          console.warn('[Voice] Max reconnection attempts reached.');
          onErrorRef.current?.('Voice service unavailable. Please check server configuration.');
          return;
        }

        const delay = Math.min(
          reconnectDelayRef.current * (1 + Math.random() * 0.3),
          MAX_RECONNECT_DELAY
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY);
          connectRef.current?.();
        }, delay);
      }
    };
  }, [getWsUrl, handleWsMessage]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      voiceModeActiveRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const activateVoiceMode = useCallback(() => {
    if (voiceModeActiveRef.current) return;
    voiceModeActiveRef.current = true;
    reconnectAttemptsRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    connect();
  }, [connect]);

  const deactivateVoiceMode = useCallback(() => {
    if (!voiceModeActiveRef.current) return;
    voiceModeActiveRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setIsWsConnected(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startAudioCapture = useCallback(async (audioContext, stream) => {
    if (!workletLoadedRef.current) {
      try {
        await audioContext.audioWorklet.addModule('/src/worklets/pcm-processor.js');
        workletLoadedRef.current = true;
      } catch (error) {
        console.error('[Voice] Failed to load AudioWorklet processor:', error);
        onErrorRef.current?.('Failed to initialize audio processor');
        return;
      }
    }

    const source = audioContext.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(audioContext, 'pcm-processor');

    sourceRef.current = source;
    processorRef.current = processor;

    processor.port.onmessage = (event) => {
      if (!processorRef.current) return;

      const pcm16Buffer = event.data;

      const bytes = new Uint8Array(pcm16Buffer);
      const base64 = btoa(
        Array.from(bytes, byte => String.fromCharCode(byte)).join('')
      );

      const audioMessage = JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      });

      const ws = wsRef.current;
      if (sessionReadyRef.current && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(audioMessage);
      } else {
        audioBufferRef.current.push(audioMessage);
      }
    };

    source.connect(processor);
  }, []);

  const prepareRecording = useCallback(async () => {
    activateVoiceMode();

    await new Promise(resolve => setTimeout(resolve, 100));

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'voice.prepare' }));
    }

    if (!streamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
      } catch (error) {
        console.error('[Voice] Failed to pre-acquire microphone:', error);
      }
    }
  }, [activateVoiceMode]);

  const startRecording = useCallback(async () => {
    if (isRecording || isConnecting) return;

    setTranscript('');
    setIsFlushing(false);
    accumulatedTranscriptRef.current = '';
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;
    pendingAutoSubmitRef.current = false;
    if (transcriptDebounceRef.current) {
      clearTimeout(transcriptDebounceRef.current);
      transcriptDebounceRef.current = null;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onErrorRef.current?.('Voice connection not ready');
      return;
    }

    try {
      let stream = streamRef.current;
      if (!stream) {
        setIsConnecting(true);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
        setIsConnecting(false);
      }

      setIsRecording(true);

      wsRef.current.send(JSON.stringify({ type: 'voice.start' }));

      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      await startAudioCapture(audioContext, stream);

    } catch (error) {
      console.error('[Voice] Failed to start recording:', error);
      onErrorRef.current?.(error.message || 'Failed to access microphone');
      cleanupAudio();
      setIsConnecting(false);
      setIsRecording(false);
    }
  }, [isRecording, isConnecting, cleanupAudio, startAudioCapture]);

  const stopRecording = useCallback(() => {
    if (!isRecording && !isConnecting) return;

    if (!sessionReadyRef.current) {
      pendingStopRef.current = true;
      pendingAutoSubmitRef.current = true;
      setIsFlushing(true);
      setIsRecording(false);
      return;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'voice.stop' }));
    }

    cleanupAudio();
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);

    pendingAutoSubmitRef.current = true;

    if (accumulatedTranscriptRef.current.trim()) {
      if (transcriptDebounceRef.current) {
        clearTimeout(transcriptDebounceRef.current);
      }
      transcriptDebounceRef.current = setTimeout(() => {
        transcriptDebounceRef.current = null;
        if (pendingAutoSubmitRef.current) {
          pendingAutoSubmitRef.current = false;
          onFinalTranscriptRef.current?.();
        }
      }, 800);
    }

  }, [isRecording, isConnecting, cleanupAudio]);

  const releaseRecording = useCallback(() => {
    cleanupAudio();
    deactivateVoiceMode();
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);
  }, [cleanupAudio, deactivateVoiceMode]);

  return {
    isRecording,
    isConnecting,
    isFlushing,
    isWsConnected,
    startRecording,
    stopRecording,
    prepareRecording,
    releaseRecording,
    activateVoiceMode,
    deactivateVoiceMode,
    transcript,
  };
}
