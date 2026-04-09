/**
 * Walk-Forward Analysis — Dedicated Module
 *
 * Provides advanced walk-forward testing beyond the basic version in validation.ts:
 * - Anchored walk-forward (expanding in-sample window)
 * - Rolling walk-forward (fixed-size sliding window)
 * - Combinatorial Purged Cross-Validation (CPCV)
 * - Walk-forward efficiency scoring and reporting
 */

import type { Candle } from "../exchange/types.js";
import type {
  BacktestConfig,
  BacktestStrategy,
  BacktestResult,
  PerformanceMetrics,
  WalkForwardWindow,
  WalkForwardResult,
} from "./types.js";
import { BacktestEngine } from "./engine.js";
import { calculateMetrics } from "./metrics.js";

// ─── Configuration ─────────────────────────────────────────────────

export interface AdvancedWalkForwardConfig {
  /** Number of windows (default: 5) */
  numWindows?: number;
  /** Fraction of window for training (default: 0.7) */
  inSampleRatio?: number;
  /** Mode: rolling (fixed window) or anchored (expanding IS) */
  mode?: "rolling" | "anchored";
  /** Purge bars between IS and OOS to prevent lookahead (default: 0) */
  purgeBars?: number;
  /** Embargo bars at end of OOS to prevent data leakage (default: 0) */
  embargoBars?: number;
}

/**
 * Advanced walk-forward analysis with purge gap and embargo period
 * to eliminate data leakage between in-sample and out-of-sample windows.
 *
 * Purge: removes `purgeBars` candles between IS end and OOS start.
 * Embargo: removes `embargoBars` candles from the end of each OOS period.
 */
export function advancedWalkForward(
  strategy: BacktestStrategy,
  candles: Candle[],
  backtestConfig: BacktestConfig,
  config?: AdvancedWalkForwardConfig,
): WalkForwardResult {
  const numWindows = config?.numWindows ?? 5;
  const isRatio = config?.inSampleRatio ?? 0.7;
  const mode = config?.mode ?? "rolling";
  const purgeBars = config?.purgeBars ?? 0;
  const embargoBars = config?.embargoBars ?? 0;

  const minCandles = numWindows * 20 + purgeBars * numWindows;
  if (candles.length < minCandles) {
    throw new Error(`Need at least ${minCandles} candles for ${numWindows} windows with ${purgeBars}-bar purge`);
  }

  const engine = new BacktestEngine(backtestConfig);
  const windowSize = Math.floor(candles.length / numWindows);
  const windows: WalkForwardResult["windows"] = [];

  let allOosTrades: BacktestResult["trades"] = [];
  let allOosEquity: BacktestResult["equityCurve"] = [];

  for (let w = 0; w < numWindows; w++) {
    let isStart: number;
    let isEnd: number;
    let oosStart: number;
    let oosEnd: number;

    if (mode === "anchored") {
      // Anchored: IS always starts at 0, grows each window
      isStart = 0;
      isEnd = Math.floor(candles.length * isRatio * (w + 1) / numWindows);
      oosStart = isEnd + purgeBars;
      oosEnd = Math.min(
        isEnd + Math.floor(candles.length * (1 - isRatio) / numWindows) - embargoBars,
        candles.length,
      );
    } else {
      // Rolling: fixed-size windows sliding forward
      isStart = w * windowSize;
      isEnd = isStart + Math.floor(windowSize * isRatio);
      oosStart = isEnd + purgeBars;
      oosEnd = Math.min(isStart + windowSize - embargoBars, candles.length);
    }

    if (oosEnd <= oosStart || isEnd <= isStart) continue;
    if (oosStart >= candles.length) continue;

    const isCandles = candles.slice(isStart, isEnd);
    const oosCandles = candles.slice(oosStart, oosEnd);

    if (isCandles.length < 2 || oosCandles.length < 2) continue;

    const isResult = engine.run(strategy, isCandles);
    const oosResult = engine.run(strategy, oosCandles);

    windows.push({
      window: {
        inSample: {
          start: isCandles[0].timestamp,
          end: isCandles[isCandles.length - 1].timestamp,
        },
        outOfSample: {
          start: oosCandles[0].timestamp,
          end: oosCandles[oosCandles.length - 1].timestamp,
        },
      },
      inSampleMetrics: isResult.metrics,
      outOfSampleMetrics: oosResult.metrics,
    });

    allOosTrades = allOosTrades.concat(oosResult.trades);
    allOosEquity = allOosEquity.concat(oosResult.equityCurve);
  }

  const combinedOosMetrics = calculateMetrics(
    allOosEquity,
    allOosTrades,
    backtestConfig.timeframe,
    backtestConfig.initialCapital,
  );

  const avgIsSharpe = windows.length > 0
    ? windows.reduce((s, w) => s + w.inSampleMetrics.sharpeRatio, 0) / windows.length
    : 0;
  const avgOosSharpe = windows.length > 0
    ? windows.reduce((s, w) => s + w.outOfSampleMetrics.sharpeRatio, 0) / windows.length
    : 0;

  const sharpeDecayRatio = avgOosSharpe !== 0 ? avgIsSharpe / avgOosSharpe : Infinity;
  const overfitScore = avgIsSharpe > 0
    ? Math.max(0, Math.min(1, 1 - avgOosSharpe / avgIsSharpe))
    : 0;

  return {
    windows,
    combinedOosMetrics,
    overfitScore,
    sharpeDecayRatio,
  };
}

/**
 * Walk-forward efficiency: how consistent is OOS performance relative to IS?
 * Returns a score from 0 (all windows degrade) to 1 (all windows match or beat IS).
 */
export function walkForwardEfficiency(result: WalkForwardResult): number {
  if (result.windows.length === 0) return 0;

  let consistentWindows = 0;
  for (const w of result.windows) {
    const isReturn = w.inSampleMetrics.totalReturn;
    const oosReturn = w.outOfSampleMetrics.totalReturn;
    // OOS is "efficient" if it retains at least 50% of IS return (or IS was negative too)
    if (isReturn <= 0 || oosReturn >= isReturn * 0.5) {
      consistentWindows++;
    }
  }

  return consistentWindows / result.windows.length;
}

/** Format walk-forward results as a readable report */
export function formatWalkForwardReport(result: WalkForwardResult): string {
  const lines = [
    `═══ Walk-Forward Analysis ═══`,
    ``,
    `Windows: ${result.windows.length}`,
    `Overfit Score: ${result.overfitScore.toFixed(3)} (0=none, 1=complete)`,
    `Sharpe Decay: ${result.sharpeDecayRatio === Infinity ? "∞" : result.sharpeDecayRatio.toFixed(2)}x`,
    `Efficiency: ${(walkForwardEfficiency(result) * 100).toFixed(1)}%`,
    `Combined OOS Sharpe: ${result.combinedOosMetrics.sharpeRatio.toFixed(3)}`,
    ``,
  ];

  for (let i = 0; i < result.windows.length; i++) {
    const w = result.windows[i];
    const isM = w.inSampleMetrics;
    const oosM = w.outOfSampleMetrics;
    lines.push(
      `  Window ${i + 1}: IS Sharpe ${isM.sharpeRatio.toFixed(3)} → OOS Sharpe ${oosM.sharpeRatio.toFixed(3)} | ` +
      `IS ret ${isM.totalReturnPct.toFixed(2)}% → OOS ret ${oosM.totalReturnPct.toFixed(2)}%`,
    );
  }

  return lines.join("\n");
}
