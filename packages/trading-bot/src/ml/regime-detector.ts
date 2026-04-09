/**
 * Market Regime Detector
 *
 * Classifies the current market into one of four regimes:
 * - trending_up:   Sustained upward price movement with momentum
 * - trending_down: Sustained downward price movement with momentum
 * - ranging:       Price oscillating within a band, no clear direction
 * - volatile:      High variance, unpredictable — danger zone for ML
 *
 * The regime determines which model weights to use and whether the ML
 * signal should be trusted or degraded to rule-based fallbacks.
 */

import type { Candle } from "../exchange/types.js";

// ─── Types ─────────────────────────────────────────────────────────

export type RegimeType = "trending_up" | "trending_down" | "ranging" | "volatile";

export interface RegimeState {
  regime: RegimeType;
  /** Confidence in the classification (0-1) */
  confidence: number;
  /** How many consecutive ticks this regime has held */
  duration: number;
  /** Current volatility as a percentile of recent history (0-1) */
  volatilityPercentile: number;
  /** Trend strength: positive = up, negative = down, near 0 = ranging */
  trendStrength: number;
  /** ADX-like directional strength (0-1) */
  directionalStrength: number;
}

export interface RegimeDetectorConfig {
  /** Lookback period for trend detection (default: 20) */
  trendLookback: number;
  /** Lookback period for volatility measurement (default: 30) */
  volatilityLookback: number;
  /** Threshold above which trend is considered strong (default: 0.15) */
  trendThreshold: number;
  /** Volatility percentile above which market is "volatile" (default: 0.8) */
  volatileThreshold: number;
  /** Rolling window size for volatility percentile calculation */
  volatilityHistorySize: number;
}

const DEFAULT_CONFIG: RegimeDetectorConfig = {
  trendLookback: 20,
  volatilityLookback: 30,
  trendThreshold: 0.15,
  volatileThreshold: 0.8,
  volatilityHistorySize: 200,
};

// ─── Detector ──────────────────────────────────────────────────────

export class RegimeDetector {
  private readonly config: RegimeDetectorConfig;
  private volatilityHistory: number[] = [];
  private currentRegime: RegimeType = "ranging";
  private regimeDuration = 0;

  constructor(config: Partial<RegimeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect the current market regime from candle data.
   * Candles must be sorted oldest-first.
   */
  detect(candles: Candle[]): RegimeState {
    const minCandles = Math.max(this.config.trendLookback, this.config.volatilityLookback) + 1;
    if (candles.length < minCandles) {
      return {
        regime: "ranging",
        confidence: 0,
        duration: 0,
        volatilityPercentile: 0.5,
        trendStrength: 0,
        directionalStrength: 0,
      };
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // 1. Compute trend strength via linear regression slope
    const trendStrength = this.computeTrendStrength(closes);

    // 2. Compute directional strength (ADX-like)
    const directionalStrength = this.computeDirectionalStrength(highs, lows, closes);

    // 3. Compute current volatility and its percentile
    const currentVol = this.computeVolatility(closes);
    this.volatilityHistory.push(currentVol);
    if (this.volatilityHistory.length > this.config.volatilityHistorySize) {
      this.volatilityHistory.shift();
    }
    const volatilityPercentile = this.computePercentile(currentVol, this.volatilityHistory);

    // 4. Classify regime
    const { regime, confidence } = this.classifyRegime(
      trendStrength,
      directionalStrength,
      volatilityPercentile,
    );

    // Track regime duration
    if (regime === this.currentRegime) {
      this.regimeDuration++;
    } else {
      this.currentRegime = regime;
      this.regimeDuration = 1;
    }

    return {
      regime,
      confidence,
      duration: this.regimeDuration,
      volatilityPercentile,
      trendStrength,
      directionalStrength,
    };
  }

  /** Reset detector state */
  reset(): void {
    this.volatilityHistory = [];
    this.currentRegime = "ranging";
    this.regimeDuration = 0;
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private classifyRegime(
    trendStrength: number,
    directionalStrength: number,
    volatilityPercentile: number,
  ): { regime: RegimeType; confidence: number } {
    // High volatility overrides everything — market is chaotic
    if (volatilityPercentile >= this.config.volatileThreshold) {
      const volConfidence = (volatilityPercentile - this.config.volatileThreshold) /
        (1 - this.config.volatileThreshold);
      return { regime: "volatile", confidence: 0.5 + volConfidence * 0.5 };
    }

    const absTrend = Math.abs(trendStrength);

    // Strong directional movement = trending
    if (absTrend >= this.config.trendThreshold && directionalStrength >= 0.3) {
      const trendConfidence = Math.min(1, absTrend / (this.config.trendThreshold * 2));
      const dirConfidence = Math.min(1, directionalStrength);
      const confidence = (trendConfidence + dirConfidence) / 2;

      if (trendStrength > 0) {
        return { regime: "trending_up", confidence };
      }
      return { regime: "trending_down", confidence };
    }

    // Everything else is ranging
    const rangingConfidence = 1 - Math.min(1, absTrend / this.config.trendThreshold);
    return { regime: "ranging", confidence: Math.max(0.3, rangingConfidence) };
  }

  /**
   * Trend strength via normalized linear regression slope.
   * Returns value roughly in [-1, 1]: positive = uptrend, negative = downtrend.
   */
  private computeTrendStrength(closes: number[]): number {
    const period = Math.min(this.config.trendLookback, closes.length);
    const recent = closes.slice(-period);
    const n = recent.length;
    if (n < 3) return 0;

    // Linear regression slope
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recent[i];
      sumXY += i * recent[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const avgPrice = sumY / n;

    // Normalize: slope per bar as fraction of avg price, scaled by sqrt(period)
    return avgPrice > 0 ? (slope / avgPrice) * Math.sqrt(period) : 0;
  }

  /**
   * Simplified ADX-like directional strength.
   * High values mean price is moving consistently in one direction.
   */
  private computeDirectionalStrength(
    highs: number[],
    lows: number[],
    closes: number[],
  ): number {
    const period = Math.min(this.config.trendLookback, highs.length - 1);
    if (period < 3) return 0;

    let plusDM = 0;
    let minusDM = 0;
    let trSum = 0;

    for (let i = highs.length - period; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      trSum += tr;

      if (upMove > downMove && upMove > 0) plusDM += upMove;
      if (downMove > upMove && downMove > 0) minusDM += downMove;
    }

    if (trSum === 0) return 0;

    const plusDI = plusDM / trSum;
    const minusDI = minusDM / trSum;
    const diSum = plusDI + minusDI;

    // ADX approximation
    return diSum > 0 ? Math.abs(plusDI - minusDI) / diSum : 0;
  }

  /**
   * Annualized volatility from returns standard deviation.
   */
  private computeVolatility(closes: number[]): number {
    const period = Math.min(this.config.volatilityLookback, closes.length - 1);
    if (period < 2) return 0;

    const returns: number[] = [];
    for (let i = closes.length - period; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
    }

    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  private computePercentile(value: number, history: number[]): number {
    if (history.length < 2) return 0.5;
    let count = 0;
    for (const v of history) {
      if (v <= value) count++;
    }
    return count / history.length;
  }
}
