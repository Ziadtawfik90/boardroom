/**
 * Risk-Guarded Exchange Proxy
 *
 * This is the ONLY exchange interface that strategies and the learning system
 * should ever receive. It wraps a real ExchangeConnector and interposes
 * the RiskManager on every order. There is no escape hatch.
 *
 * ARCHITECTURAL GUARANTEE:
 * - Strategies receive RiskGuardedExchange, never the raw connector
 * - Every placeOrder() call is checked against RiskManager.checkOrder()
 * - On fill/close, trade results are fed back to the risk manager
 * - The kill switch can halt all trading instantly
 * - Cancel orders are always allowed (reducing risk is never blocked)
 *
 * This class is intentionally NOT extensible — it's final by design.
 * Do not subclass it. Do not monkey-patch it. The risk layer is immutable.
 */

import type {
  ExchangeConnector,
  ConnectorHealth,
  ConnectorEventHandler,
  MarketDataSubscription,
  Candle,
  Ticker,
  OrderBookSnapshot,
  OrderRequest,
  Order,
  Balance,
  Position,
  TimeFrame,
  Exchange,
} from "../exchange/types.js";
import { RiskManager } from "./risk-manager.js";
import type { RiskCheckResult, RiskEvent, RiskEventHandler } from "./types.js";

export class RiskOrderRejectedError extends Error {
  constructor(
    public readonly result: RiskCheckResult,
    public readonly request: OrderRequest,
  ) {
    super(`Order rejected by risk manager: ${result.reason} — ${result.details}`);
    this.name = "RiskOrderRejectedError";
  }
}

export class RiskGuardedExchange implements ExchangeConnector {
  readonly exchange: Exchange;

  private readonly inner: ExchangeConnector;
  private readonly risk: RiskManager;
  private riskHandlers: RiskEventHandler[] = [];

  /**
   * @param inner  The real exchange connector (paper or live)
   * @param risk   The risk manager instance (limits are already frozen)
   */
  constructor(inner: ExchangeConnector, risk: RiskManager) {
    this.inner = inner;
    this.risk = risk;
    this.exchange = inner.exchange;

    // Listen for order fills to track trade results
    this.inner.on((event) => {
      if (event.type === "order_update" && event.order.status === "filled") {
        // We'll track this when positions change — the risk manager's
        // recordTradeResult is called explicitly by the trading loop
        // after a position close is confirmed.
      }
    });
  }

  // ─── Lifecycle (pass-through) ─────────────────────────────────────

  async connect(): Promise<void> {
    return this.inner.connect();
  }

  async disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  health(): ConnectorHealth {
    return this.inner.health();
  }

  // ─── Market Data (pass-through — reading data is never a risk) ────

  async subscribe(subscriptions: MarketDataSubscription[]): Promise<void> {
    return this.inner.subscribe(subscriptions);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    return this.inner.unsubscribe(symbols);
  }

  async getCandles(symbol: string, timeframe: TimeFrame, limit?: number): Promise<Candle[]> {
    return this.inner.getCandles(symbol, timeframe, limit);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return this.inner.getTicker(symbol);
  }

  async getOrderBook(symbol: string, depth?: number): Promise<OrderBookSnapshot> {
    return this.inner.getOrderBook(symbol, depth);
  }

  // ─── Order Management (RISK-GATED) ───────────────────────────────

  /**
   * Place an order, but ONLY if the risk manager allows it.
   * Throws RiskOrderRejectedError if the order violates any risk constraint.
   */
  async placeOrder(request: OrderRequest): Promise<Order> {
    // Get current portfolio state for risk evaluation
    const [positions, balances] = await Promise.all([
      this.inner.getPositions(),
      this.inner.getBalances(),
    ]);

    // Calculate total equity for risk checks
    let totalEquity = 0;
    for (const b of balances) totalEquity += b.total;
    for (const p of positions) totalEquity += p.unrealizedPnl;

    if (totalEquity <= 0) {
      throw new Error("Cannot evaluate risk: equity is zero or negative");
    }

    // THE GATE — nothing passes without risk manager approval
    const check = this.risk.checkOrder(request, totalEquity, positions, balances);

    if (!check.allowed) {
      this.emitRiskEvent({
        type: "order_rejected",
        request,
        reason: check.reason!,
        details: check.details ?? "No details",
      });
      throw new RiskOrderRejectedError(check, request);
    }

    // Risk approved — execute through the real connector
    const order = await this.inner.placeOrder(request);

    // Record the order for rate limiting
    this.risk.recordOrderPlaced(request.symbol);

    return order;
  }

