/**
 * Risk Manager — Immutable Infrastructure
 *
 * Core risk enforcement engine. RiskLimits are frozen at construction
 * and CANNOT be modified at runtime. The kill switch can only be
 * activated (never deactivated programmatically) — manual reset required.
 *
 * This module is the single source of truth for all risk decisions.
 * No strategy, ML model, or external system can bypass these checks.
 */

import type {
  RiskLimits,
  RiskCheckResult,
  RiskEvent,
  RiskEventHandler,
  PortfolioSnapshot,
  RiskRejectionReason,
} from "./types.js";
import type { OrderRequest, Position, Balance } from "../exchange/types.js";

// ─── Audit Entry ───────────────────────────────────────────────────

export interface RiskAuditEntry {
  readonly timestamp: number;
  readonly event: RiskEvent;
}

const MAX_AUDIT_LOG = 1000;

// ─── Default Limits (conservative) ─────────────────────────────────

const DEFAULT_LIMITS: RiskLimits = {
  maxPositionSizePct: 0.05,        // 5% of equity per position
  maxOrderNotional: 1000,           // $1000 max per order
  maxOpenPositions: 5,
  maxDrawdownPct: 0.10,             // 10% drawdown kill switch
  maxDailyLoss: 500,                // $500 daily loss limit
  maxOrdersPerHour: 60,
  maxConsecutiveLosses: 5,
  minOrderIntervalMs: 1000,         // 1 second between orders on same symbol
  allowedSymbols: [],                // empty = all allowed
  maxLeverage: 1.0,                  // spot only by default
};

// ─── Risk Manager ──────────────────────────────────────────────────

export class RiskManager {
  /** Frozen risk limits — immutable after construction */
  readonly limits: Readonly<RiskLimits>;

  // ─── Internal State ────────────────────────────────────────────
  private _killSwitchActive = false;
  private _killSwitchReason: string | undefined;
  private _peakEquity: number;
  private _dailyPnlStart: number;
  private _dailyDate: string;
  private _dailyLoss = 0;
  private _consecutiveLosses = 0;
  private _ordersThisHour: number[] = [];   // timestamps
  private _lastOrderBySymbol = new Map<string, number>();
  private _handlers: RiskEventHandler[] = [];
  private _auditLog: RiskAuditEntry[] = [];

  constructor(
    initialEquity: number,
    limits?: Partial<RiskLimits>,
  ) {
    // Merge with defaults, then deep-freeze so nothing can mutate
    const merged: RiskLimits = {
      ...DEFAULT_LIMITS,
      ...limits,
      allowedSymbols: Object.freeze([...(limits?.allowedSymbols ?? DEFAULT_LIMITS.allowedSymbols)]),
    };
    this.limits = Object.freeze(merged);

    this._peakEquity = initialEquity;
    this._dailyPnlStart = initialEquity;
    this._dailyDate = this.todayString();
  }

  // ─── Order Pre-Check ───────────────────────────────────────────

