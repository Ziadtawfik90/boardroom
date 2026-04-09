/**
 * Market Regime Detector
 *
 * Classifies historical candle data into market regimes:
 * - Bull: sustained uptrend with positive returns
 * - Bear: sustained downtrend with negative returns
 * - Sideways: low directional movement, range-bound
 *
 * Uses a combination of rolling returns and volatility to classify.
 * This is critical for validating that strategies don't only work in
 * one regime (classic overfitting signal).
 */

import type { Candle } from "../exchange/types.js";
import type { MarketRegime, RegimeSegment, RegimeAnalysis } from "./types.js";
import type { BacktestResult, PerformanceMetrics, BacktestTrade, EquityPoint } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────

export interface RegimeDetectorConfig {
  /** Rolling window size in bars for return calculation (default: 20) */
  lookbackBars: number;
  /** Annualized return threshold to qualify as bull/bear (default: 0.15 = 15%) */
  trendThreshold: number;
  /** Minimum segment length in bars before classifying (default: 10) */
  minSegmentBars: number;
}

const DEFAULT_CONFIG: RegimeDetectorConfig = {
  lookbackBars: 20,
  trendThreshold: 0.15,
  minSegmentBars: 10,
};

// ─── Detector ───────────────────────────────────────────────────────

export class RegimeDetector {
  private readonly config: RegimeDetectorConfig;

  constructor(config?: Partial<RegimeDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify candle data into regime segments.
   * Returns an array of segments covering the entire data range.
   */
  detect(candles: Candle[]): RegimeSegment[] {
    if (candles.length < this.config.lookbackBars + 1) {
      return [{
        regime: "sideways",
        startIndex: 0,
        endIndex: candles.length - 1,
        startTime: candles[0]?.timestamp ?? 0,
        endTime: candles[candles.length - 1]?.timestamp ?? 0,
        returnPct: this.periodReturn(candles, 0, candles.length - 1),
        volatility: this.periodVolatility(candles, 0, candles.length - 1),
      }];
    }

    // Classify each bar
    const barRegimes: MarketRegime[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < this.config.lookbackBars) {
        barRegimes.push("sideways"); // not enough data yet
        continue;
      }
      barRegimes.push(this.classifyBar(candles, i));
    }

    // Merge consecutive bars with same regime into segments
    return this.mergeSegments(candles, barRegimes);
  }

  /**
   * Full regime analysis: detect segments and compute per-regime metrics
   * from a backtest result.
   */
  analyze(candles: Candle[], result: BacktestResult): RegimeAnalysis {
    const segments = this.detect(candles);

    const metricsPerRegime: Record<MarketRegime, PerformanceMetrics | null> = {
      bull: null,
      bear: null,
      sideways: null,
    };

    // Group trades by the regime they occurred in
    const tradesByRegime = new Map<MarketRegime, BacktestTrade[]>();
    const equityByRegime = new Map<MarketRegime, EquityPoint[]>();

    for (const regime of ["bull", "bear", "sideways"] as MarketRegime[]) {
      tradesByRegime.set(regime, []);
      equityByRegime.set(regime, []);
    }

    for (const segment of segments) {
      const regime = segment.regime;

      // Collect trades that fall within this segment
      for (const trade of result.trades) {
        if (trade.entryTime >= candles[segment.startIndex]?.timestamp &&
            trade.entryTime <= candles[segment.endIndex]?.timestamp) {
          tradesByRegime.get(regime)!.push(trade);
        }
      }

      // Collect equity points
      for (let i = segment.startIndex; i <= segment.endIndex && i < result.equityCurve.length; i++) {
        equityByRegime.get(regime)!.push(result.equityCurve[i]);
      }
    }

    // Compute simplified per-regime metrics
    for (const regime of ["bull", "bear", "sideways"] as MarketRegime[]) {
      const trades = tradesByRegime.get(regime)!;
      const equity = equityByRegime.get(regime)!;

      if (equity.length < 2) continue;

      const startEq = equity[0].equity;
      const endEq = equity[equity.length - 1].equity;
      const totalReturn = startEq > 0 ? (endEq - startEq) / startEq : 0;

      const winners = trades.filter(t => t.pnl > 0);
      const losers = trades.filter(t => t.pnl < 0);
      const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
      const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));