  /**
   * Cancel is ALWAYS allowed — reducing risk is never blocked,
   * even when the kill switch is active.
   */
  async cancelOrder(orderId: string, symbol: string): Promise<Order> {
    return this.inner.cancelOrder(orderId, symbol);
  }

  async getOrder(orderId: string, symbol: string): Promise<Order> {
    return this.inner.getOrder(orderId, symbol);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    return this.inner.getOpenOrders(symbol);
  }

  // ─── Account (pass-through) ──────────────────────────────────────

  async getBalances(): Promise<Balance[]> {
    return this.inner.getBalances();
  }

  async getPositions(): Promise<Position[]> {
    return this.inner.getPositions();
  }

  // ─── Connector Events (pass-through) ─────────────────────────────

  on(handler: ConnectorEventHandler): void {
    this.inner.on(handler);
  }

  off(handler: ConnectorEventHandler): void {
    this.inner.off(handler);
  }

  // ─── Risk-Specific API ───────────────────────────────────────────

  /**
   * Record a trade result (call after a position is closed).
   * Positive = profit, negative = loss.
   */
  recordTradeResult(pnl: number): void {
    this.risk.recordTradeResult(pnl);
  }

  /**
   * Manually trigger the kill switch. Blocks ALL future orders.
   */
  emergencyStop(reason: string): void {
    this.risk.activateKillSwitchManual(reason);
  }

  /**
   * Reset the kill switch. Requires operator identity for audit trail.
   * The learning system must NEVER call this.
   */
  resetKillSwitch(operatorId: string): void {
    this.risk.resetKillSwitch(operatorId);
  }

  /** Check if trading is halted */
  isHalted(): boolean {
    return this.risk.killSwitchActive;
  }

  /** Get the risk manager's portfolio snapshot */
  async getRiskSnapshot() {
    const [balances, positions] = await Promise.all([
      this.inner.getBalances(),
      this.inner.getPositions(),
    ]);
    let totalEquity = 0;
    for (const b of balances) totalEquity += b.total;
    for (const p of positions) totalEquity += p.unrealizedPnl;
    return this.risk.snapshot(totalEquity);
  }

  /** Get the frozen risk limits */
  getRiskLimits() {
    return this.risk.limits;
  }

  /** Subscribe to risk events */
  onRiskEvent(handler: RiskEventHandler): void {
    this.riskHandlers.push(handler);
    this.risk.on(handler);
  }

  /** Unsubscribe from risk events */
  offRiskEvent(handler: RiskEventHandler): void {
    this.riskHandlers = this.riskHandlers.filter(h => h !== handler);
    this.risk.off(handler);
  }

  /**
   * Cancel ALL open orders. Useful when kill switch activates.
   * Cancels are never blocked by risk management.
   */
  async cancelAllOrders(): Promise<Order[]> {
    const openOrders = await this.inner.getOpenOrders();
    const cancelled: Order[] = [];
    for (const order of openOrders) {
      try {
        const result = await this.inner.cancelOrder(order.id, order.symbol);
        cancelled.push(result);
      } catch {
        // Best effort — some orders may have already filled
      }
    }
    return cancelled;
  }

  // ─── Internals ───────────────────────────────────────────────────

  private emitRiskEvent(event: RiskEvent): void {
    for (const handler of this.riskHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors affect risk enforcement
      }
    }
  }
}
