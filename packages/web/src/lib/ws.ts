import { getToken } from './auth';
import type { WsEnvelope, WsMessageType } from '../types';

type WsListener = (envelope: WsEnvelope) => void;

export class BoardroomWs {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<WsListener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private intentionallyClosed = false;

  connect(): void {
    this.intentionallyClosed = false;
    const token = getToken();
    if (!token) return;

    // Prevent duplicate connections (e.g. React StrictMode double-invoke)
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?token=${token}`;

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.reconnectDelay = 1000;
      this.emit('_connected', {} as WsEnvelope);
    };

    this.socket.onmessage = (event) => {
      try {
        const envelope: WsEnvelope = JSON.parse(event.data);
        this.emit(envelope.type, envelope);
        this.emit('*', envelope);
      } catch {
        // ignore malformed messages
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      this.emit('_disconnected', {} as WsEnvelope);
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  send(type: WsMessageType, payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const envelope: WsEnvelope = {
      type,
      payload,
      sender: 'user',
      timestamp: new Date().toISOString(),
      id: crypto.randomUUID(),
    };

    this.socket.send(JSON.stringify(envelope));
  }

  on(type: string, listener: WsListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private emit(type: string, envelope: WsEnvelope): void {
    this.listeners.get(type)?.forEach((fn) => fn(envelope));
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}

// Singleton instance
export const ws = new BoardroomWs();
