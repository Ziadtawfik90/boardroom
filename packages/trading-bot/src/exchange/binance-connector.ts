/**
 * Binance Exchange Connector
 *
 * Implements ExchangeConnector for Binance Spot.
 * - REST API for orders, balances, historical candles
 * - WebSocket for real-time klines, ticker, order book
 * - HMAC-SHA256 signed requests for authenticated endpoints
 * - Auto-reconnect WebSocket with exponential backoff
 *
 * Binance rate limits (default tier):
 *   REST:   1200 weight / min (~20/sec)
 *   Orders: 10 orders / sec
 *   WS:     5 messages / sec outbound
 */

import { createHmac } from "node:crypto";
import { BaseConnector } from "./base-connector.js";
import type {
  ExchangeConnector,
  ExchangeConnectorConfig,
  MarketDataSubscription,
  Candle,
  Ticker,
  OrderBookSnapshot,
  OrderRequest,
  Order,
  Balance,
  Position,
  TimeFrame,
  OrderStatus,
  MarketDataEvent,
} from "./types.js";

// ─── Binance-specific defaults ──────────────────────────────────────

const BINANCE_REST_BASE = "https://api.binance.com";
const BINANCE_TESTNET_REST = "https://testnet.binance.vision";
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";
const BINANCE_TESTNET_WS = "wss://testnet.binance.vision/ws";

const TIMEFRAME_MAP: Record<TimeFrame, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const STATUS_MAP: Record<string, OrderStatus> = {
  NEW: "open",
  PARTIALLY_FILLED: "partially_filled",
  FILLED: "filled",
  CANCELED: "cancelled",
  REJECTED: "rejected",
  EXPIRED: "cancelled",
};

// ─── Binance API response types ─────────────────────────────────────

interface BinanceKline {
  0: number;  // open time
  1: string;  // open
  2: string;  // high
  3: string;  // low
  4: string;  // close
  5: string;  // volume
  6: number;  // close time
  7: string;  // quote asset volume
  8: number;  // number of trades
  9: string;  // taker buy base vol
  10: string; // taker buy quote vol
  11: string; // ignore
}

interface BinanceOrder {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  origQty: string;
  executedQty: string;
  price: string;
  cummulativeQuoteQty: string;
  time: number;
  updateTime: number;
}

interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceWsKline {
  e: string;      // event type
  s: string;      // symbol
  k: {
    t: number;    // kline start time
    o: string;    // open
    h: string;    // high
    l: string;    // low
    c: string;    // close
    v: string;    // volume
    q: string;    // quote volume
    n: number;    // trades
    x: boolean;   // is final
    i: string;    // interval
  };
}

interface BinanceWsTicker {
  e: string;
  s: string;
  c: string;    // last price
  b: string;    // best bid
  a: string;    // best ask
  v: string;    // volume 24h
  E: number;    // event time
}

interface BinanceWsDepth {
  e: string;
  s: string;
  b: [string, string][];  // bids [price, qty]
  a: [string, string][];  // asks [price, qty]
  E: number;
}

// ─── Connector Implementation ───────────────────────────────────────

export class BinanceConnector extends BaseConnector implements ExchangeConnector {
  private readonly restBase: string;
  private readonly wsBase: string;
  private ws: WebSocket | null = null;
  private subscriptions: MarketDataSubscription[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private positions: Map<string, Position> = new Map();

  constructor(config: ExchangeConnectorConfig) {
    super({ ...config, exchange: "binance" });
    this.restBase = config.sandbox ? BINANCE_TESTNET_REST : BINANCE_REST_BASE;
    this.wsBase = config.sandbox ? BINANCE_TESTNET_WS : BINANCE_WS_BASE;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.status = "connecting";
    this.emit({ type: "connected", exchange: "binance" });

    // Validate connectivity with a ping
    await this.withRetry(async () => {
      const start = Date.now();
      await this.publicGet("/api/v3/ping");
      this.restLatencyMs = Date.now() - start;
    }, "ping");

    this.status = "connected";
  }

  async disconnect(): Promise<void> {
    this.closeWebSocket();
    this.destroyBase();
    this.status = "disconnected";
    this.emit({ type: "disconnected", exchange: "binance", reason: "manual" });
  }

  // ─── Market Data ────────────────────────────────────────────────

  async subscribe(subscriptions: MarketDataSubscription[]): Promise<void> {
    this.subscriptions = subscriptions;
    await this.connectWebSocket();
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const lower = new Set(symbols.map((s) => s.toLowerCase()));
    this.subscriptions = this.subscriptions.filter(
      (sub) => !lower.has(sub.symbol.toLowerCase()),
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const streams = this.buildStreamNames(
        this.subscriptions.filter((s) => lower.has(s.symbol.toLowerCase())),
      );
      if (streams.length > 0) {
        this.ws.send(JSON.stringify({
          method: "UNSUBSCRIBE",
          params: streams,
          id: Date.now(),
        }));
      }
    }
  }

  async getCandles(symbol: string, timeframe: TimeFrame, limit = 500): Promise<Candle[]> {
    const data = await this.publicGet<BinanceKline[]>("/api/v3/klines", {
      symbol: symbol.toUpperCase(),
      interval: TIMEFRAME_MAP[timeframe],
      limit: String(Math.min(limit, 1000)),
    });

    return data.map((k) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
      isClosed: true,
    }));
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const data = await this.publicGet<{
      symbol: string;
      lastPrice: string;
      bidPrice: string;
      askPrice: string;
      volume: string;
    }>("/api/v3/ticker/24hr", {
      symbol: symbol.toUpperCase(),
    });