      // Compute bar returns for Sharpe
      const barReturns: number[] = [];
      for (let i = 1; i < equity.length; i++) {
        const prev = equity[i - 1].equity;
        if (prev > 0) barReturns.push((equity[i].equity - prev) / prev);
      }
      const avgRet = barReturns.length > 0
        ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length
        : 0;
      const variance = barReturns.length > 1
        ? barReturns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / barReturns.length
        : 0;
      const std = Math.sqrt(variance);

      // Max drawdown
      let peak = equity[0].equity;
      let maxDd = 0;
      let maxDdDuration = 0;
      let ddStart = 0;
      for (let i = 0; i < equity.length; i++) {
        if (equity[i].equity > peak) {
          peak = equity[i].equity;
          ddStart = i;
        }
        const dd = (equity[i].equity - peak) / peak;
        if (dd < maxDd) {
          maxDd = dd;
          maxDdDuration = i - ddStart;
        }
      }

      metricsPerRegime[regime] = {
        totalReturn,
        totalReturnPct: totalReturn * 100,
        annualizedReturn: 0, // skip for sub-segments
        annualizedReturnPct: 0,
        maxDrawdown: maxDd,
        maxDrawdownPct: maxDd * 100,
        maxDrawdownDuration: maxDdDuration,
        volatility: std * Math.sqrt(365 * 24), // rough annualization
        downsideDeviation: 0,
        sharpeRatio: std > 0 ? avgRet / std : 0,
        sortinoRatio: 0,
        calmarRatio: maxDd !== 0 ? totalReturn / Math.abs(maxDd) : 0,
        totalTrades: trades.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate: trades.length > 0 ? winners.length / trades.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        avgWin: winners.length > 0 ? grossProfit / winners.length : 0,
        avgLoss: losers.length > 0 ? -grossLoss / losers.length : 0,
        avgWinPct: winners.length > 0 ? winners.reduce((s, t) => s + t.pnlPct, 0) / winners.length * 100 : 0,
        avgLossPct: losers.length > 0 ? losers.reduce((s, t) => s + t.pnlPct, 0) / losers.length * 100 : 0,
        largestWin: winners.length > 0 ? Math.max(...winners.map(t => t.pnl)) : 0,
        largestLoss: losers.length > 0 ? Math.min(...losers.map(t => t.pnl)) : 0,
        avgHoldingPeriod: trades.length > 0
          ? trades.reduce((s, t) => s + t.holdingPeriodBars, 0) / trades.length : 0,
        expectancy: trades.length > 0
          ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0,
        totalFees: trades.reduce((s, t) => s + t.fees, 0),
        startTime: equity[0]?.timestamp ?? 0,
        endTime: equity[equity.length - 1]?.timestamp ?? 0,
        totalBars: equity.length,
        exposureTime: equity.filter(e => e.positionValue > 0).length / equity.length,
      };
    }

    return { segments, metricsPerRegime };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private classifyBar(candles: Candle[], index: number): MarketRegime {
    const lookback = this.config.lookbackBars;
    const start = index - lookback;

    // Rolling return over lookback window
    const returnPct = this.periodReturn(candles, start, index);

    // Annualize for threshold comparison
    // Assume ~365*24 hourly bars per year as rough baseline
    const barsPerYear = 365 * 24;
    const windowYears = lookback / barsPerYear;
    const annualizedReturn = windowYears > 0
      ? Math.sign(1 + returnPct) * (Math.abs(1 + returnPct) ** (1 / windowYears) - 1)
      : returnPct;

    if (annualizedReturn > this.config.trendThreshold) return "bull";
    if (annualizedReturn < -this.config.trendThreshold) return "bear";
    return "sideways";
  }

  private mergeSegments(candles: Candle[], barRegimes: MarketRegime[]): RegimeSegment[] {
    const segments: RegimeSegment[] = [];
    let currentRegime = barRegimes[0];
    let segStart = 0;

    for (let i = 1; i < barRegimes.length; i++) {
      if (barRegimes[i] !== currentRegime) {
        // Check minimum segment length — if too short, absorb into previous
        const segLen = i - segStart;
        if (segLen < this.config.minSegmentBars && segments.length > 0) {
          // Extend previous segment
          segments[segments.length - 1].endIndex = i - 1;
          segments[segments.length - 1].endTime = candles[i - 1].timestamp;
          segments[segments.length - 1].returnPct = this.periodReturn(
            candles, segments[segments.length - 1].startIndex, i - 1,
          );
          segments[segments.length - 1].volatility = this.periodVolatility(
            candles, segments[segments.length - 1].startIndex, i - 1,
          );
        } else {
          segments.push({
            regime: currentRegime,
            startIndex: segStart,
            endIndex: i - 1,
            startTime: candles[segStart].timestamp,
            endTime: candles[i - 1].timestamp,
            returnPct: this.periodReturn(candles, segStart, i - 1),
            volatility: this.periodVolatility(candles, segStart, i - 1),
          });
        }
        currentRegime = barRegimes[i];
        segStart = i;
      }
    }

    // Final segment
    const lastIdx = barRegimes.length - 1;
    const segLen = lastIdx - segStart + 1;
    if (segLen < this.config.minSegmentBars && segments.length > 0) {
      segments[segments.length - 1].endIndex = lastIdx;
      segments[segments.length - 1].endTime = candles[lastIdx].timestamp;
      segments[segments.length - 1].returnPct = this.periodReturn(
        candles, segments[segments.length - 1].startIndex, lastIdx,
      );
      segments[segments.length - 1].volatility = this.periodVolatility(
        candles, segments[segments.length - 1].startIndex, lastIdx,
      );
    } else {
      segments.push({
        regime: currentRegime,
        startIndex: segStart,
        endIndex: lastIdx,
        startTime: candles[segStart].timestamp,
        endTime: candles[lastIdx].timestamp,
        returnPct: this.periodReturn(candles, segStart, lastIdx),
        volatility: this.periodVolatility(candles, segStart, lastIdx),
      });
    }

    return segments;
  }

  private periodReturn(candles: Candle[], start: number, end: number): number {
    if (start >= end || start < 0 || end >= candles.length) return 0;
    const startPrice = candles[start].close;
    const endPrice = candles[end].close;
    return startPrice > 0 ? (endPrice - startPrice) / startPrice : 0;
  }

  private periodVolatility(candles: Candle[], start: number, end: number): number {
    if (end - start < 2) return 0;
    const returns: number[] = [];
    for (let i = start + 1; i <= end; i++) {
      const prev = candles[i - 1].close;
      if (prev > 0) returns.push((candles[i].close - prev) / prev);
    }
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }
}