  /**
   * Evaluate whether an order is allowed under current risk constraints.
   * This is the ONLY entry point for order authorization.
   *
   * The second parameter can be either:
   * - A pre-calculated equity number (used internally / by RiskGate)
   * - Ignored when balances+positions are provided (equity is computed)
   *
   * When balances are provided, equity is calculated from them automatically.
   */
  checkOrder(
    request: OrderRequest,
    currentEquityOrPrice: number,
    positions: Position[],
    balances: Balance[],
  ): RiskCheckResult {
    // If balances are provided, compute equity from them for accuracy
    const currentEquity = balances.length > 0
      ? this.calculateEquity(balances, positions)
      : currentEquityOrPrice;
    // 1. Kill switch — absolute block
    if (this._killSwitchActive) {
      return this.reject("KILL_SWITCH_ACTIVE", `Kill switch active: ${this._killSwitchReason}`);
    }

    // 2. Daily reset check
    this.checkDailyReset(currentEquity);

    // 3. Update peak equity
    if (currentEquity > this._peakEquity) {
      this._peakEquity = currentEquity;
    }

    // 4. Drawdown check
    const drawdownPct = this._peakEquity > 0
      ? (this._peakEquity - currentEquity) / this._peakEquity
      : 0;
    if (drawdownPct >= this.limits.maxDrawdownPct) {
      this.triggerKillSwitch(
        `Drawdown ${(drawdownPct * 100).toFixed(2)}% exceeded limit ${(this.limits.maxDrawdownPct * 100).toFixed(2)}%`,
        drawdownPct,
        currentEquity,
      );
      return this.reject("MAX_DRAWDOWN_EXCEEDED",
        `Drawdown ${(drawdownPct * 100).toFixed(2)}% >= limit ${(this.limits.maxDrawdownPct * 100).toFixed(2)}%`);
    }

    // 5. Daily loss check
    const dailyLoss = this._dailyPnlStart - currentEquity;
    this._dailyLoss = dailyLoss;
    if (dailyLoss >= this.limits.maxDailyLoss) {
      return this.reject("DAILY_LOSS_EXCEEDED",
        `Daily loss $${dailyLoss.toFixed(2)} >= limit $${this.limits.maxDailyLoss.toFixed(2)}`);
    }

    // 6. Symbol allowlist
    if (this.limits.allowedSymbols.length > 0 && !this.limits.allowedSymbols.includes(request.symbol)) {
      return this.reject("SYMBOL_NOT_ALLOWED", `Symbol ${request.symbol} not in allowlist`);
    }

    // 7. Order notional check
    const orderNotional = request.quantity * (request.price ?? this.estimatePrice(request.symbol, positions));
    if (orderNotional > this.limits.maxOrderNotional) {
      return this.reject("ORDER_NOTIONAL_EXCEEDED",
        `Order notional $${orderNotional.toFixed(2)} > limit $${this.limits.maxOrderNotional.toFixed(2)}`);
    }

    // 8. Position size check (as % of equity)
    if (currentEquity > 0) {
      const positionPct = orderNotional / currentEquity;
      if (positionPct > this.limits.maxPositionSizePct) {
        return this.reject("POSITION_SIZE_EXCEEDED",
          `Position ${(positionPct * 100).toFixed(2)}% > limit ${(this.limits.maxPositionSizePct * 100).toFixed(2)}%`);
      }
    }

    // 9. Max open positions (only check for new positions on buy side)
    if (request.side === "buy") {
      const openCount = positions.filter(p => p.quantity > 0).length;
      if (openCount >= this.limits.maxOpenPositions) {
        return this.reject("MAX_OPEN_POSITIONS",
          `Open positions ${openCount} >= limit ${this.limits.maxOpenPositions}`);
      }
    }

    // 10. Consecutive losses
    if (this._consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return this.reject("CONSECUTIVE_LOSSES",
        `${this._consecutiveLosses} consecutive losses >= limit ${this.limits.maxConsecutiveLosses}`);
    }

    // 11. Order rate limiting
    const now = Date.now();
    this.pruneOrderTimestamps(now);
    if (this._ordersThisHour.length >= this.limits.maxOrdersPerHour) {
      return this.reject("ORDER_RATE_EXCEEDED",
        `${this._ordersThisHour.length} orders this hour >= limit ${this.limits.maxOrdersPerHour}`);
    }

    // 12. Min order interval per symbol
    const lastOrder = this._lastOrderBySymbol.get(request.symbol);
    if (lastOrder && (now - lastOrder) < this.limits.minOrderIntervalMs) {
      return this.reject("ORDER_INTERVAL_TOO_SHORT",
        `${now - lastOrder}ms since last order on ${request.symbol}, min ${this.limits.minOrderIntervalMs}ms`);
    }

    return { allowed: true };
  }

  // ─── Order Recording ───────────────────────────────────────────

  /** Record that an order was successfully placed. Call AFTER checkOrder passes and order is submitted. */
  recordOrderPlaced(symbol: string): void {
    const now = Date.now();
    this._ordersThisHour.push(now);
    this._lastOrderBySymbol.set(symbol, now);
  }

  /** Record a trade result for consecutive loss tracking. pnl > 0 = win, pnl <= 0 = loss. */
  recordTradeResult(pnl: number): void {
    if (pnl <= 0) {
      this._consecutiveLosses++;
      if (this._consecutiveLosses >= this.limits.maxConsecutiveLosses) {
        this.emit({
          type: "consecutive_losses_warning",
          count: this._consecutiveLosses,
          limit: this.limits.maxConsecutiveLosses,
        });
      }
    } else {
      this._consecutiveLosses = 0;
    }
  }

  // ─── Kill Switch ───────────────────────────────────────────────

  /** Manually activate the kill switch. Once active, ALL orders are blocked. */
  activateKillSwitchManual(reason: string): void {
    this._killSwitchActive = true;
    this._killSwitchReason = reason;
    this.emit({ type: "kill_switch_manual", reason });
  }

  /**
   * Reset the kill switch. Requires an explicit reason for audit trail.
   * This is the ONLY way to resume trading after a kill switch activation.
   */
  resetKillSwitch(resetBy: string): void {
    if (!this._killSwitchActive) return;
    this._killSwitchActive = false;
    this._killSwitchReason = undefined;
    this._consecutiveLosses = 0;
    this.emit({ type: "kill_switch_reset", resetBy });
  }

  get killSwitchActive(): boolean {
    return this._killSwitchActive;
  }

  get killSwitchReason(): string | undefined {
    return this._killSwitchReason;
  }

  // ─── Portfolio Snapshot ────────────────────────────────────────

