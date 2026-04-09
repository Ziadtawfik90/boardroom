/**
 * Feature Extractor — Transforms raw candle data into normalized feature vectors.
 *
 * Computes technical indicators across multiple lookback periods:
 * - Returns (momentum)
 * - Volatility (standard deviation of returns)
 * - Volume ratios
 * - Trend strength (price vs moving averages)
 * - RSI
 */

import type { Candle } from "../exchange/types.js";
import type { FeatureConfig, FeatureVector } from "./types.js";

const DEFAULT_CONFIG: FeatureConfig = {
  lookbackPeriods: [5, 10, 20, 50],
  timeframe: "1h",
  includeVolume: true,
  includeMomentum: true,
  includeVolatility: true,
  includeTrend: true,
};

export class FeatureExtractor {
  private config: FeatureConfig;

  constructor(config: Partial<FeatureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract features from a candle series. Requires enough candles
   * to cover the longest lookback period.
   */
  extract(symbol: string, candles: Candle[]): FeatureVector | null {
    const maxLookback = Math.max(...this.config.lookbackPeriods);
    if (candles.length < maxLookback + 1) {
      return null;
    }

    const features: number[] = [];
    const labels: string[] = [];
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    for (const period of this.config.lookbackPeriods) {
      const recentCloses = closes.slice(-period);
      const recentVolumes = volumes.slice(-period);
      const recentHighs = highs.slice(-period);
      const recentLows = lows.slice(-period);

      if (this.config.includeMomentum) {
        // Simple return over period
        const ret = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];
        features.push(ret);
        labels.push(`return_${period}`);

        // Rate of change
        const roc = recentCloses.length >= 2
          ? (recentCloses[recentCloses.length - 1] - recentCloses[recentCloses.length - 2]) / recentCloses[recentCloses.length - 2]
          : 0;
        features.push(roc);
        labels.push(`roc_${period}`);
      }

      if (this.config.includeVolatility) {
        // Standard deviation of returns
        const returns = this.computeReturns(recentCloses);
        const vol = this.stddev(returns);
        features.push(vol);
        labels.push(`volatility_${period}`);

        // Average true range (normalized)
        const atr = this.averageTrueRange(recentHighs, recentLows, recentCloses);
        const currentPrice = recentCloses[recentCloses.length - 1];
        features.push(currentPrice > 0 ? atr / currentPrice : 0);
        labels.push(`atr_norm_${period}`);
      }

      if (this.config.includeVolume) {
        // Volume ratio: current vs average
        const avgVol = this.mean(recentVolumes);
        const currentVol = recentVolumes[recentVolumes.length - 1];
        features.push(avgVol > 0 ? currentVol / avgVol : 1);
        labels.push(`vol_ratio_${period}`);
      }

      if (this.config.includeTrend) {
        // Price relative to SMA
        const sma = this.mean(recentCloses);
        const currentPrice = recentCloses[recentCloses.length - 1];
        features.push(sma > 0 ? (currentPrice - sma) / sma : 0);
        labels.push(`price_vs_sma_${period}`);
      }
    }

    // RSI (14-period default, or closest available)
    const rsiPeriod = Math.min(14, closes.length - 1);
    if (rsiPeriod >= 2) {
      const rsi = this.computeRSI(closes, rsiPeriod);
      features.push((rsi - 50) / 50); // normalize to [-1, 1]
      labels.push("rsi_norm");
    }

    // Bollinger Band position
    const bbPeriod = Math.min(20, closes.length);
    if (bbPeriod >= 5) {
      const bbPos = this.bollingerPosition(closes, bbPeriod);
      features.push(bbPos); // already -1..1 range roughly
      labels.push("bb_position");
    }

    return {
      timestamp: candles[candles.length - 1].timestamp,
      symbol,
      features,
      labels,
    };
  }

  /** Minimum candles needed for feature extraction */
  get minCandles(): number {
    return Math.max(...this.config.lookbackPeriods) + 1;
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  private computeReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0);
    }
    return returns;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
  }

  private stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    let sumSq = 0;
    for (const v of values) sumSq += (v - avg) ** 2;
    return Math.sqrt(sumSq / (values.length - 1));
  }

  private averageTrueRange(highs: number[], lows: number[], closes: number[]): number {
    if (highs.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      sum += tr;
    }
    return sum / (highs.length - 1);
  }

  private computeRSI(prices: number[], period: number): number {
    let gains = 0;
    let losses = 0;
    const start = prices.length - period - 1;

    for (let i = start + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private bollingerPosition(prices: number[], period: number): number {
    const recent = prices.slice(-period);
    const sma = this.mean(recent);
    const sd = this.stddev(recent);
    if (sd === 0) return 0;
    const currentPrice = prices[prices.length - 1];
    // Position within bands: (price - sma) / (2 * sd), roughly -1..1
    return (currentPrice - sma) / (2 * sd);
  }
}
