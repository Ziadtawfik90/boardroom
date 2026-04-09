import { useEffect, useRef, useState, useCallback } from 'react';
import { ws } from '../lib/ws';
import type { WsEnvelope, WsMessageType } from '../types';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    ws.connect();

    const offConnected = ws.on('_connected', () => setConnected(true));
    const offDisconnected = ws.on('_disconnected', () => setConnected(false));

    return () => {
      offConnected();
      offDisconnected();
      ws.disconnect();
    };
  }, []);

  const send = useCallback((type: WsMessageType, payload: unknown) => {
    ws.send(type, payload);
  }, []);

  const subscribe = useCallback((type: string, handler: (envelope: WsEnvelope) => void) => {
    const off = ws.on(type, handler);
    listenersRef.current.push(off);
    return off;
  }, []);

  useEffect(() => {
    return () => {
      listenersRef.current.forEach((off) => off());
      listenersRef.current = [];
    };
  }, []);

  return { connected, send, subscribe };
}
