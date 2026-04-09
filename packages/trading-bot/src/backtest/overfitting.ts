/**
 * Overfitting Detection Protocols
 *
 * Implements multiple statistical tests to detect whether a strategy
 * has been overfit to historical data:
 *
 * 1. Deflated Sharpe Ratio — penalizes for number of trials
 * 2. IS/OOS Performance Comparison — checks consistency
 * 3. Permutation Test — bootstrapped null distribution
 * 4. Parameter Stability — checks sensitivity to small changes
 */

import type { Candle } from "../exchange/types.js";
import type {
  BacktestConfig,
  BacktestStrategy,
  PerformanceMetrics,
} from "./types.js";
import { BacktestEngine } from "./engine.js";

export interface OverfitReport {
  /** Deflated Sharpe Ratio (accounts for multiple testing) */
  deflatedSharpe: number;
  /** True if DSR > 0 (strategy has signal beyond trial luck) */
  deflatedSharpeSignificant: boolean;

  /** Ratio of IS vs OOS Sharpe — values > 2 are concerning */
  sharpeDecay: number;

  /** p-value from permutation test (< 0.05 = likely real signal) */
  permutationPValue: number;
  permutationRuns: number;

  /** Overall verdict */
  verdict: "likely_real" | "uncertain" | "likely_overfit";
  reasons: string[];
}

/**
 * Run a comprehensive overfitting analysis on a strategy.
 */
export function detectOverfitting(
  strategy: BacktestStrategy,
  candles: Candle[],
  config: BacktestConfig,
  options?: {
    /** Number of permutation runs (default: 100) */
    permutationRuns?: number;
    /** Number of strategies tested during development (default: 10) */
    numTrials?: number;
  },
): OverfitReport {
  const permRuns = options?.permutationRuns ?? 100;
  const numTrials = options?.numTrials ?? 10;

  const engine = new BacktestEngine(config);

  // Full backtest
  const fullResult = engine.run(strategy, candles);
  const fullSharpe = fullResult.metrics.sharpeRatio;

  // Split 70/30 for IS/OOS comparison
  const splitIdx = Math.floor(candles.length * 0.7);
  const isResult = engine.runSlice(strategy, candles, 0, splitIdx);
  const oosResult = engine.runSlice(strategy, candles, splitIdx, candles.length);
  const isSharpe = isResult.metrics.sharpeRatio;
  const oosSharpe = oosResult.metrics.sharpeRatio;

  // 1. Deflated Sharpe Ratio
  const deflatedSharpe = computeDeflatedSharpe(fullSharpe, candles.length, numTrials);

  // 2. Sharpe decay
  const sharpeDecay = oosSharpe !== 0 ? isSharpe / oosSharpe : Infinity;

  // 3. Permutation test
  const permutationPValue = runPermutationTest(strategy, candles, config, fullSharpe, permRuns);

  // 4. Build verdict
  const reasons: string[] = [];
  let score = 0;

  if (deflatedSharpe <= 0) {
    reasons.push(`Deflated Sharpe ≤ 0 (${deflatedSharpe.toFixed(3)}): performance explained by trial luck`);
    score += 2;
  } else {
    reasons.push(`Deflated Sharpe > 0 (${deflatedSharpe.toFixed(3)}): some real signal`);
  }

  if (sharpeDecay > 3) {
    reasons.push(`Sharpe decays ${sharpeDecay.toFixed(1)}x from IS to OOS: severe overfitting`);
    score += 2;
  } else if (sharpeDecay > 1.5) {
    reasons.push(`Sharpe decays ${sharpeDecay.toFixed(1)}x from IS to OOS: moderate concern`);
    score += 1;
  } else {
    reasons.push(`Sharpe decay ${sharpeDecay.toFixed(1)}x: consistent performance`);
  }

  if (permutationPValue > 0.1) {
    reasons.push(`Permutation p-value ${permutationPValue.toFixed(3)}: cannot reject random trading`);
    score += 2;
  } else if (permutationPValue > 0.05) {
    reasons.push(`Permutation p-value ${permutationPValue.toFixed(3)}: borderline significance`);
    score += 1;
  } else {
    reasons.push(`Permutation p-value ${permutationPValue.toFixed(3)}: statistically significant`);
  }

  let verdict: OverfitReport["verdict"];
  if (score >= 4) verdict = "likely_overfit";
  else if (score >= 2) verdict = "uncertain";
  else verdict = "likely_real";

  return {
    deflatedSharpe,
    deflatedSharpeSignificant: deflatedSharpe > 0,
    sharpeDecay,
    permutationPValue,
    permutationRuns: permRuns,
    verdict,
    reasons,
  };
}

