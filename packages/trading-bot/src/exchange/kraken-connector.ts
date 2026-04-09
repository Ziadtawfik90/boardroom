/**
 * Kraken Exchange Connector
 *
 * Implements ExchangeConnector for Kraken Spot.
 * - REST API for orders, balances, historical candles (OHLC)
 * - WebSocket v2 for real-time candles, ticker, order book
 * - HMAC-SHA512 signed requests with nonce for authenticated endpoints
 * - Auto-reconnect WebSocket with exponential backoff
 *
 * Kraken rate limits (starter tier):
 *   REST:   15 calls / sec (counter decays 1/sec)
 *   Orders: Matching engine limit ~60/min
 * Docs: https://docs.kraken.com/api/
 */

import { createHmac, createHash } from "node:crypto";
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

// ─── Kraken-specific constants ─────────────────────────────────────

const KRAKEN_REST_BASE = "https://api.kraken.com";
const KRAKEN_WS_PUBLIC = "wss://ws.kraken.com/v2";
const KRAKEN_WS_PRIVATE = "wss://ws-auth.kraken.com/v2";

const TIMEFRAME_MAP: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

const TIMEFRAME_WS_MAP: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

const STATUS_MAP: Record<string, OrderStatus> = {
  pending: "pending",
  open: "open",
  closed: "filled",
  canceled: "cancelled",
  expired: "cancelled",
};

// ─── Kraken API response shapes ────────────────────────────────────

interface KrakenResponse<T> {
  error: string[];
  result: T;
}

interface KrakenOHLC {
  [pair: string]: Array<
    [number, string, string, string, string, string, string, number]
  >;
}

interface KrakenTicker {
  [pair: string]: {
    a: [string, string, string]; // ask [price, whole lot vol, lot vol]
    b: [string, string, string]; // bid
    c: [string, string];         // last trade [price, lot vol]
    v: [string, string];         // volume [today, 24h]
    p: [string, string];         // vwap
    t: [number, number];         // number of trades
  };
}

interface KrakenOrderBook {
  [pair: string]: {
    bids: [string, string, string][];
    asks: [string, string, string][];
  };
}

interface KrakenOrderInfo {
  status: string;
  opentm: number;
  closetm: number;
  descr: {
    pair: string;
    type: string;
    ordertype: string;
    price: string;
  };
  vol: string;
  vol_exec: string;
  cost: string;
  fee: string;
  price: string;
  userref?: number;
}

interface KrakenAddOrderResult {
  txid: string[];
  descr: { order: string };
}

interface KrakenCancelResult {
  count: number;
}

interface KrakenBalanceResult {
  [asset: string]: string;
}

// ─── Kraken WS v2 message shapes ──────────────────────────────────

interface KrakenWsOHLC {
  channel: "ohlc";
  type: "snapshot" | "update";
  data: Array<{
    symbol: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    vwap: string;
    trades: number;
    timestamp: string;
    interval_begin: string;
  }>;
}

interface KrakenWsTicker {
  channel: "ticker";
  type: "snapshot" | "update";
  data: Array<{
    symbol: string;
    last: string;
    bid: string;
    ask: string;
    volume: string;
    change: string;
  }>;
}

interface KrakenWsBook {
  channel: "book";
  type: "snapshot" | "update";
  data: Array<{
    symbol: string;
    bids: Array<{ price: string; qty: string }>;
    asks: Array<{ price: string; qty: string }>;
    timestamp: string;
  }>;
}

// ─── Connector Implementation ──────────────────────────────────────

