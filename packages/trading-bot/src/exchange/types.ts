/**
 * Exchange API Connector — Interface Contracts
 *
 * All exchange implementations (Binance, Kraken, Paper) must conform to
 * the ExchangeConnector interface. Strategies never touch exchange-specific
 * APIs directly.
 */

// ─── Market Data Types ───────────────────────────────────────────────

export type Exchange = "binance" | "kraken" | "paper";

export type TimeFrame =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

export interface Candle {
  timestamp: number;       // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  isClosed: boolean;       // true when candle is finalized
}

export interface Ticker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: OrderBookLevel[];  // sorted descending by price
  asks: OrderBookLevel[];  // sorted ascending by price
  timestamp: number;
}

export type MarketDataEvent =
  | { type: "candle"; symbol: string; timeframe: TimeFrame; data: Candle }
  | { type: "ticker"; data: Ticker }
  | { type: "orderbook"; data: OrderBookSnapshot };

// ─── Order Types ─────────────────────────────────────────────────────

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "pending"
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected";

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;          // required for limit orders
  clientOrderId?: string;  // optional idempotency key
}

export interface Order {
  id: string;              // exchange-assigned order ID
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  price?: number;          // limit price (if limit order)
  avgFillPrice?: number;   // average execution price
  createdAt: number;       // Unix ms
  updatedAt: number;
}

// ─── Account Types ───────────────────────────────────────────────────

export interface Balance {
  asset: string;
  free: number;            // available for trading
  locked: number;          // in open orders
  total: number;           // free + locked
}

export interface Position {
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

// ─── Health / Diagnostics ────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "degraded";

export interface ConnectorHealth {
  exchange: Exchange;
  status: ConnectionStatus;
  restLatencyMs: number | null;
  wsConnected: boolean;
  rateLimitRemaining: number;    // percentage 0-100
  lastHeartbeat: number | null;  // Unix ms
  errors24h: number;
}

// ─── Connector Events ────────────────────────────────────────────────

export type ConnectorEvent =
  | { type: "connected"; exchange: Exchange }
  | { type: "disconnected"; exchange: Exchange; reason: string }
  | { type: "reconnecting"; exchange: Exchange; attempt: number }
  | { type: "rate_limited"; exchange: Exchange; waitMs: number }
  | { type: "error"; exchange: Exchange; message: string; code?: string }
  | { type: "market_data"; event: MarketDataEvent }
  | { type: "order_update"; order: Order };

export type ConnectorEventHandler = (event: ConnectorEvent) => void;

// ─── Subscription ────────────────────────────────────────────────────

export interface MarketDataSubscription {
  symbol: string;
  channels: Array<"candles" | "ticker" | "orderbook">;
  timeframe?: TimeFrame;   // required when subscribing to candles
}

// ─── Configuration ───────────────────────────────────────────────────

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;     // some exchanges require this (e.g., Coinbase)
}

export interface RateLimitConfig {
  maxRequestsPerSecond: number;
  maxOrdersPerSecond: number;
}

export interface WebSocketConfig {
  reconnectBackoffMs: number;
  reconnectMaxMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface ExchangeConnectorConfig {
  exchange: Exchange;
  credentials?: ExchangeCredentials;  // optional for paper trading
  rateLimits: RateLimitConfig;
  websocket: WebSocketConfig;
  retry: RetryConfig;
  sandbox?: boolean;                  // use exchange's testnet if available
}

// ─── The Core Interface ──────────────────────────────────────────────

export interface ExchangeConnector {
  readonly exchange: Exchange;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): ConnectorHealth;

  // Market Data
  subscribe(subscriptions: MarketDataSubscription[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  getCandles(symbol: string, timeframe: TimeFrame, limit?: number): Promise<Candle[]>;
  getTicker(symbol: string): Promise<Ticker>;
  getOrderBook(symbol: string, depth?: number): Promise<OrderBookSnapshot>;

  // Order Management
  placeOrder(request: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string, symbol: string): Promise<Order>;
  getOrder(orderId: string, symbol: string): Promise<Order>;
  getOpenOrders(symbol?: string): Promise<Order[]>;

  // Account
  getBalances(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;

  // Events
  on(handler: ConnectorEventHandler): void;
  off(handler: ConnectorEventHandler): void;
}