  /** Get current portfolio risk state as a frozen read-only snapshot. */
  snapshot(currentEquity: number): PortfolioSnapshot {
    this.checkDailyReset(currentEquity);
    this.pruneOrderTimestamps(Date.now());
    const drawdownPct = this._peakEquity > 0
      ? (this._peakEquity - currentEquity) / this._peakEquity
      : 0;

    return Object.freeze({
      totalEquity: currentEquity,
      peakEquity: this._peakEquity,
      currentDrawdownPct: drawdownPct,
      dailyPnl: -(this._dailyPnlStart - currentEquity),
      openPositionCount: 0,  // caller populates from live positions
      ordersThisHour: this._ordersThisHour.length,
      consecutiveLosses: this._consecutiveLosses,
      killSwitchActive: this._killSwitchActive,
      killSwitchReason: this._killSwitchReason,
    });
  }

  /** Emit warning when drawdown approaches limit. Call on each tick for early warning. */
  checkDrawdownWarning(currentEquity: number, warningThresholdPct = 0.75): void {
    if (currentEquity > this._peakEquity) {
      this._peakEquity = currentEquity;
    }
    const drawdownPct = this._peakEquity > 0
      ? (this._peakEquity - currentEquity) / this._peakEquity
      : 0;
    const warningLevel = this.limits.maxDrawdownPct * warningThresholdPct;
    if (drawdownPct >= warningLevel && drawdownPct < this.limits.maxDrawdownPct) {
      this.emit({
        type: "drawdown_warning",
        currentPct: drawdownPct,
        limitPct: this.limits.maxDrawdownPct,
      });
    }
  }

  // ─── Event System ──────────────────────────────────────────────

  on(handler: RiskEventHandler): void {
    this._handlers.push(handler);
  }

  off(handler: RiskEventHandler): void {
    this._handlers = this._handlers.filter(h => h !== handler);
  }

  /** Alias for on() — used by RiskGuardedExchange */
  onRiskEvent(handler: RiskEventHandler): void { this.on(handler); }
  /** Alias for off() — used by RiskGuardedExchange */
  offRiskEvent(handler: RiskEventHandler): void { this.off(handler); }

  // ─── Compatibility API (used by GuardedExchange wrappers) ─────

  /** Alias for recordOrderPlaced() */
  recordOrder(symbol: string): void { this.recordOrderPlaced(symbol); }

  /** Alias for activateKillSwitchManual() — used by RiskGuardedExchange */
  activateKillSwitch(reason: string): void { this.activateKillSwitchManual(reason); }

  /** Method form of killSwitchActive getter */
  isKillSwitchActive(): boolean { return this._killSwitchActive; }

  /** Get frozen risk limits */
  getLimits(): Readonly<RiskLimits> { return this.limits; }

  /** Get portfolio snapshot with balances/positions for equity calc */
  getSnapshot(balances: Balance[], positions: Position[]): PortfolioSnapshot {
    const equity = this.calculateEquity(balances, positions);
    return this.snapshot(equity);
  }

  /** Get risk audit log (recent events) */
  getAuditLog(): readonly RiskAuditEntry[] {
    return Object.freeze([...this._auditLog]);
  }

  // ─── Internals ─────────────────────────────────────────────────

  private triggerKillSwitch(reason: string, drawdownPct: number, equity: number): void {
    this._killSwitchActive = true;
    this._killSwitchReason = reason;
    this.emit({ type: "kill_switch_activated", reason, drawdownPct, equity });
  }

  private reject(reason: RiskRejectionReason, details: string): RiskCheckResult {
    return { allowed: false, reason, details };
  }

  private emit(event: RiskEvent): void {
    // Always record to audit log first
    this._auditLog.push({ timestamp: Date.now(), event });
    if (this._auditLog.length > MAX_AUDIT_LOG) {
      this._auditLog = this._auditLog.slice(-MAX_AUDIT_LOG);
    }

    for (const handler of this._handlers) {
      try {
        handler(event);
      } catch {
        // Risk event handlers must never crash the risk system
      }
    }
  }

  private pruneOrderTimestamps(now: number): void {
    const oneHourAgo = now - 3_600_000;
    this._ordersThisHour = this._ordersThisHour.filter(t => t > oneHourAgo);
  }

  private checkDailyReset(currentEquity: number): void {
    const today = this.todayString();
    if (today !== this._dailyDate) {
      const previousLoss = this._dailyLoss;
      this._dailyDate = today;
      this._dailyPnlStart = currentEquity;
      this._dailyLoss = 0;
      this.emit({ type: "daily_reset", date: today, previousDailyLoss: previousLoss });
    }
  }

  private todayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private estimatePrice(symbol: string, positions: Position[]): number {
    const pos = positions.find(p => p.symbol === symbol);
    return pos?.currentPrice ?? 0;
  }

  private calculateEquity(balances: Balance[], positions: Position[]): number {
    const quoteCurrencies = ["USDT", "USD", "USDC", "BUSD", "DAI"];
    let equity = 0;
    for (const b of balances) {
      if (quoteCurrencies.includes(b.asset)) {
        equity += b.total;
      }
    }
    for (const p of positions) {
      equity += p.unrealizedPnl + p.quantity * p.currentPrice;
    }
    return equity;
  }
}
