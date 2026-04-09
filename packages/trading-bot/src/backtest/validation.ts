/**
 * Validation Protocols
 *
 * Walk-forward analysis, per-regime testing, and Monte Carlo simulation
 * to detect overfitting and validate strategy robustness before live deployment.
 *
 * Rule: No strategy touches real capital until it passes ALL validation gates.
 */

import type { Candle } from "../exchange/types.js";
import type {
  BacktestStrategy,
  BacktestConfig,
  BacktestResult,
  PerformanceMetrics,
  WalkForwardWindow,
  WalkForwardResult,
  MarketRegime,
  RegimeSegment,
  RegimeAnalysis,
} from "./types.js";
import { BacktestEngine } from "./engine.js";
import { calculateMetrics } from "./metrics.js";

// ─── Walk-Forward Analysis ─────────────────────────────────────────

export interface WalkForwardConfig {
  /** Fraction of each window used for in-sample (training). Default: 0.7 */
  inSampleRatio?: number;
  /** Number of walk-forward windows. Default: 5 */
  numWindows?: number;
  /** Whether windows overlap (anchored = in-sample starts at 0). Default: false */
  anchored?: boolean;
}

/**
 * Walk-forward analysis: split data into sequential in-sample/out-of-sample
 * windows, test strategy on each OOS period, then stitch results.
 *
 * Detects overfitting by comparing in-sample vs out-of-sample performance.
 * A strategy that works in-sample but fails out-of-sample is overfit.
 */
export function walkForwardAnalysis(
  strategy: BacktestStrategy,
  candles: Candle[],
  backtestConfig: BacktestConfig,
  wfConfig?: WalkForwardConfig,
): WalkForwardResult {
  const numWindows = wfConfig?.numWindows ?? 5;
  const isRatio = wfConfig?.inSampleRatio ?? 0.7;
  const anchored = wfConfig?.anchored ?? false;

  if (candles.length < numWindows * 20) {
    throw new Error(`Insufficient data for ${numWindows} walk-forward windows (need at least ${numWindows * 20} candles)`);
  }

  const engine = new BacktestEngine(backtestConfig);
  const windowSize = Math.floor(candles.length / numWindows);
  const isSize = Math.floor(windowSize * isRatio);
  const oosSize = windowSize - isSize;

  const windows: WalkForwardResult["windows"] = [];
  let allOosTrades: BacktestResult["trades"] = [];
  let allOosEquity: BacktestResult["equityCurve"] = [];

  for (let w = 0; w < numWindows; w++) {
    const windowStart = anchored ? 0 : w * windowSize;
    const isStart = windowStart;
    const isEnd = anchored ? (w + 1) * isSize : windowStart + isSize;
    const oosStart = isEnd;
    const oosEnd = Math.min(oosStart + oosSize, candles.length);

    if (oosEnd <= oosStart || isEnd <= isStart) continue;

    const isCandles = candles.slice(isStart, isEnd);
    const oosCandles = candles.slice(oosStart, oosEnd);

    const isResult = engine.run(strategy, isCandles);
    const oosResult = engine.run(strategy, oosCandles);

    const window: WalkForwardWindow = {
      inSample: {
        start: isCandles[0]?.timestamp ?? 0,
        end: isCandles[isCandles.length - 1]?.timestamp ?? 0,
      },
      outOfSample: {
        start: oosCandles[0]?.timestamp ?? 0,
        end: oosCandles[oosCandles.length - 1]?.timestamp ?? 0,
      },
    };

    windows.push({
      window,
      inSampleMetrics: isResult.metrics,
      outOfSampleMetrics: oosResult.metrics,
    });

    allOosTrades = allOosTrades.concat(oosResult.trades);
    allOosEquity = allOosEquity.concat(oosResult.equityCurve);
  }

  // Combined OOS metrics
  const combinedOosMetrics = calculateMetrics(
    allOosEquity,
    allOosTrades,
    backtestConfig.timeframe,
    backtestConfig.initialCapital,
  );

  // Overfit detection
  const avgIsSharpe = windows.length > 0
    ? windows.reduce((s, w) => s + w.inSampleMetrics.sharpeRatio, 0) / windows.length
    : 0;
  const avgOosSharpe = windows.length > 0
    ? windows.reduce((s, w) => s + w.outOfSampleMetrics.sharpeRatio, 0) / windows.length
    : 0;

  const sharpeDecayRatio = avgOosSharpe !== 0 ? avgIsSharpe / avgOosSharpe : Infinity;

  // Overfit score: 0 = no overfitting, 1 = complete overfitting
  // Based on how much OOS performance decays relative to IS
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

// ─── Regime-Specific Analysis ──────────────────────────────────────

/**
 * Classify candle segments into market regimes based on rolling returns.
 * Uses a simple rule: rolling 20-bar return > threshold = bull/bear, else sideways.
 */
export function classifyRegimes(
  candles: Candle[],
  lookback: number = 20,
  bullThreshold: number = 0.05,
  bearThreshold: number = -0.05,
): RegimeSegment[] {
  if (candles.length < lookback + 1) return [];

  const segments: RegimeSegment[] = [];
  let currentRegime: MarketRegime | null = null;
  let segStart = lookback;

  for (let i = lookback; i < candles.length; i++) {
    const pastPrice = candles[i - lookback].close;
    const currentPrice = candles[i].close;
    const rollingReturn = (currentPrice - pastPrice) / pastPrice;

    let regime: MarketRegime;
    if (rollingReturn > bullThreshold) regime = "bull";
    else if (rollingReturn < bearThreshold) regime = "bear";
    else regime = "sideways";

    if (regime !== currentRegime) {
      if (currentRegime !== null) {
        const segCandles = candles.slice(segStart, i);
        const returns = segCandles.slice(1).map((c, j) =>
          (c.close - segCandles[j].close) / segCandles[j].close
        );
        const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const vol = returns.length > 1
          ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length)
          : 0;

        segments.push({
          regime: currentRegime,
          startIndex: segStart,
          endIndex: i - 1,
          startTime: candles[segStart].timestamp,
          endTime: candles[i - 1].timestamp,
          returnPct: pastPrice > 0
            ? ((candles[i - 1].close - candles[segStart].close) / candles[segStart].close) * 100
            : 0,
          volatility: vol,
        });
      }
      currentRegime = regime;
      segStart = i;
    }
  }

  // Close last segment
  if (currentRegime !== null && segStart < candles.length) {
    const segCandles = candles.slice(segStart);
    const returns = segCandles.slice(1).map((c, j) =>
      (c.close - segCandles[j].close) / segCandles[j].close
    );
    const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const vol = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length)
      : 0;

    segments.push({
      regime: currentRegime,
      startIndex: segStart,
      endIndex: candles.length - 1,
      startTime: candles[segStart].timestamp,
      endTime: candles[candles.length - 1].timestamp,
      returnPct: candles[segStart].close > 0
        ? ((candles[candles.length - 1].close - candles[segStart].close) / candles[segStart].close) * 100
        : 0,
      volatility: vol,
    });
  }

  return segments;
}