    return {
      symbol: data.symbol,
      price: parseFloat(data.lastPrice),
      bid: parseFloat(data.bidPrice),
      ask: parseFloat(data.askPrice),
      volume24h: parseFloat(data.volume),
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBookSnapshot> {
    const data = await this.publicGet<{
      bids: [string, string][];
      asks: [string, string][];
    }>("/api/v3/depth", {
      symbol: symbol.toUpperCase(),
      limit: String(Math.min(depth, 5000)),
    });

    return {
      symbol: symbol.toUpperCase(),
      bids: data.bids.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
      asks: data.asks.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
      timestamp: Date.now(),
    };
  }

  // ─── Order Management ───────────────────────────────────────────

  async placeOrder(request: OrderRequest): Promise<Order> {
    await this.orderLimiter.acquire();

    const params: Record<string, string> = {
      symbol: request.symbol.toUpperCase(),
      side: request.side.toUpperCase(),
      type: request.type.toUpperCase(),
      quantity: String(request.quantity),
    };

    if (request.type === "market") {
      params.type = "MARKET";
    } else {
      params.type = "LIMIT";
      params.timeInForce = "GTC";
      if (request.price != null) {
        params.price = String(request.price);
      }
    }

    if (request.clientOrderId) {
      params.newClientOrderId = request.clientOrderId;
    }

    const data = await this.signedPost<BinanceOrder>("/api/v3/order", params);
    const order = this.mapOrder(data);
    this.emit({ type: "order_update", order });
    return order;
  }

  async cancelOrder(orderId: string, symbol: string): Promise<Order> {
    await this.orderLimiter.acquire();
    const data = await this.signedDelete<BinanceOrder>("/api/v3/order", {
      symbol: symbol.toUpperCase(),
      orderId,
    });
    const order = this.mapOrder(data);
    this.emit({ type: "order_update", order });
    return order;
  }

  async getOrder(orderId: string, symbol: string): Promise<Order> {
    const data = await this.signedGet<BinanceOrder>("/api/v3/order", {
      symbol: symbol.toUpperCase(),
      orderId,
    });
    return this.mapOrder(data);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol.toUpperCase();
    const data = await this.signedGet<BinanceOrder[]>("/api/v3/openOrders", params);
    return data.map((o) => this.mapOrder(o));
  }

  // ─── Account ────────────────────────────────────────────────────

  async getBalances(): Promise<Balance[]> {
    const data = await this.signedGet<{ balances: BinanceBalance[] }>("/api/v3/account");
    return data.balances
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter((b) => b.total > 0);
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values());
  }

  // ─── REST Helpers ───────────────────────────────────────────────

  private async publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.restLimiter.acquire();
    const url = new URL(path, this.restBase);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const start = Date.now();
    const res = await this.withRetry(async () => {
      const response = await fetch(url.toString());
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Binance ${response.status}: ${body}`);
      }
      return response;
    }, `GET ${path}`);

    this.restLatencyMs = Date.now() - start;
    return res.json() as Promise<T>;
  }

  private async signedGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.signedRequest<T>("GET", path, params);
  }

  private async signedPost<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.signedRequest<T>("POST", path, params);
  }

  private async signedDelete<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.signedRequest<T>("DELETE", path, params);
  }

  private async signedRequest<T>(
    method: string,
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    if (!this.config.credentials) {
      throw new Error("Credentials required for authenticated endpoints");
    }

    await this.restLimiter.acquire();

    const { apiKey, apiSecret } = this.config.credentials;
    const query = new URLSearchParams(params);
    query.set("timestamp", String(Date.now()));
    query.set("recvWindow", "5000");

    const signature = createHmac("sha256", apiSecret)
      .update(query.toString())
      .digest("hex");
    query.set("signature", signature);

    const url = `${this.restBase}${path}?${query.toString()}`;
    const start = Date.now();

    const res = await this.withRetry(async () => {
      const response = await fetch(url, {
        method,
        headers: { "X-MBX-APIKEY": apiKey },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
        this.emit({ type: "rate_limited", exchange: "binance", waitMs });
        throw new Error(`429 rate limited, retry after ${waitMs}ms`);
      }

      if (response.status === 401 || response.status === 403) {
        this.recordError(`Auth failure: ${response.status}`, String(response.status));
        this.status = "degraded";
        throw new Error(`Auth failure: ${response.status}`);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Binance ${response.status}: ${body}`);
      }

