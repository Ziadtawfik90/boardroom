/**
 * Backtesting Infrastructure — Type Definitions
 *
 * Core types for the backtesting engine, strategy interface,
 * performance metrics, and validation protocols.
 */

import type { Candle, OrderSide, TimeFrame } from "../exchange/types.js";

// ─── Strategy Interface ─────────────────────────────────────────────

export interface StrategySignal {
  action: "buy" | "sell" | "hold";
  /** Fraction of available capital to use (0-1). Default: 1 */
  size?: number;
  /** Optional reason for logging/debugging */
  reason?: string;
}

export interface StrategyContext {
  /** Current candle being evaluated */
  candle: Candle;
  /** All candles up to and including current (most recent last) */
  history: Candle[];
  /** Current position quantity (positive = long, 0 = flat) */
  positionSize: number;
  /** Current equity (cash + position value) */
  equity: number;
  /** Available cash for new orders */
  availableCash: number;
}

export interface BacktestStrategy {
  /** Unique name for this strategy */
  readonly name: string;
  /** Called before backtest starts — reset internal state */
  reset(): void;
  /** Produce a signal for the current candle */
  onCandle(ctx: StrategyContext): StrategySignal;
}

// ─── Backtest Configuration ─────────────────────────────────────────

export interface BacktestConfig {
  /** Symbol to trade, e.g. "BTC/USDT" */
  symbol: string;
  /** Timeframe of the candle data */
  timeframe: TimeFrame;
  /** Starting capital in quote currency */
  initialCapital: number;
  /** Taker fee as fraction (default: 0.001 = 0.1%) */
  takerFeePct?: number;
  /** Slippage as fraction (default: 0.0005 = 0.05%) */
  slippagePct?: number;
}

// ─── Trade Record ───────────────────────────────────────────────────

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;          // net P&L after fees
  pnlPct: number;       // return as fraction
  fees: number;
  holdingPeriodBars: number;
}

// ─── Equity Snapshot ────────────────────────────────────────────────

export interface EquityPoint {
  timestamp: number;
  equity: number;
  cash: number;
  positionValue: number;
  drawdown: number;     // current drawdown as fraction (0 to -1)
}

// ─── Performance Metrics ────────────────────────────────────────────

export interface PerformanceMetrics {
  // Returns
  totalReturn: number;           // net return as fraction
  totalReturnPct: number;        // net return as percentage
  annualizedReturn: number;      // CAGR as fraction
  annualizedReturnPct: number;

  // Risk
  maxDrawdown: number;           // worst peak-to-trough as fraction (negative)
  maxDrawdownPct: number;
  maxDrawdownDuration: number;   // bars in worst drawdown
  volatility: number;            // annualized std dev of returns
  downsideDeviation: number;     // annualized downside deviation

  // Risk-Adjusted
  sharpeRatio: number;           // (return - riskFree) / volatility
  sortinoRatio: number;          // (return - riskFree) / downsideDeviation
  calmarRatio: number;           // annualized return / |maxDrawdown|

  // Trade Statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;               // fraction 0-1
  profitFactor: number;          // gross profit / gross loss
  avgWin: number;                // average winning trade P&L
  avgLoss: number;               // average losing trade P&L (negative)
  avgWinPct: number;
  avgLossPct: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingPeriod: number;      // bars
  expectancy: number;            // avg $ per trade

  // Fees
  totalFees: number;

  // Time
  startTime: number;
  endTime: number;
  totalBars: number;
  exposureTime: number;          // fraction of time in market
}

// ─── Backtest Result ────────────────────────────────────────────────

export interface BacktestResult {
  strategyName: string;
  config: BacktestConfig;
  metrics: PerformanceMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
}

// ─── Walk-Forward Window ────────────────────────────────────────────

export interface WalkForwardWindow {
  /** In-sample (training) period */
  inSample: { start: number; end: number };
  /** Out-of-sample (validation) period */
  outOfSample: { start: number; end: number };
}

export interface WalkForwardResult {
  windows: Array<{
    window: WalkForwardWindow;
    inSampleMetrics: PerformanceMetrics;
    outOfSampleMetrics: PerformanceMetrics;
  }>;
  /** Combined out-of-sample metrics (stitched OOS periods) */
  combinedOosMetrics: PerformanceMetrics;
  /** Overfitting score: 0 = no overfitting, 1 = complete overfitting */
  overfitScore: number;
  /** IS Sharpe / OOS Sharpe ratio — values >> 1 indicate overfitting */
  sharpeDecayRatio: number;
}

// ─── Market Regime ──────────────────────────────────────────────────

export type MarketRegime = "bull" | "bear" | "sideways";

export interface RegimeSegment {
  regime: MarketRegime;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  returnPct: number;
  volatility: number;
}

export interface RegimeAnalysis {
  segments: RegimeSegment[];
  metricsPerRegime: Record<MarketRegime, PerformanceMetrics | null>;
}
