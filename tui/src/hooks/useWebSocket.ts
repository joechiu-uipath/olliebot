import { useState, useEffect, useCallback, useRef } from 'react';
import WebSocket from 'ws';
import type { WsMessage } from '../types.js';

interface UseWebSocketOptions {
  url: string;
  onMessage: (data: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export function useWebSocket({ url, onMessage, onOpen, onClose, onError }: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
  }, [onMessage, onOpen, onClose, onError]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.removeAllListeners();
      wsRef.current.close();
    }

    try {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        setIsConnected(true);
        onOpenRef.current?.();
      });

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as WsMessage;
          onMessageRef.current(parsed);
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('close', () => {
        setIsConnected(false);
        onCloseRef.current?.();
        // Reconnect after 2 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      });

      ws.on('error', (error) => {
        // Don't log connection refused errors during reconnect attempts
        onErrorRef.current?.(error as Error);
      });

      wsRef.current = ws;
    } catch (error) {
      onErrorRef.current?.(error as Error);
      // Retry connection
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 2000);
    }
  }, [url]); // Only depend on url

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.removeAllListeners();
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    sendMessage,
    disconnect,
    reconnect: connect,
  };
}
