import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for voice-to-text using OpenAI's Realtime API via WebSocket proxy.
 * Keeps WebSocket connection alive for low-latency voice input.
 */
export function useVoiceToText({ onTranscript, onFinalTranscript, onError } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isWsConnected, setIsWsConnected] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const sessionReadyRef = useRef(false);
  const audioBufferRef = useRef([]);
  const pendingStopRef = useRef(false);
  const reconnectTimeoutRef = useRef(null);

  // Callback refs to avoid stale closures
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onFinalTranscript, onTranscript, onError]);

  // Cleanup audio processing resources (keep mic stream alive for fast re-recording)
  const cleanupAudio = useCallback(() => {
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // Keep streamRef.current alive for fast subsequent recordings
  }, []);

  // Compute WebSocket URL (use same origin - Vite proxies /voice to backend)
  const getWsUrl = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/voice`;
  }, []);

  // Handle incoming WebSocket messages
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
        console.log('[Voice] Session ready, flushing', audioBufferRef.current.length, 'buffered audio chunks');
        sessionReadyRef.current = true;

        // Flush buffered audio
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const audioMsg of audioBufferRef.current) {
            ws.send(audioMsg);
          }
        }
        audioBufferRef.current = [];

        // If user already released button, complete the stop now
        if (pendingStopRef.current) {
          console.log('[Voice] Completing pending stop after flush');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            ws.send(JSON.stringify({ type: 'voice.stop' }));
          }
          const finalTranscript = accumulatedTranscriptRef.current;
          cleanupAudio();
          setIsRecording(false);
          setIsConnecting(false);
          setIsFlushing(false);
          pendingStopRef.current = false;
          onFinalTranscriptRef.current?.(finalTranscript);
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
        }
        break;
      }

      case 'response.audio_transcript.delta': {
        if (msg.delta) {
          const newTranscript = accumulatedTranscriptRef.current + msg.delta;
          setTranscript(newTranscript);
          onTranscriptRef.current?.(newTranscript);
        }
        break;
      }

      case 'response.audio_transcript.done': {
        if (msg.transcript) {
          accumulatedTranscriptRef.current = msg.transcript;
          setTranscript(msg.transcript);
          onTranscriptRef.current?.(msg.transcript);
        }
        break;
      }

      case 'input_audio_buffer.speech_started':
        console.log('[Voice] Speech started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Voice] Speech stopped');
        break;

      case 'error': {
        console.error('[Voice] Error:', msg.error);
        const errorMsg = (msg.error && msg.error.message) ? msg.error.message : 'Voice error';
        onErrorRef.current?.(errorMsg);
        break;
      }
    }
  }, [cleanupAudio]);

  // Connect WebSocket on mount, reconnect on close
  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

      const wsUrl = getWsUrl();
      console.log('[Voice] Connecting to backend:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Voice] Backend WebSocket connected');
        if (mounted) setIsWsConnected(true);
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (error) => {
        console.error('[Voice] WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('[Voice] Backend WebSocket closed');
        if (mounted) {
          setIsWsConnected(false);
          wsRef.current = null;
          // Reconnect after a delay
          reconnectTimeoutRef.current = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      // Release microphone on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [getWsUrl, handleWsMessage]);

  // Audio capture helper
  const startAudioCapture = useCallback((audioContext, stream) => {
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Convert to base64
      const base64 = btoa(
        String.fromCharCode.apply(null, new Uint8Array(pcm16.buffer))
      );

      const audioMessage = JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      });

      // Buffer audio until session is ready, then send directly
      const ws = wsRef.current;
      if (sessionReadyRef.current && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(audioMessage);
      } else {
        audioBufferRef.current.push(audioMessage);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, []);

  // Pre-acquire microphone and prepare upstream connection (call on hover)
  const prepareRecording = useCallback(async () => {
    // Pre-connect upstream
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[Voice] Sending prepare signal');
      ws.send(JSON.stringify({ type: 'voice.prepare' }));
    }

    // Pre-acquire microphone (if not already acquired)
    if (!streamRef.current) {
      try {
        console.log('[Voice] Pre-acquiring microphone...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
        console.log('[Voice] Microphone pre-acquired');
      } catch (error) {
        console.error('[Voice] Failed to pre-acquire microphone:', error);
      }
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (isRecording || isConnecting) return;

    setTranscript('');
    accumulatedTranscriptRef.current = '';
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;

    // Ensure WebSocket is connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[Voice] WebSocket not connected');
      onErrorRef.current?.('Voice connection not ready');
      return;
    }

    try {
      // Use pre-acquired stream or request new one
      let stream = streamRef.current;
      if (!stream) {
        setIsConnecting(true);
        console.log('[Voice] Acquiring microphone (not pre-acquired)...');
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

      // Show "Listening..." immediately (stream is ready)
      setIsRecording(true);

      // Send start signal to trigger upstream connection
      wsRef.current.send(JSON.stringify({ type: 'voice.start' }));

      // Create audio context and start capturing
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      startAudioCapture(audioContext, stream);

    } catch (error) {
      console.error('[Voice] Failed to start recording:', error);
      onErrorRef.current?.(error.message || 'Failed to access microphone');
      cleanupAudio();
      setIsConnecting(false);
      setIsRecording(false);
    }
  }, [isRecording, isConnecting, cleanupAudio, startAudioCapture]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording && !isConnecting) return;

    // If session not ready yet, mark pending stop and wait for flush
    if (!sessionReadyRef.current) {
      console.log('[Voice] Session not ready, marking pending stop');
      pendingStopRef.current = true;
      setIsFlushing(true);
      setIsRecording(false);
      return;
    }

    // Session is ready, do immediate stop
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'voice.stop' }));
    }

    const finalTranscript = accumulatedTranscriptRef.current;

    cleanupAudio();
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);

    onFinalTranscriptRef.current?.(finalTranscript);

    return finalTranscript;
  }, [isRecording, isConnecting, cleanupAudio]);

  // Release microphone and cleanup (call when turning voice mode OFF)
  const releaseRecording = useCallback(() => {
    console.log('[Voice] Releasing microphone');
    cleanupAudio();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);
  }, [cleanupAudio]);

  return {
    isRecording,
    isConnecting,
    isFlushing,
    isWsConnected,
    startRecording,
    stopRecording,
    prepareRecording,
    releaseRecording,
    transcript,
  };
}
