/**
 * Risk Manager — Immutable Guardrails
 *
 * The risk layer is infrastructure, not a suggestion. The ML model
 * cannot override, disable, or reconfigure these limits. They exist
 * to prevent catastrophic loss in all market conditions.
 *
 * Enforces:
 *   - Max position size as fraction of portfolio
 *   - Max portfolio drawdown (kill switch)
 *   - Max simultaneous open positions
 *   - Max daily loss limit
 *   - Trade cooldown per symbol
 *   - Emergency kill switch
 */

import type { Balance, Position } from "../exchange/types.js";
import type { Signal, SignalDirection } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────

export interface RiskLimits {
  /** Max fraction of portfolio in a single position (0–1). Default: 0.1 (10%) */
  maxPositionSize: number;
  /** Max portfolio drawdown before kill switch (0–1). Default: 0.15 (15%) */
  maxDrawdown: number;
  /** Max simultaneous open positions. Default: 5 */
  maxOpenPositions: number;
  /** Max daily loss as fraction of starting equity (0–1). Default: 0.05 (5%) */
  maxDailyLoss: number;
  /** Minimum seconds between trades on same symbol. Default: 60 */
  minTradeCooldownSec: number;
}

const DEFAULT_LIMITS: RiskLimits = {
  maxPositionSize: 0.10,
  maxDrawdown: 0.15,
  maxOpenPositions: 5,
  maxDailyLoss: 0.05,
  minTradeCooldownSec: 60,
};

// ─── Risk Decision ──────────────────────────────────────────────────

export interface RiskDecision {
  /** Whether the trade is allowed */
  allowed: boolean;
  /** Adjusted signal strength (may be reduced by risk limits) */
  adjustedStrength: number;
  /** Human-readable reason for the decision */
  reason: string;
  /** Which rule triggered the block, if any */
  rule?: string;
}

// ─── Manager ────────────────────────────────────────────────────────

export class RiskManager {
  /** Limits are frozen at construction — no runtime modification */
  private readonly limits: Readonly<RiskLimits>;

  private startOfDayEquity: number = 0;
  private currentDayStart: number = 0;
  private dailyPnl: number = 0;
  private peakEquity: number = 0;
  private killed: boolean = false;
  private lastTradeTime = new Map<string, number>();

  constructor(limits: Partial<RiskLimits> = {}) {
    // Freeze limits — they cannot be modified after construction
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
  }

  /**
   * Initialize the risk manager with current portfolio state.
   * Must be called before any trading begins.
   */
  initialize(totalEquity: number): void {
    this.startOfDayEquity = totalEquity;
    this.peakEquity = totalEquity;
    this.currentDayStart = this.startOfDay(Date.now());
    this.dailyPnl = 0;
    this.killed = false;
  }