      return response;
    }, `${method} ${path}`);

    this.restLatencyMs = Date.now() - start;
    return res.json() as Promise<T>;
  }

  // ─── WebSocket ──────────────────────────────────────────────────

  private buildStreamNames(subs: MarketDataSubscription[]): string[] {
    const streams: string[] = [];
    for (const sub of subs) {
      const sym = sub.symbol.toLowerCase();
      for (const ch of sub.channels) {
        switch (ch) {
          case "candles":
            streams.push(`${sym}@kline_${TIMEFRAME_MAP[sub.timeframe ?? "1m"]}`);
            break;
          case "ticker":
            streams.push(`${sym}@ticker`);
            break;
          case "orderbook":
            streams.push(`${sym}@depth@100ms`);
            break;
        }
      }
    }
    return streams;
  }

  private async connectWebSocket(): Promise<void> {
    this.closeWebSocket();

    const streams = this.buildStreamNames(this.subscriptions);
    if (streams.length === 0) return;

    const url = `${this.wsBase}/${streams.join("/")}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.wsConnected = true;
        this.reconnectAttempt = 0;
        this.lastHeartbeat = Date.now();
        this.startHeartbeat();
        resolve();
      });

      ws.addEventListener("message", (event) => {
        this.lastHeartbeat = Date.now();
        try {
          const data = JSON.parse(String(event.data));
          this.handleWsMessage(data);
        } catch {
          // Malformed message — ignore
        }
      });

      ws.addEventListener("close", (event) => {
        this.wsConnected = false;
        this.stopHeartbeat();
        this.emit({
          type: "disconnected",
          exchange: "binance",
          reason: `WebSocket closed: ${event.code} ${event.reason}`,
        });
        this.scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        this.recordError("WebSocket error");
        if (!this.wsConnected) {
          reject(new Error("WebSocket connection failed"));
        }
      });
    });
  }

  private handleWsMessage(data: Record<string, unknown>): void {
    const eventType = data.e as string | undefined;
    if (!eventType) return;

    let event: MarketDataEvent | null = null;

    switch (eventType) {
      case "kline": {
        const msg = data as unknown as BinanceWsKline;
        const k = msg.k;
        event = {
          type: "candle",
          symbol: msg.s,
          timeframe: k.i as TimeFrame,
          data: {
            timestamp: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            quoteVolume: parseFloat(k.q),
            trades: k.n,
            isClosed: k.x,
          },
        };
        break;
      }

      case "24hrTicker": {
        const msg = data as unknown as BinanceWsTicker;
        event = {
          type: "ticker",
          data: {
            symbol: msg.s,
            price: parseFloat(msg.c),
            bid: parseFloat(msg.b),
            ask: parseFloat(msg.a),
            volume24h: parseFloat(msg.v),
            timestamp: msg.E,
          },
        };
        break;
      }

      case "depthUpdate": {
        const msg = data as unknown as BinanceWsDepth;
        event = {
          type: "orderbook",
          data: {
            symbol: msg.s,
            bids: msg.b.map(([p, q]) => ({
              price: parseFloat(p),
              quantity: parseFloat(q),
            })),
            asks: msg.a.map(([p, q]) => ({
              price: parseFloat(p),
              quantity: parseFloat(q),
            })),
            timestamp: msg.E,
          },
        };
        break;
      }
    }

    if (event) {
      this.emit({ type: "market_data", event });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const { heartbeatIntervalMs, heartbeatTimeoutMs } = this.config.websocket;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: "ping" }));

        this.heartbeatTimeout = setTimeout(() => {
          // No pong received — force reconnect
          this.recordError("Heartbeat timeout, forcing reconnect");
          this.closeWebSocket();
          this.scheduleReconnect();
        }, heartbeatTimeoutMs);
      }
    }, heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.status === "disconnected") return; // manual disconnect

    const { reconnectBackoffMs, reconnectMaxMs } = this.config.websocket;
    const delay = Math.min(
      reconnectBackoffMs * 2 ** this.reconnectAttempt + Math.random() * 1000,
      reconnectMaxMs,
    );

    this.reconnectAttempt++;
    this.emit({ type: "reconnecting", exchange: "binance", attempt: this.reconnectAttempt });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWebSocket();
      } catch {
        // connectWebSocket failure triggers another close → scheduleReconnect
      }
    }, delay);
  }

  private closeWebSocket(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  // ─── Mapping Helpers ────────────────────────────────────────────

  private mapOrder(o: BinanceOrder): Order {
    const filledQty = parseFloat(o.executedQty);
    const quoteQty = parseFloat(o.cummulativeQuoteQty);

    return {
      id: String(o.orderId),
      clientOrderId: o.clientOrderId || undefined,
      symbol: o.symbol,
      side: o.side.toLowerCase() as "buy" | "sell",
      type: o.type === "MARKET" ? "market" : "limit",
      status: STATUS_MAP[o.status] ?? "pending",
      quantity: parseFloat(o.origQty),
      filledQuantity: filledQty,
      price: parseFloat(o.price) || undefined,
      avgFillPrice: filledQty > 0 ? quoteQty / filledQty : undefined,
      createdAt: o.time,
      updatedAt: o.updateTime,
    };
  }
}
