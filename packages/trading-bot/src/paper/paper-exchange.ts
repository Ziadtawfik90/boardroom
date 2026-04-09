/**
 * Paper Trading Exchange Connector
 *
 * Implements the full ExchangeConnector interface using simulated execution.
 * Orders are filled against live ticker prices with configurable slippage
 * and fee models. No real capital is ever at risk.
 *
 * Usage:
 *   const engine = new PaperExchange({ initialBalances: { USDT: 10_000 } });
 *   await engine.connect();
 *   await engine.placeOrder({ symbol: "BTC/USDT", side: "buy", type: "market", quantity: 0.1 });
 */

import type {
  ExchangeConnector,
  ConnectorHealth,
  ConnectorEvent,
  ConnectorEventHandler,
  MarketDataSubscription,
  Candle,
  Ticker,
  OrderBookSnapshot,
  OrderBookLevel,
  OrderRequest,
  Order,
  Balance,
  Position,
  TimeFrame,
} from "../exchange/types.js";
import { PositionTracker } from "./position-tracker.js";

// ─── Configuration ────────────────────────────────────────────────────

export interface PaperExchangeConfig {
  /** Starting balances, e.g. { USDT: 10_000, BTC: 0 } */
  initialBalances: Record<string, number>;
  /** Simulated taker fee as a fraction (default: 0.001 = 0.1%) */
  takerFeeRate?: number;
  /** Simulated maker fee as a fraction (default: 0.001 = 0.1%) */
  makerFeeRate?: number;
  /** Simulated slippage as a fraction (default: 0.0005 = 0.05%) */
  slippageRate?: number;
  /** How often to check limit orders for fills (ms, default: 100) */
  limitOrderCheckIntervalMs?: number;
}

// ─── Engine ───────────────────────────────────────────────────────────

export class PaperExchange implements ExchangeConnector {
  readonly exchange = "paper" as const;

  private readonly tracker: PositionTracker;
  private readonly takerFeeRate: number;
  private readonly makerFeeRate: number;
  private readonly slippageRate: number;
  private readonly limitOrderCheckIntervalMs: number;

  private connected = false;
  private handlers: ConnectorEventHandler[] = [];
  private orderCounter = 0;
  private orders = new Map<string, Order>();
  private lastPrices = new Map<string, Ticker>();
  private limitCheckTimer: ReturnType<typeof setInterval> | null = null;
  private connectTime = 0;

  constructor(config: PaperExchangeConfig) {
    this.tracker = new PositionTracker(config.initialBalances);
    this.takerFeeRate = config.takerFeeRate ?? 0.001;
    this.makerFeeRate = config.makerFeeRate ?? 0.001;
    this.slippageRate = config.slippageRate ?? 0.0005;
    this.limitOrderCheckIntervalMs = config.limitOrderCheckIntervalMs ?? 100;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.connected = true;
    this.connectTime = Date.now();
    this.limitCheckTimer = setInterval(() => this.checkLimitOrders(), this.limitOrderCheckIntervalMs);
    this.emit({ type: "connected", exchange: "paper" });
  }

  async disconnect(): Promise<void> {
    if (this.limitCheckTimer) {
      clearInterval(this.limitCheckTimer);
      this.limitCheckTimer = null;
    }
    this.connected = false;
    this.emit({ type: "disconnected", exchange: "paper", reason: "manual disconnect" });
  }

  health(): ConnectorHealth {
    return {
      exchange: "paper",
      status: this.connected ? "connected" : "disconnected",
      restLatencyMs: 0,
      wsConnected: this.connected,
      rateLimitRemaining: 100,
      lastHeartbeat: this.connected ? Date.now() : null,
      errors24h: 0,
    };
  }

  // ─── Market Data ──────────────────────────────────────────────────────

  async subscribe(_subscriptions: MarketDataSubscription[]): Promise<void> {
    // Paper exchange doesn't have real websocket feeds.
    // Market data is fed externally via feedTicker() / feedCandle().
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    // No-op for paper trading
  }

