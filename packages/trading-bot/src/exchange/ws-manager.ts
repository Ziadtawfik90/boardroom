/**
 * WebSocket Manager
 *
 * Manages WebSocket connections with auto-reconnect, heartbeat monitoring,
 * and exponential backoff. Exchange connectors delegate WS lifecycle here.
 */

import type { WebSocketConfig } from "./types.js";

export type WsMessageHandler = (data: string) => void;
export type WsEventHandler = (event: WsLifecycleEvent) => void;

export type WsLifecycleEvent =
  | { type: "open" }
  | { type: "close"; reason: string }
  | { type: "reconnecting"; attempt: number }
  | { type: "error"; message: string };

interface ManagedSocket {
  url: string;
  ws: WebSocket | null;
  onMessage: WsMessageHandler;
  onEvent: WsEventHandler;
  reconnectAttempt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
}

export class WsManager {
  private sockets = new Map<string, ManagedSocket>();
  private config: WebSocketConfig;

  constructor(config: WebSocketConfig) {
    this.config = config;
  }

  connect(
    id: string,
    url: string,
    onMessage: WsMessageHandler,
    onEvent: WsEventHandler,
  ): void {
    if (this.sockets.has(id)) {
      this.close(id);
    }

    const managed: ManagedSocket = {
      url,
      ws: null,
      onMessage,
      onEvent,
      reconnectAttempt: 0,
      heartbeatTimer: null,
      heartbeatTimeout: null,
      reconnectTimer: null,
      closing: false,
    };

    this.sockets.set(id, managed);
    this.openSocket(managed);
  }

  send(id: string, data: string): boolean {
    const managed = this.sockets.get(id);
    if (!managed?.ws || managed.ws.readyState !== 1) return false;
    managed.ws.send(data);
    return true;
  }

  close(id: string): void {
    const managed = this.sockets.get(id);
    if (!managed) return;

    managed.closing = true;
    this.clearTimers(managed);
    if (managed.ws && (managed.ws.readyState === 0 || managed.ws.readyState === 1)) {
      managed.ws.close(1000, "client close");
    }
    this.sockets.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.sockets.keys()]) {
      this.close(id);
    }
  }

  isConnected(id: string): boolean {
    const managed = this.sockets.get(id);
    return managed?.ws?.readyState === 1;
  }

  hasAnyConnection(): boolean {
    for (const managed of this.sockets.values()) {
      if (managed.ws?.readyState === 1) return true;
    }
    return false;
  }

  private openSocket(managed: ManagedSocket): void {
    if (managed.closing) return;

    try {
      const ws = new WebSocket(managed.url);
      managed.ws = ws;

      ws.addEventListener("open", () => {
        managed.reconnectAttempt = 0;
        managed.onEvent({ type: "open" });
        this.startHeartbeat(managed);
      });

      ws.addEventListener("message", (event) => {
        // Reset heartbeat timeout on any message
        if (managed.heartbeatTimeout) {
          clearTimeout(managed.heartbeatTimeout);
          managed.heartbeatTimeout = null;
        }
        const data = typeof event.data === "string" ? event.data : String(event.data);
        managed.onMessage(data);
      });

      ws.addEventListener("close", (event) => {
        this.clearTimers(managed);
        if (!managed.closing) {
          managed.onEvent({ type: "close", reason: event.reason || "connection lost" });
          this.scheduleReconnect(managed);
        }
      });

      ws.addEventListener("error", () => {
        managed.onEvent({ type: "error", message: `WebSocket error on ${managed.url}` });
      });
    } catch (err) {
      managed.onEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      if (!managed.closing) {
        this.scheduleReconnect(managed);
      }
    }
  }

  private startHeartbeat(managed: ManagedSocket): void {
    this.clearTimers(managed);
    managed.heartbeatTimer = setInterval(() => {
      if (managed.ws?.readyState === 1) {
        // Send a ping frame; for exchanges that don't support standard ping,
        // subclasses send their own ping via send()
        try {
          managed.ws.send("ping");
        } catch {
          // ignore
        }
        managed.heartbeatTimeout = setTimeout(() => {
          // No response — force reconnect
          managed.ws?.close();
        }, this.config.heartbeatTimeoutMs);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private scheduleReconnect(managed: ManagedSocket): void {
    if (managed.closing || managed.reconnectTimer) return;

    managed.reconnectAttempt++;
    const base = this.config.reconnectBackoffMs * Math.pow(2, managed.reconnectAttempt - 1);
    const delay = Math.min(base, this.config.reconnectMaxMs);
    const jitter = delay * 0.2 * Math.random();

    managed.onEvent({ type: "reconnecting", attempt: managed.reconnectAttempt });

    managed.reconnectTimer = setTimeout(() => {
      managed.reconnectTimer = null;
      this.openSocket(managed);
    }, delay + jitter);
  }

  private clearTimers(managed: ManagedSocket): void {
    if (managed.heartbeatTimer) {
      clearInterval(managed.heartbeatTimer);
      managed.heartbeatTimer = null;
    }
    if (managed.heartbeatTimeout) {
      clearTimeout(managed.heartbeatTimeout);
      managed.heartbeatTimeout = null;
    }
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }
  }
}