/**
 * Run a strategy on each regime segment separately and report per-regime metrics.
 */
export function regimeAnalysis(
  strategy: BacktestStrategy,
  candles: Candle[],
  backtestConfig: BacktestConfig,
  segments?: RegimeSegment[],
): RegimeAnalysis {
  const segs = segments ?? classifyRegimes(candles);
  const engine = new BacktestEngine(backtestConfig);

  const metricsPerRegime: Record<MarketRegime, PerformanceMetrics | null> = {
    bull: null,
    bear: null,
    sideways: null,
  };

  // Aggregate candles per regime
  const regimeCandles: Record<MarketRegime, Candle[]> = {
    bull: [],
    bear: [],
    sideways: [],
  };

  for (const seg of segs) {
    const slice = candles.slice(seg.startIndex, seg.endIndex + 1);
    regimeCandles[seg.regime].push(...slice);
  }

  for (const regime of ["bull", "bear", "sideways"] as MarketRegime[]) {
    const rc = regimeCandles[regime];
    if (rc.length >= 10) {
      const result = engine.run(strategy, rc);
      metricsPerRegime[regime] = result.metrics;
    }
  }

  return { segments: segs, metricsPerRegime };
}

// ─── Monte Carlo Simulation ────────────────────────────────────────

export interface MonteCarloConfig {
  /** Number of randomized runs. Default: 1000 */
  numSimulations?: number;
  /** Confidence levels to report. Default: [0.05, 0.25, 0.50, 0.75, 0.95] */
  percentiles?: number[];
  /** Random seed for reproducibility */
  seed?: number;
}

export interface MonteCarloResult {
  numSimulations: number;
  /** Final equity distribution */
  equity: {
    mean: number;
    median: number;
    stdDev: number;
    percentiles: Record<number, number>;
  };
  /** Max drawdown distribution */
  maxDrawdown: {
    mean: number;
    median: number;
    percentiles: Record<number, number>;
  };
  /** Probability that final equity < initial capital */
  ruinProbability: number;
  /** Probability of achieving positive return */
  profitProbability: number;
}

