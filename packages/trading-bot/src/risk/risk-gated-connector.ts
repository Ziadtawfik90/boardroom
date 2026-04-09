/**
 * Risk-Gated Exchange Connector
 *
 * Wraps any ExchangeConnector with mandatory risk checks. Strategies
 * interact with this instead of the raw connector, making it IMPOSSIBLE
 * to place orders that violate risk constraints.
 *
 * This is the enforcement boundary — the strategy never sees the raw
 * connector, so it cannot bypass risk controls.
 */

import type {
  ExchangeConnector,
  Exchange,
  TimeFrame,
  Candle,
  Ticker,
  OrderBookSnapshot,
  MarketDataSubscription,
  OrderRequest,
  Order,
  Balance,
  Position,
  ConnectorHealth,
  ConnectorEventHandler,
} from "../exchange/types.js";
import type { RiskManager } from "./risk-manager.js";

export class RiskGatedConnector implements ExchangeConnector {
  readonly exchange: Exchange;
  private lastPrices = new Map<string, number>();

  constructor(
    private readonly inner: ExchangeConnector,
    private readonly risk: RiskManager,
  ) {
    this.exchange = inner.exchange;

    // Track prices from market data events for risk checks
    inner.on((event) => {
      if (event.type === "market_data" && event.event.type === "ticker") {
        this.lastPrices.set(event.event.data.symbol, event.event.data.price);
      }
    });
  }

  // ─── Lifecycle (pass-through) ─────────────────────────────────────

  connect(): Promise<void> { return this.inner.connect(); }
  disconnect(): Promise<void> { return this.inner.disconnect(); }
  health(): ConnectorHealth { return this.inner.health(); }

  // ─── Market Data (pass-through) ───────────────────────────────────

  subscribe(subscriptions: MarketDataSubscription[]): Promise<void> {
    return this.inner.subscribe(subscriptions);
  }

  unsubscribe(symbols: string[]): Promise<void> {
    return this.inner.unsubscribe(symbols);
  }

  getCandles(symbol: string, timeframe: TimeFrame, limit?: number): Promise<Candle[]> {
    return this.inner.getCandles(symbol, timeframe, limit);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const ticker = await this.inner.getTicker(symbol);
    this.lastPrices.set(ticker.symbol, ticker.price);
    return ticker;
  }

  getOrderBook(symbol: string, depth?: number): Promise<OrderBookSnapshot> {
    return this.inner.getOrderBook(symbol, depth);
  }

  // ─── Order Management (GATED by RiskManager) ─────────────────────

  async placeOrder(request: OrderRequest): Promise<Order> {
    // Get current state for risk evaluation
    const [balances, positions] = await Promise.all([
      this.inner.getBalances(),
      this.inner.getPositions(),
    ]);

    const currentPrice = this.lastPrices.get(request.symbol)
      ?? request.price
      ?? 0;

    // Run risk check — this is the enforcement point
    const check = this.risk.checkOrder(request, currentPrice, positions, balances);
    if (!check.allowed) {
      throw new RiskRejectedError(
        check.reason!,
        check.details ?? "Order rejected by risk manager",
        request,
      );
    }

    // Risk check passed — execute and record
    const order = await this.inner.placeOrder(request);
    this.risk.recordOrderPlaced(request.symbol);
    return order;
  }

  cancelOrder(orderId: string, symbol: string): Promise<Order> {
    return this.inner.cancelOrder(orderId, symbol);
  }

  getOrder(orderId: string, symbol: string): Promise<Order> {
    return this.inner.getOrder(orderId, symbol);
  }

  getOpenOrders(symbol?: string): Promise<Order[]> {
    return this.inner.getOpenOrders(symbol);
  }

  // ─── Account (pass-through) ───────────────────────────────────────

  getBalances(): Promise<Balance[]> { return this.inner.getBalances(); }
  getPositions(): Promise<Position[]> { return this.inner.getPositions(); }

  // ─── Events (pass-through) ────────────────────────────────────────

  on(handler: ConnectorEventHandler): void { this.inner.on(handler); }
  off(handler: ConnectorEventHandler): void { this.inner.off(handler); }

  // ─── Risk Access (read-only) ──────────────────────────────────────

  getRiskManager(): RiskManager {
    return this.risk;
  }
}

// ─── Risk Rejection Error ─────────────────────────────────────────

export class RiskRejectedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly details: string,
    public readonly request: OrderRequest,
  ) {
    super(`Risk rejected: [${reason}] ${details}`);
    this.name = "RiskRejectedError";
  }
}
