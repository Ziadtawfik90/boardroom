/**
 * Strategy Engine — Interface Contracts
 *
 * All trading strategies must implement the Strategy interface.
 * The engine manages lifecycle, feeds market data, and collects signals.
 */

import type { Ticker, Candle, OrderBookSnapshot, Position, Balance, TimeFrame } from "../exchange/types.js";

// ─── Signal Types ───────────────────────────────────────────────────

export type SignalAction = "buy" | "sell" | "hold";

export interface Signal {
  action: SignalAction;
  symbol: string;
  /** Suggested quantity as a fraction of available capital (0-1) */
  strength: number;
  /** Why this signal was generated — for logging/debugging */
  reason: string;
  /** Strategy-specific metadata */
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ─── Market Snapshot ────────────────────────────────────────────────

/** Everything a strategy can see when making a decision */
export interface MarketSnapshot {
  symbol: string;
  ticker: Ticker;
  candles: Candle[];
  orderBook?: OrderBookSnapshot;
  positions: Position[];
  balances: Balance[];
  timestamp: number;
}

// ─── Strategy Configuration ─────────────────────────────────────────

export interface StrategyConfig {
  /** Unique identifier for this strategy instance */
  id: string;
  /** Trading pairs this strategy operates on */
  symbols: string[];
  /** Timeframe for candle data */
  timeframe: TimeFrame;
  /** Strategy-specific parameters */
  params: Record<string, unknown>;
}

// ─── Strategy Interface ─────────────────────────────────────────────

export interface Strategy {
  /** Unique name for this strategy type */
  readonly name: string;
  /** Configuration for this instance */
  readonly config: StrategyConfig;

  /**
   * Called once when the strategy is registered with the engine.
   * Use for initialization, indicator warmup, etc.
   */
  initialize(): Promise<void>;

  /**
   * Evaluate current market conditions and produce a signal.
   * Called by the engine on each tick or candle close.
   */
  evaluate(snapshot: MarketSnapshot): Signal;

  /**
   * Called when the strategy is removed from the engine.
   * Clean up any resources.
   */
  destroy(): void;
}

// ─── Strategy Factory ───────────────────────────────────────────────

export type StrategyFactory = (config: StrategyConfig) => Strategy;

// ─── Engine Events ──────────────────────────────────────────────────

export type StrategyEngineEvent =
  | { type: "signal"; strategyId: string; signal: Signal }
  | { type: "strategy_added"; strategyId: string; name: string }
  | { type: "strategy_removed"; strategyId: string }
  | { type: "error"; strategyId: string; message: string };

export type StrategyEngineEventHandler = (event: StrategyEngineEvent) => void;