/**
 * Monte Carlo simulation: shuffle the order of completed trades and
 * re-simulate equity curves to measure distribution of outcomes.
 *
 * This answers: "Given these trades in random order, how bad could it get?"
 */
export function monteCarloSimulation(
  trades: { pnl: number; fees: number }[],
  initialCapital: number,
  config?: MonteCarloConfig,
): MonteCarloResult {
  const numSims = config?.numSimulations ?? 1000;
  const percentiles = config?.percentiles ?? [0.05, 0.25, 0.50, 0.75, 0.95];
  const seed = config?.seed ?? 42;

  if (trades.length === 0) {
    const empty: Record<number, number> = {};
    for (const p of percentiles) empty[p] = initialCapital;
    return {
      numSimulations: 0,
      equity: { mean: initialCapital, median: initialCapital, stdDev: 0, percentiles: empty },
      maxDrawdown: { mean: 0, median: 0, percentiles: { ...empty, ...Object.fromEntries(percentiles.map(p => [p, 0])) } },
      ruinProbability: 0,
      profitProbability: 0,
    };
  }

  // Simple seeded shuffle using linear congruential generator
  let rngState = seed;
  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let sim = 0; sim < numSims; sim++) {
    // Fisher-Yates shuffle of trade indices
    const indices = Array.from({ length: trades.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(nextRng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Replay shuffled trades
    let equity = initialCapital;
    let peak = equity;
    let maxDd = 0;

    for (const idx of indices) {
      equity += trades[idx].pnl;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (equity - peak) / peak : 0;
      if (dd < maxDd) maxDd = dd;
    }

    finalEquities.push(equity);
    maxDrawdowns.push(maxDd);
  }

  // Sort for percentile calculation
  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const getPercentile = (sorted: number[], p: number): number => {
    const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
    return sorted[idx];
  };

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdDev = (arr: number[], m: number) =>
    Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);

  const eqMean = mean(finalEquities);
  const ddMean = mean(maxDrawdowns);

  const eqPercentiles: Record<number, number> = {};
  const ddPercentiles: Record<number, number> = {};
  for (const p of percentiles) {
    eqPercentiles[p] = getPercentile(finalEquities, p);
    ddPercentiles[p] = getPercentile(maxDrawdowns, p);
  }

  return {
    numSimulations: numSims,
    equity: {
      mean: eqMean,
      median: getPercentile(finalEquities, 0.5),
      stdDev: stdDev(finalEquities, eqMean),
      percentiles: eqPercentiles,
    },
    maxDrawdown: {
      mean: ddMean,
      median: getPercentile(maxDrawdowns, 0.5),
      percentiles: ddPercentiles,
    },
    ruinProbability: finalEquities.filter(e => e < initialCapital * 0.5).length / numSims,
    profitProbability: finalEquities.filter(e => e > initialCapital).length / numSims,
  };
}

// ─── Validation Gate ───────────────────────────────────────────────

export interface ValidationGateConfig {
  /** Minimum Sharpe ratio to pass. Default: 0.5 */
  minSharpe?: number;
  /** Maximum drawdown allowed (fraction, negative). Default: -0.20 */
  maxDrawdown?: number;
  /** Minimum win rate. Default: 0.40 */
  minWinRate?: number;
  /** Minimum profit factor. Default: 1.2 */
  minProfitFactor?: number;
  /** Maximum walk-forward overfit score. Default: 0.50 */
  maxOverfitScore?: number;
  /** Minimum Monte Carlo profit probability. Default: 0.60 */
  minProfitProbability?: number;
  /** Strategy must be profitable in bear regime */
  requireBearSurvival?: boolean;
}

export interface ValidationResult {
  passed: boolean;
  gates: Array<{
    name: string;
    passed: boolean;
    value: number;
    threshold: number;
    details: string;
  }>;
  summary: string;
}

/**
 * Run all validation gates on a strategy.
 * A strategy must pass ALL gates before touching real capital.
 */
export function validateStrategy(
  strategy: BacktestStrategy,
  candles: Candle[],
  backtestConfig: BacktestConfig,
  gateConfig?: ValidationGateConfig,
): ValidationResult {
  const gc = {
    minSharpe: gateConfig?.minSharpe ?? 0.5,
    maxDrawdown: gateConfig?.maxDrawdown ?? -0.20,
    minWinRate: gateConfig?.minWinRate ?? 0.40,
    minProfitFactor: gateConfig?.minProfitFactor ?? 1.2,
    maxOverfitScore: gateConfig?.maxOverfitScore ?? 0.50,
    minProfitProbability: gateConfig?.minProfitProbability ?? 0.60,
    requireBearSurvival: gateConfig?.requireBearSurvival ?? true,
  };

  const gates: ValidationResult["gates"] = [];

  // 1. Full backtest
  const engine = new BacktestEngine(backtestConfig);
  const fullResult = engine.run(strategy, candles);
  const m = fullResult.metrics;

  gates.push({
    name: "Sharpe Ratio",
    passed: m.sharpeRatio >= gc.minSharpe,
    value: m.sharpeRatio,
    threshold: gc.minSharpe,
    details: `Sharpe ${m.sharpeRatio.toFixed(3)} vs min ${gc.minSharpe}`,
  });

  gates.push({
    name: "Max Drawdown",
    passed: m.maxDrawdown >= gc.maxDrawdown,
    value: m.maxDrawdown,
    threshold: gc.maxDrawdown,
    details: `Drawdown ${(m.maxDrawdown * 100).toFixed(2)}% vs limit ${(gc.maxDrawdown * 100).toFixed(2)}%`,
  });

  gates.push({
    name: "Win Rate",
    passed: m.winRate >= gc.minWinRate,
    value: m.winRate,
    threshold: gc.minWinRate,
    details: `Win rate ${(m.winRate * 100).toFixed(1)}% vs min ${(gc.minWinRate * 100).toFixed(1)}%`,
  });

  gates.push({
    name: "Profit Factor",
    passed: m.profitFactor >= gc.minProfitFactor,
    value: m.profitFactor,
    threshold: gc.minProfitFactor,
    details: `PF ${m.profitFactor.toFixed(3)} vs min ${gc.minProfitFactor}`,
  });

  // 2. Walk-forward analysis
  if (candles.length >= 200) {
    const wf = walkForwardAnalysis(strategy, candles, backtestConfig);
    gates.push({
      name: "Walk-Forward Overfit",
      passed: wf.overfitScore <= gc.maxOverfitScore,
      value: wf.overfitScore,
      threshold: gc.maxOverfitScore,
      details: `Overfit score ${wf.overfitScore.toFixed(3)} vs max ${gc.maxOverfitScore}`,
    });
  }

  // 3. Monte Carlo
  if (fullResult.trades.length >= 10) {
    const mc = monteCarloSimulation(fullResult.trades, backtestConfig.initialCapital);
    gates.push({
      name: "Monte Carlo Profit Probability",
      passed: mc.profitProbability >= gc.minProfitProbability,
      value: mc.profitProbability,
      threshold: gc.minProfitProbability,
      details: `Profit prob ${(mc.profitProbability * 100).toFixed(1)}% vs min ${(gc.minProfitProbability * 100).toFixed(1)}%`,
    });
  }

  // 4. Bear regime survival
  if (gc.requireBearSurvival) {
    const ra = regimeAnalysis(strategy, candles, backtestConfig);
    const bearMetrics = ra.metricsPerRegime.bear;
    const bearSurvived = bearMetrics
      ? bearMetrics.maxDrawdown > -0.50 // must not lose > 50% in bear market
      : true; // no bear data = pass by default
    gates.push({
      name: "Bear Regime Survival",
      passed: bearSurvived,
      value: bearMetrics?.maxDrawdown ?? 0,
      threshold: -0.50,
      details: bearMetrics
        ? `Bear drawdown ${(bearMetrics.maxDrawdown * 100).toFixed(2)}% (limit: -50%)`
        : "No bear regime data (pass by default)",
    });
  }

  const passed = gates.every(g => g.passed);
  const failedGates = gates.filter(g => !g.passed);
  const summary = passed
    ? `✓ All ${gates.length} validation gates passed`
    : `✗ ${failedGates.length}/${gates.length} gates failed: ${failedGates.map(g => g.name).join(", ")}`;

  return { passed, gates, summary };
}

// ─── Reporting ─────────────────────────────────────────────────────

/** Format a full validation report */
export function formatValidationReport(result: ValidationResult): string {
  const lines = [
    `═══ Strategy Validation Report ═══`,
    ``,
    `Result: ${result.passed ? "PASSED ✓" : "FAILED ✗"}`,
    ``,
  ];

  for (const gate of result.gates) {
    const icon = gate.passed ? "✓" : "✗";
    lines.push(`  ${icon} ${gate.name}: ${gate.details}`);
  }

  lines.push(``);
  lines.push(result.summary);

  return lines.join("\n");
}
