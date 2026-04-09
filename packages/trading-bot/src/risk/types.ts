/**
 * Risk Management Types — Immutable Infrastructure
 *
 * These types define the risk constraints that NO strategy or learning
 * system can override. The RiskLimits are frozen at construction time.
 */

import type { OrderRequest, Position, Balance } from "../exchange/types.js";

// ─── Risk Configuration (frozen at construction) ────────────────────

export interface RiskLimits {
  /** Max % of portfolio equity in a single position (0-1, e.g. 0.05 = 5%) */
  readonly maxPositionSizePct: number;
  /** Max absolute notional value per order in quote currency */
  readonly maxOrderNotional: number;
  /** Max number of concurrent open positions */
  readonly maxOpenPositions: number;
  /** Max drawdown from peak equity before kill switch triggers (0-1, e.g. 0.10 = 10%) */
  readonly maxDrawdownPct: number;
  /** Max daily loss in quote currency before daily kill switch triggers */
  readonly maxDailyLoss: number;
  /** Max number of orders per hour (circuit breaker for runaway strategies) */
  readonly maxOrdersPerHour: number;
  /** Max number of consecutive losses before pause */
  readonly maxConsecutiveLosses: number;
  /** Minimum time between orders on the same symbol (ms) */
  readonly minOrderIntervalMs: number;
  /** Symbols allowed to trade — empty means all allowed */
  readonly allowedSymbols: readonly string[];
  /** Maximum leverage (1.0 = no leverage, spot only) */
  readonly maxLeverage: number;
}

// ─── Risk Check Result ──────────────────────────────────────────────

export type RiskRejectionReason =
  | "KILL_SWITCH_ACTIVE"
  | "MAX_DRAWDOWN_EXCEEDED"
  | "DAILY_LOSS_EXCEEDED"
  | "POSITION_SIZE_EXCEEDED"
  | "ORDER_NOTIONAL_EXCEEDED"
  | "MAX_OPEN_POSITIONS"
  | "ORDER_RATE_EXCEEDED"
  | "CONSECUTIVE_LOSSES"
  | "ORDER_INTERVAL_TOO_SHORT"
  | "SYMBOL_NOT_ALLOWED"
  | "LEVERAGE_EXCEEDED";

export interface RiskCheckResult {
  readonly allowed: boolean;
  readonly reason?: RiskRejectionReason;
  readonly details?: string;
}

// ─── Risk Events ────────────────────────────────────────────────────

export type RiskEvent =
  | { type: "order_rejected"; request: OrderRequest; reason: RiskRejectionReason; details: string }
  | { type: "kill_switch_activated"; reason: string; drawdownPct: number; equity: number }
  | { type: "kill_switch_manual"; reason: string }
  | { type: "kill_switch_reset"; resetBy: string }
  | { type: "daily_reset"; date: string; previousDailyLoss: number }
  | { type: "drawdown_warning"; currentPct: number; limitPct: number }
  | { type: "consecutive_losses_warning"; count: number; limit: number };

export type RiskEventHandler = (event: RiskEvent) => void;

// ─── Portfolio Snapshot ─────────────────────────────────────────────

export interface PortfolioSnapshot {
  readonly totalEquity: number;
  readonly peakEquity: number;
  readonly currentDrawdownPct: number;
  readonly dailyPnl: number;
  readonly openPositionCount: number;
  readonly ordersThisHour: number;
  readonly consecutiveLosses: number;
  readonly killSwitchActive: boolean;
  readonly killSwitchReason?: string;
}