export class KrakenConnector extends BaseConnector implements ExchangeConnector {
  private ws: WebSocket | null = null;
  private subscriptions: MarketDataSubscription[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private nonce = Date.now();

  constructor(config: ExchangeConnectorConfig) {
    super({ ...config, exchange: "kraken" });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.status = "connecting";

    // Validate connectivity
    await this.withRetry(async () => {
      const start = Date.now();
      const resp = await this.publicGet<{ unixtime: number; rfc1123: string }>(
        "/0/public/Time",
      );
      this.restLatencyMs = Date.now() - start;
      if (!resp.unixtime) throw new Error("Invalid Kraken time response");
    }, "ping");

    this.status = "connected";
    this.emit({ type: "connected", exchange: "kraken" });
  }

  async disconnect(): Promise<void> {
    this.closeWebSocket();
    this.destroyBase();
    this.status = "disconnected";
    this.emit({ type: "disconnected", exchange: "kraken", reason: "manual" });
  }

  // ─── Market Data (REST) ────────────────────────────────────────

  async getCandles(symbol: string, timeframe: TimeFrame, limit = 720): Promise<Candle[]> {
    const pair = toKrakenPair(symbol);
    const data = await this.publicGet<KrakenOHLC>("/0/public/OHLC", {
      pair,
      interval: String(TIMEFRAME_MAP[timeframe]),
    });

    // Kraken returns { <pair>: [...], last: ... }
    const key = Object.keys(data).find((k) => k !== "last");
    if (!key) return [];

    const rows = data[key];
    return rows.slice(-limit).map((row) => ({
      timestamp: row[0] * 1000,
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[6]),
      quoteVolume: 0,
      trades: row[7],
      isClosed: true,
    }));
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const pair = toKrakenPair(symbol);
    const data = await this.publicGet<KrakenTicker>("/0/public/Ticker", { pair });

    const key = Object.keys(data)[0];
    if (!key) throw new Error(`No ticker data for ${symbol}`);

    const t = data[key];
    return {
      symbol,
      price: parseFloat(t.c[0]),
      bid: parseFloat(t.b[0]),
      ask: parseFloat(t.a[0]),
      volume24h: parseFloat(t.v[1]),
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBookSnapshot> {
    const pair = toKrakenPair(symbol);
    const data = await this.publicGet<KrakenOrderBook>("/0/public/Depth", {
      pair,
      count: String(Math.min(depth, 500)),
    });

    const key = Object.keys(data)[0];
    if (!key) throw new Error(`No order book data for ${symbol}`);

    const book = data[key];
    return {
      symbol,
      bids: book.bids.map(([p, q]) => ({
        price: parseFloat(p),
        quantity: parseFloat(q),
      })),
      asks: book.asks.map(([p, q]) => ({
        price: parseFloat(p),
        quantity: parseFloat(q),
      })),
      timestamp: Date.now(),
    };
  }

  // ─── Market Data (WebSocket v2) ────────────────────────────────

  async subscribe(subscriptions: MarketDataSubscription[]): Promise<void> {
    this.subscriptions = subscriptions;
    await this.connectWebSocket();
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const lower = new Set(symbols.map((s) => s.toLowerCase()));
    const removed = this.subscriptions.filter((s) =>
      lower.has(s.symbol.toLowerCase()),
    );
    this.subscriptions = this.subscriptions.filter(
      (s) => !lower.has(s.symbol.toLowerCase()),
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      for (const sub of removed) {
        for (const ch of sub.channels) {
          this.sendWsUnsubscribe(sub.symbol, ch, sub.timeframe);
        }
      }
    }
  }

  private async connectWebSocket(): Promise<void> {
    this.closeWebSocket();
    if (this.subscriptions.length === 0) return;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(KRAKEN_WS_PUBLIC);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.wsConnected = true;
        this.reconnectAttempt = 0;
        this.lastHeartbeat = Date.now();
        this.startHeartbeat();

        // Send subscriptions
        for (const sub of this.subscriptions) {
          for (const ch of sub.channels) {
            this.sendWsSubscribe(sub.symbol, ch, sub.timeframe);
          }
        }
        resolve();
      });

      ws.addEventListener("message", (event) => {
        this.lastHeartbeat = Date.now();
        if (this.heartbeatTimeout) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = null;
        }
        try {
          const data = JSON.parse(String(event.data));
          this.handleWsMessage(data);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.addEventListener("close", (event) => {
        this.wsConnected = false;
        this.stopHeartbeat();
        this.emit({
          type: "disconnected",
          exchange: "kraken",
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

  private sendWsSubscribe(
    symbol: string,
    channel: "candles" | "ticker" | "orderbook",
    timeframe?: TimeFrame,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const krakenSymbol = toKrakenWsPair(symbol);

    switch (channel) {
      case "candles":
        this.ws.send(JSON.stringify({
          method: "subscribe",
          params: {
            channel: "ohlc",
            symbol: [krakenSymbol],
            interval: TIMEFRAME_WS_MAP[timeframe ?? "1m"],
          },
        }));
        break;
      case "ticker":
        this.ws.send(JSON.stringify({
          method: "subscribe",
          params: {
            channel: "ticker",
            symbol: [krakenSymbol],
          },
        }));
        break;
      case "orderbook":
        this.ws.send(JSON.stringify({
          method: "subscribe",
          params: {
            channel: "book",
            symbol: [krakenSymbol],
            depth: 25,
          },
        }));
        break;
    }
  }

  private sendWsUnsubscribe(
    symbol: string,
    channel: "candles" | "ticker" | "orderbook",
    timeframe?: TimeFrame,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const krakenSymbol = toKrakenWsPair(symbol);
    const wsChannel = channel === "candles" ? "ohlc" : channel === "orderbook" ? "book" : "ticker";
    const params: Record<string, unknown> = {
      channel: wsChannel,
      symbol: [krakenSymbol],
    };
    if (channel === "candles") {
      params.interval = TIMEFRAME_WS_MAP[timeframe ?? "1m"];
    }

    this.ws.send(JSON.stringify({ method: "unsubscribe", params }));
  }

  private handleWsMessage(data: Record<string, unknown>): void {
    const channel = data.channel as string | undefined;
    if (!channel) return;

    // Heartbeat/system messages
    if (channel === "heartbeat" || channel === "status") return;

    let event: MarketDataEvent | null = null;

    switch (channel) {
      case "ohlc": {
        const msg = data as unknown as KrakenWsOHLC;
        for (const candle of msg.data) {
          event = {
            type: "candle",
            symbol: fromKrakenWsPair(candle.symbol),
            timeframe: "1m", // Kraken WS provides the subscribed interval
            data: {
              timestamp: new Date(candle.interval_begin).getTime(),
              open: parseFloat(candle.open),
              high: parseFloat(candle.high),
              low: parseFloat(candle.low),
              close: parseFloat(candle.close),
              volume: parseFloat(candle.volume),
              quoteVolume: 0,
              trades: candle.trades,
              isClosed: msg.type === "snapshot",
            },
          };
          this.emit({ type: "market_data", event });
        }
        return;
      }

      case "ticker": {
        const msg = data as unknown as KrakenWsTicker;
        for (const tick of msg.data) {
          event = {
            type: "ticker",
            data: {
              symbol: fromKrakenWsPair(tick.symbol),
              price: parseFloat(tick.last),
              bid: parseFloat(tick.bid),
              ask: parseFloat(tick.ask),
              volume24h: parseFloat(tick.volume),
              timestamp: Date.now(),
            },
          };
          this.emit({ type: "market_data", event });
        }
        return;
      }

      case "book": {
        const msg = data as unknown as KrakenWsBook;
        for (const entry of msg.data) {
          event = {
            type: "orderbook",
            data: {
              symbol: fromKrakenWsPair(entry.symbol),
              bids: entry.bids.map((b) => ({
                price: parseFloat(b.price),
                quantity: parseFloat(b.qty),
              })),
              asks: entry.asks.map((a) => ({
                price: parseFloat(a.price),
                quantity: parseFloat(a.qty),
              })),
              timestamp: new Date(entry.timestamp).getTime(),
            },
          };
          this.emit({ type: "market_data", event });
        }
        return;
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const { heartbeatIntervalMs, heartbeatTimeoutMs } = this.config.websocket;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: "ping" }));
        this.heartbeatTimeout = setTimeout(() => {
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
    if (this.status === "disconnected") return;

    const { reconnectBackoffMs, reconnectMaxMs } = this.config.websocket;
    const delay = Math.min(
      reconnectBackoffMs * 2 ** this.reconnectAttempt + Math.random() * 1000,
      reconnectMaxMs,
    );

    this.reconnectAttempt++;
    this.emit({ type: "reconnecting", exchange: "kraken", attempt: this.reconnectAttempt });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWebSocket();
      } catch {
        // failure triggers close → scheduleReconnect
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

  // ─── Order Management ───────────────────────────────────────────

  async placeOrder(request: OrderRequest): Promise<Order> {
    await this.orderLimiter.acquire();

    const params: Record<string, string> = {
      pair: toKrakenPair(request.symbol),
      type: request.side,
      ordertype: request.type === "market" ? "market" : "limit",
      volume: String(request.quantity),
    };

    if (request.type === "limit" && request.price != null) {
      params.price = String(request.price);
    }

    if (request.clientOrderId) {
      params.userref = request.clientOrderId;
    }

    const data = await this.privatePost<KrakenAddOrderResult>(
      "/0/private/AddOrder",
      params,
    );

    const txid = data.txid[0];
    const order: Order = {
      id: txid,
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      status: "pending",
      quantity: request.quantity,
      filledQuantity: 0,
      price: request.price,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.emit({ type: "order_update", order });
    return order;
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<Order> {
    await this.orderLimiter.acquire();
    await this.privatePost<KrakenCancelResult>("/0/private/CancelOrder", {
      txid: orderId,
    });

    // Fetch updated order state
    return this.getOrder(orderId, _symbol);
  }

  async getOrder(orderId: string, _symbol: string): Promise<Order> {
    const data = await this.privatePost<Record<string, KrakenOrderInfo>>(
      "/0/private/QueryOrders",
      { txid: orderId },
    );

    const info = data[orderId];
    if (!info) throw new Error(`Order ${orderId} not found`);

    return this.mapOrder(orderId, info);
  }

  async getOpenOrders(_symbol?: string): Promise<Order[]> {
    const data = await this.privatePost<{ open: Record<string, KrakenOrderInfo> }>(
      "/0/private/OpenOrders",
      {},
    );

    return Object.entries(data.open).map(([txid, info]) =>
      this.mapOrder(txid, info),
    );
  }

  // ─── Account ────────────────────────────────────────────────────

  async getBalances(): Promise<Balance[]> {
    const data = await this.privatePost<KrakenBalanceResult>(
      "/0/private/Balance",
      {},
    );

    return Object.entries(data)
      .map(([asset, amount]) => {
        const total = parseFloat(amount);
        return {
          asset: normalizeKrakenAsset(asset),
          free: total,
          locked: 0,
          total,
        };
      })
      .filter((b) => b.total > 0);
  }

  async getPositions(): Promise<Position[]> {
    // Kraken spot uses balances, not positions
    const balances = await this.getBalances();
    return balances
      .filter((b) => b.asset !== "USD" && b.asset !== "ZUSD" && b.total > 0)
      .map((b) => ({
        symbol: `${b.asset}USD`,
        side: "buy" as const,
        quantity: b.total,
        entryPrice: 0,
        currentPrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
      }));
  }

  // ─── REST Helpers ───────────────────────────────────────────────

  private async publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.restLimiter.acquire();
    const url = new URL(path, KRAKEN_REST_BASE);
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
        throw new Error(`Kraken ${response.status}: ${body}`);
      }
      return response;
    }, `GET ${path}`);

    this.restLatencyMs = Date.now() - start;
    const json = (await res.json()) as KrakenResponse<T>;

    if (json.error && json.error.length > 0) {
      const errStr = json.error.join(", ");
      if (errStr.includes("Rate limit")) {
        this.emit({ type: "rate_limited", exchange: "kraken", waitMs: 1000 });
      }
      throw new Error(`Kraken API error: ${errStr}`);
    }

    return json.result;
  }

  private async privatePost<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    if (!this.config.credentials) {
      throw new Error("Credentials required for authenticated endpoints");
    }

    await this.restLimiter.acquire();

    const { apiKey, apiSecret } = this.config.credentials;
    const currentNonce = (++this.nonce).toString();
    const body = new URLSearchParams({ ...params, nonce: currentNonce });

    // Kraken signature: HMAC-SHA512(path + SHA256(nonce + body), base64decode(secret))
    const sha256 = createHash("sha256")
      .update(currentNonce + body.toString())
      .digest();
    const message = Buffer.concat([Buffer.from(path, "utf-8"), sha256]);
    const signature = createHmac("sha512", Buffer.from(apiSecret, "base64"))
      .update(message)
      .digest("base64");

    const start = Date.now();
    const res = await this.withRetry(async () => {
      const response = await fetch(`${KRAKEN_REST_BASE}${path}`, {
        method: "POST",
        headers: {
          "API-Key": apiKey,
          "API-Sign": signature,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (response.status === 429) {
        this.emit({ type: "rate_limited", exchange: "kraken", waitMs: 1000 });
        throw new Error("429 rate limited");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Kraken ${response.status}: ${text}`);
      }

      return response;
    }, `POST ${path}`);

    this.restLatencyMs = Date.now() - start;
    const json = (await res.json()) as KrakenResponse<T>;

    if (json.error && json.error.length > 0) {
      const errStr = json.error.join(", ");
      throw new Error(`Kraken API error: ${errStr}`);
    }

    return json.result;
  }

  // ─── Mapping Helpers ────────────────────────────────────────────

  private mapOrder(txid: string, info: KrakenOrderInfo): Order {
    const filledQty = parseFloat(info.vol_exec);
    const cost = parseFloat(info.cost);

    return {
      id: txid,
      symbol: fromKrakenPair(info.descr.pair),
      side: info.descr.type as "buy" | "sell",
      type: info.descr.ordertype === "market" ? "market" : "limit",
      status: STATUS_MAP[info.status] ?? "pending",
      quantity: parseFloat(info.vol),
      filledQuantity: filledQty,
      price: parseFloat(info.descr.price) || undefined,
      avgFillPrice: filledQty > 0 ? cost / filledQty : undefined,
      createdAt: info.opentm * 1000,
      updatedAt: (info.closetm || info.opentm) * 1000,
    };
  }
}

// ─── Pair Conversion Utilities ──────────────────────────────────────

/**
 * Convert unified symbol (e.g., "BTCUSD") to Kraken REST pair (e.g., "XBTUSD").
 * Kraken uses XBT for Bitcoin and has X/Z prefixes on some assets.
 */
function toKrakenPair(symbol: string): string {
  return symbol
    .replace("BTC", "XBT")
    .toUpperCase();
}

/**
 * Convert unified symbol to Kraken WS v2 format (e.g., "BTC/USD").
 */
function toKrakenWsPair(symbol: string): string {
  // Common pairs: strip known quote currencies
  const quotes = ["USDT", "USD", "EUR", "GBP"];
  for (const q of quotes) {
    if (symbol.toUpperCase().endsWith(q)) {
      const base = symbol.slice(0, -q.length);
      return `${base}/${q}`;
    }
  }
  return symbol;
}

/**
 * Convert Kraken WS pair (e.g., "BTC/USD") back to unified symbol.
 */
function fromKrakenWsPair(pair: string): string {
  return pair.replace("/", "").replace("XBT", "BTC").toUpperCase();
}

/**
 * Convert Kraken REST pair back to unified symbol.
 */
function fromKrakenPair(pair: string): string {
  return pair
    .replace("XBT", "BTC")
    .replace(/^[XZ]/, "")
    .toUpperCase();
}

/**
 * Normalize Kraken asset names (e.g., "XXBT" → "BTC", "ZUSD" → "USD").
 */
function normalizeKrakenAsset(asset: string): string {
  const map: Record<string, string> = {
    XXBT: "BTC",
    XETH: "ETH",
    ZUSD: "USD",
    ZEUR: "EUR",
    XLTC: "LTC",
    XXRP: "XRP",
    XXLM: "XLM",
  };
  return map[asset] ?? asset;
}