  async getCandles(_symbol: string, _timeframe: TimeFrame, _limit?: number): Promise<Candle[]> {
    // Paper exchange doesn't store historical candles.
    // Use a real exchange connector or data provider for backtesting.
    return [];
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const ticker = this.lastPrices.get(symbol);
    if (!ticker) throw new Error(`No price data for ${symbol}. Feed a ticker first.`);
    return ticker;
  }

  async getOrderBook(symbol: string, depth = 5): Promise<OrderBookSnapshot> {
    // Synthesize a simple order book from the last ticker
    const ticker = this.lastPrices.get(symbol);
    if (!ticker) throw new Error(`No price data for ${symbol}`);

    const spread = ticker.price * 0.001; // 0.1% synthetic spread
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];

    for (let i = 0; i < depth; i++) {
      bids.push({ price: ticker.bid - i * spread, quantity: 1 + Math.random() * 5 });
      asks.push({ price: ticker.ask + i * spread, quantity: 1 + Math.random() * 5 });
    }

    return { symbol, bids, asks, timestamp: Date.now() };
  }

  // ─── External Price Feed ──────────────────────────────────────────────

  /**
   * Feed a live ticker into the paper exchange. This drives order matching
   * and position valuation. Call this from your market data subscription
   * on a real exchange connector.
   */
  feedTicker(ticker: Ticker): void {
    this.lastPrices.set(ticker.symbol, ticker);
    this.emit({ type: "market_data", event: { type: "ticker", data: ticker } });
    // Check if any limit orders can now be filled
    this.checkLimitOrders();
  }

  // ─── Order Management ─────────────────────────────────────────────────

  async placeOrder(request: OrderRequest): Promise<Order> {
    this.ensureConnected();

    const now = Date.now();
    const orderId = `paper-${++this.orderCounter}-${now}`;

    const order: Order = {
      id: orderId,
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      status: "pending",
      quantity: request.quantity,
      filledQuantity: 0,
      price: request.price,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(orderId, order);

    if (request.type === "market") {
      this.executeMarketOrder(order);
    } else if (request.type === "limit") {
      if (!request.price) {
        order.status = "rejected";
        order.updatedAt = Date.now();
        this.emitOrderUpdate(order);
        throw new Error("Limit order requires a price");
      }
      // Lock funds for limit orders
      const lockAsset = this.getLockAsset(request);
      const lockAmount = this.getLockAmount(request);
      if (!this.tracker.lockFunds(lockAsset, lockAmount)) {
        order.status = "rejected";
        order.updatedAt = Date.now();
        this.emitOrderUpdate(order);
        throw new Error(`Insufficient ${lockAsset} balance for limit order`);
      }
      order.status = "open";
      order.updatedAt = Date.now();
      this.emitOrderUpdate(order);
      // Immediately check if limit order is already fillable
      this.tryFillLimitOrder(order);
    }

    return { ...order };
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<Order> {
    this.ensureConnected();

    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== "open" && order.status !== "partially_filled") {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }

    // Unlock remaining funds
    const remainingQty = order.quantity - order.filledQuantity;
    const lockAsset = this.getLockAsset(order);
    if (order.type === "limit" && order.price) {
      const unlockAmount = order.side === "buy"
        ? remainingQty * order.price
        : remainingQty;
      this.tracker.unlockFunds(lockAsset, unlockAmount);
    }

    order.status = "cancelled";
    order.updatedAt = Date.now();
    this.emitOrderUpdate(order);

    return { ...order };
  }

  async getOrder(orderId: string, _symbol: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return { ...order };
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const openStatuses = new Set(["pending", "open", "partially_filled"]);
    const result: Order[] = [];
    for (const order of this.orders.values()) {
      if (!openStatuses.has(order.status)) continue;
      if (symbol && order.symbol !== symbol) continue;
      result.push({ ...order });
    }
    return result;
  }

  // ─── Account ──────────────────────────────────────────────────────────

  async getBalances(): Promise<Balance[]> {
    return this.tracker.getAllBalances();
  }

  async getPositions(): Promise<Position[]> {
    return this.tracker.getAllPositions(this.getCurrentPrices());
  }

  // ─── Events ───────────────────────────────────────────────────────────

  on(handler: ConnectorEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: ConnectorEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  /** Get all completed fills for analysis / audit. */
  getFills() {
    return this.tracker.getFills();
  }

  /** Get total number of orders placed. */
  getOrderCount(): number {
    return this.orders.size;
  }

  /** Get all orders (all statuses). */
  getAllOrders(): Order[] {
    return [...this.orders.values()].map((o) => ({ ...o }));
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.connected) throw new Error("Paper exchange is not connected");
  }

  private executeMarketOrder(order: Order): void {
    const ticker = this.lastPrices.get(order.symbol);
    if (!ticker) {
      order.status = "rejected";
      order.updatedAt = Date.now();
      this.emitOrderUpdate(order);
      return;
    }

    // Apply slippage: buy at ask + slippage, sell at bid - slippage
    const basePrice = order.side === "buy" ? ticker.ask : ticker.bid;
    const slippageMultiplier = order.side === "buy"
      ? 1 + this.slippageRate
      : 1 - this.slippageRate;
    const fillPrice = basePrice * slippageMultiplier;
    const fee = order.quantity * fillPrice * this.takerFeeRate;

    const success = this.tracker.processFill({
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: fillPrice,
      fee,
      timestamp: Date.now(),
    });

    if (!success) {
      order.status = "rejected";
      order.updatedAt = Date.now();
      this.emitOrderUpdate(order);
      return;
    }

    order.status = "filled";
    order.filledQuantity = order.quantity;
    order.avgFillPrice = fillPrice;
    order.updatedAt = Date.now();
    this.emitOrderUpdate(order);
  }

  private tryFillLimitOrder(order: Order): void {
    if (order.status !== "open" && order.status !== "partially_filled") return;
    if (!order.price) return;

    const ticker = this.lastPrices.get(order.symbol);
    if (!ticker) return;

    // Check if limit price is reached
    const canFill =
      (order.side === "buy" && ticker.ask <= order.price) ||
      (order.side === "sell" && ticker.bid >= order.price);

    if (!canFill) return;

    const remainingQty = order.quantity - order.filledQuantity;
    const fillPrice = order.price; // Limit orders fill at limit price
    const fee = remainingQty * fillPrice * this.makerFeeRate;

    // Unlock the locked funds before processing the fill
    const lockAsset = this.getLockAsset(order);
    const unlockAmount = order.side === "buy"
      ? remainingQty * order.price
      : remainingQty;
    this.tracker.unlockFunds(lockAsset, unlockAmount);

    const success = this.tracker.processFill({
      symbol: order.symbol,
      side: order.side,
      quantity: remainingQty,
      price: fillPrice,
      fee,
      timestamp: Date.now(),
    });

    if (!success) {
      // Re-lock if fill failed
      this.tracker.lockFunds(lockAsset, unlockAmount);
      return;
    }

    order.filledQuantity = order.quantity;
    order.avgFillPrice = fillPrice;
    order.status = "filled";
    order.updatedAt = Date.now();
    this.emitOrderUpdate(order);
  }

  private checkLimitOrders(): void {
    for (const order of this.orders.values()) {
      if (order.status === "open" || order.status === "partially_filled") {
        this.tryFillLimitOrder(order);
      }
    }
  }

  private getLockAsset(order: { symbol: string; side: string }): string {
    const [base, quote] = order.symbol.split("/");
    return order.side === "buy" ? quote : base;
  }

  private getLockAmount(request: OrderRequest): number {
    if (request.side === "buy" && request.price) {
      return request.quantity * request.price;
    }
    return request.quantity;
  }

  private getCurrentPrices(): Map<string, number> {
    const prices = new Map<string, number>();
    for (const [symbol, ticker] of this.lastPrices) {
      prices.set(symbol, ticker.price);
    }
    return prices;
  }

  private emit(event: ConnectorEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors crash the engine
      }
    }
  }

  private emitOrderUpdate(order: Order): void {
    this.emit({ type: "order_update", order: { ...order } });
  }
}