/**
 * Format regime analysis as a readable report.
 */
export function formatRegimeReport(analysis: RegimeAnalysis): string {
  const lines: string[] = [
    `═══ Regime Analysis ═══`,
    ``,
    `Segments (${analysis.segments.length}):`,
  ];

  for (const seg of analysis.segments) {
    const bars = seg.endIndex - seg.startIndex + 1;
    const icon = seg.regime === "bull" ? "UP" : seg.regime === "bear" ? "DN" : "--";
    lines.push(
      `  [${icon}] ${seg.regime.padEnd(8)} | ${bars.toString().padStart(5)} bars | ` +
      `ret: ${(seg.returnPct * 100).toFixed(2).padStart(8)}% | vol: ${(seg.volatility * 100).toFixed(2)}%`,
    );
  }

  lines.push(``, `Per-Regime Strategy Performance:`);
  for (const regime of ["bull", "bear", "sideways"] as MarketRegime[]) {
    const m = analysis.metricsPerRegime[regime];
    if (!m) {
      lines.push(`  ${regime.padEnd(8)}: no data`);
      continue;
    }
    lines.push(
      `  ${regime.padEnd(8)}: ` +
      `ret ${m.totalReturnPct.toFixed(2)}% | ` +
      `${m.totalTrades} trades | ` +
      `WR ${(m.winRate * 100).toFixed(1)}% | ` +
      `Sharpe ${m.sharpeRatio.toFixed(3)} | ` +
      `DD ${m.maxDrawdownPct.toFixed(2)}%`,
    );
  }

  return lines.join("\n");
}