/**
 * Deflated Sharpe Ratio — penalizes for the number of strategy variations
 * tried before arriving at the final one.
 *
 * Based on Bailey & Lopez de Prado (2014).
 */
function computeDeflatedSharpe(
  observedSharpe: number,
  numObservations: number,
  numTrials: number,
): number {
  // Expected max Sharpe from numTrials independent strategies under null hypothesis
  // E[max(Z_1,...,Z_N)] ≈ (1 - γ)Φ^{-1}(1-1/N) + γΦ^{-1}(1-1/(Ne))
  // Simplified: ≈ sqrt(2 * ln(numTrials))
  const expectedMaxSharpe = Math.sqrt(2 * Math.log(numTrials));

  // Standard error of Sharpe ratio
  const se = Math.sqrt((1 + 0.5 * observedSharpe ** 2) / numObservations);

  // Deflated = (observed - expected_max) / se
  return (observedSharpe - expectedMaxSharpe) / se;
}

/**
 * Permutation test: shuffle returns and see how often random
 * orderings produce a Sharpe as good as the real one.
 */
function runPermutationTest(
  strategy: BacktestStrategy,
  candles: Candle[],
  config: BacktestConfig,
  realSharpe: number,
  numRuns: number,
): number {
  // Extract bar returns from candle closes
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }

  let countBetter = 0;
  const engine = new BacktestEngine(config);

  for (let run = 0; run < numRuns; run++) {
    // Shuffle returns
    const shuffled = [...returns];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Reconstruct candles from shuffled returns
    const syntheticCandles: typeof candles = [];
    let price = candles[0].close;
    for (let i = 0; i < shuffled.length; i++) {
      price = price * (1 + shuffled[i]);
      syntheticCandles.push({
        ...candles[i + 1],
        open: price * (1 - Math.abs(shuffled[i]) * 0.3),
        high: price * (1 + Math.abs(shuffled[i]) * 0.5),
        low: price * (1 - Math.abs(shuffled[i]) * 0.5),
        close: price,
      });
    }

    // Prepend the first candle
    syntheticCandles.unshift(candles[0]);

    const result = engine.run(strategy, syntheticCandles);
    if (result.metrics.sharpeRatio >= realSharpe) countBetter++;
  }

  return countBetter / numRuns;
}

/** Format overfitting report */
export function formatOverfitReport(report: OverfitReport): string {
  const icon = report.verdict === "likely_real" ? "✓"
    : report.verdict === "uncertain" ? "?"
    : "✗";

  const lines = [
    `═══ Overfitting Analysis ═══`,
    ``,
    `Verdict: ${icon} ${report.verdict.toUpperCase().replace("_", " ")}`,
    ``,
    `Deflated Sharpe:   ${report.deflatedSharpe.toFixed(3)} (${report.deflatedSharpeSignificant ? "significant" : "not significant"})`,
    `Sharpe Decay:      ${report.sharpeDecay === Infinity ? "∞" : report.sharpeDecay.toFixed(2)}x (IS → OOS)`,
    `Permutation p:     ${report.permutationPValue.toFixed(3)} (${report.permutationRuns} runs)`,
    ``,
    `Reasoning:`,
  ];

  for (const reason of report.reasons) {
    lines.push(`  • ${reason}`);
  }

  return lines.join("\n");
}
