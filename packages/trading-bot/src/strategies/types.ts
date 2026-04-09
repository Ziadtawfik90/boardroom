/**
 * Strategy Interface Contract
 *
 * All trading strategies must implement this interface.
 * Strategies receive market data and emit trade signals.
 */

import type { Ticker, OrderRequest } from "../exchange/types.js";

export type Signal = "buy" | "sell" | "hold";

export interface StrategyConfig {
  symbol: string;
  /** Max fraction of portfolio to risk per trade (0-1) */
  maxPositionPct: number;
}

export interface StrategyState {
  name: string;
  signal: Signal;
  confidence: number;    // 0-1
  indicators: Record<string, number>;
}

export interface Strategy {
  readonly name: string;
  /** Feed a new price tick; returns a signal */
  onTick(ticker: Ticker): Signal;
  /** Generate an order request if signal is actionable, null if hold */
  getOrder(ticker: Ticker, availableBalance: number): OrderRequest | null;
  /** Current strategy state for logging/debugging */
  getState(): StrategyState;
  /** Reset internal state */
  reset(): void;
}