  /**
   * Check whether a proposed trade passes all risk rules.
   * This is the single gate — every signal must pass through here.
   */
  check(
    signal: Signal,
    positions: Position[],
    balances: Balance[],
  ): RiskDecision {
    // Kill switch — nothing gets through
    if (this.killed) {
      return {
        allowed: false,
        adjustedStrength: 0,
        reason: "KILL SWITCH ACTIVE — all trading halted",
        rule: "kill_switch",
      };
    }

    // Hold signals always pass (no trade to risk-check)
    if (signal.direction === "neutral") {
      return { allowed: true, adjustedStrength: 0, reason: "hold — no risk check needed" };
    }

    // Reset daily P&L if new day
    this.maybeResetDailyPnl();

    const totalEquity = this.computeEquity(balances, positions);
    this.peakEquity = Math.max(this.peakEquity, totalEquity);

    // ── 1. Max drawdown check ──────────────────────────────────
    const drawdown = this.peakEquity > 0
      ? (this.peakEquity - totalEquity) / this.peakEquity
      : 0;

    if (drawdown >= this.limits.maxDrawdown) {
      this.killed = true;
      return {
        allowed: false,
        adjustedStrength: 0,
        reason: `Max drawdown breached: ${(drawdown * 100).toFixed(1)}% >= ${(this.limits.maxDrawdown * 100).toFixed(1)}% — KILL SWITCH ACTIVATED`,
        rule: "max_drawdown",
      };
    }

    // ── 2. Daily loss limit ────────────────────────────────────
    const dailyLossPct = this.startOfDayEquity > 0
      ? Math.max(0, -this.dailyPnl) / this.startOfDayEquity
      : 0;

    if (dailyLossPct >= this.limits.maxDailyLoss) {
      return {
        allowed: false,
        adjustedStrength: 0,
        reason: `Daily loss limit reached: ${(dailyLossPct * 100).toFixed(1)}% >= ${(this.limits.maxDailyLoss * 100).toFixed(1)}%`,
        rule: "max_daily_loss",
      };
    }

    // ── 3. Max open positions ──────────────────────────────────
    const openPositions = positions.filter((p) => p.quantity > 0);
    const isNewPosition = !openPositions.some((p) => p.symbol === signal.symbol);

    if (isNewPosition && openPositions.length >= this.limits.maxOpenPositions) {
      return {
        allowed: false,
        adjustedStrength: 0,
        reason: `Max open positions reached: ${openPositions.length}/${this.limits.maxOpenPositions}`,
        rule: "max_open_positions",
      };
    }

    // ── 4. Trade cooldown ──────────────────────────────────────
    const lastTrade = this.lastTradeTime.get(signal.symbol);
    if (lastTrade !== undefined) {
      const elapsedSec = (Date.now() - lastTrade) / 1000;
      if (elapsedSec < this.limits.minTradeCooldownSec) {
        return {
          allowed: false,
          adjustedStrength: 0,
          reason: `Cooldown active for ${signal.symbol}: ${elapsedSec.toFixed(0)}s / ${this.limits.minTradeCooldownSec}s`,
          rule: "trade_cooldown",
        };
      }
    }

    // ── 5. Position size cap ───────────────────────────────────
    let adjustedStrength = signal.strength;
    const maxSize = this.limits.maxPositionSize;

    // If signal strength would create a position larger than the limit, cap it
    if (adjustedStrength > maxSize) {
      adjustedStrength = maxSize;
    }

    // Reduce size further if approaching drawdown or daily loss limits
    const drawdownProximity = drawdown / this.limits.maxDrawdown; // 0..1
    const dailyLossProximity = dailyLossPct / this.limits.maxDailyLoss;
    const riskProximity = Math.max(drawdownProximity, dailyLossProximity);

    if (riskProximity > 0.5) {
      // Linearly reduce size as we approach limits
      const reduction = 1 - (riskProximity - 0.5) * 2; // 1.0 at 50%, 0.0 at 100%
      adjustedStrength *= Math.max(0.1, reduction); // never reduce below 10% of intended
    }

    return {
      allowed: true,
      adjustedStrength,
      reason: `approved (drawdown=${(drawdown * 100).toFixed(1)}%, dailyLoss=${(dailyLossPct * 100).toFixed(1)}%, positions=${openPositions.length})`,
    };
  }

  /** Record that a trade was executed on a symbol */
  recordTrade(symbol: string, pnl: number = 0): void {
    this.lastTradeTime.set(symbol, Date.now());
    this.dailyPnl += pnl;
  }

  /** Record P&L from a closed position */
  recordPnl(pnl: number): void {
    this.dailyPnl += pnl;
  }

  /** Manually activate the kill switch */
  activateKillSwitch(reason: string): void {
    this.killed = true;
    // Log reason but don't expose it to override logic
    void reason;
  }

  /** Reset the kill switch (requires explicit call — never automatic) */
  resetKillSwitch(): void {
    this.killed = false;
    this.peakEquity = 0; // reset peak to current
  }

  /** Whether the kill switch is currently active */
  isKilled(): boolean {
    return this.killed;
  }

  /** Get current risk state for monitoring */
  getState(): {
    killed: boolean;
    dailyPnl: number;
    peakEquity: number;
    startOfDayEquity: number;
    limits: Readonly<RiskLimits>;
  } {
    return {
      killed: this.killed,
      dailyPnl: this.dailyPnl,
      peakEquity: this.peakEquity,
      startOfDayEquity: this.startOfDayEquity,
      limits: this.limits,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private computeEquity(balances: Balance[], positions: Position[]): number {
    // Sum all balance values (assumes quote currency is the base unit)
    let equity = 0;
    for (const b of balances) {
      equity += b.total;
    }
    // Add unrealized P&L from open positions
    for (const p of positions) {
      equity += p.unrealizedPnl;
    }
    return equity;
  }

  private maybeResetDailyPnl(): void {
    const today = this.startOfDay(Date.now());
    if (today > this.currentDayStart) {
      this.startOfDayEquity += this.dailyPnl; // carry forward
      this.dailyPnl = 0;
      this.currentDayStart = today;
    }
  }

  private startOfDay(timestamp: number): number {
    const d = new Date(timestamp);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
}
