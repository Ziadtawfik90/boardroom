/**
 * Feature Engine — Computes feature vectors from normalized candle data.
 *
 * Takes an IndicatorConfig, pulls candles from the DataStore, runs all
 * configured indicators, and returns a flat FeatureVector ready for
 * strategy/ML consumption.
 */

import type { TimeFrame, Exchange, OrderBookSnapshot } from "../exchange/types.js";
import type { NormalizedCandle, IndicatorConfig, FeatureVector, EnhancedFeatureVector, QualityFlag } from "./types.js";
import { DEFAULT_INDICATOR_CONFIG } from "./types.js";
import { DataStore } from "./data-store.js";
import * as ind from "./indicators.js";

export class FeatureEngine {
  private config: IndicatorConfig;

  constructor(config: Partial<IndicatorConfig> = {}) {
    this.config = { ...DEFAULT_INDICATOR_CONFIG, ...config };
  }

  /** Compute full feature vector for a symbol/exchange/timeframe */
  compute(
    store: DataStore,
    exchange: Exchange,
    symbol: string,
    timeframe: TimeFrame,
  ): FeatureVector {
    const candles = store.getCandles(exchange, symbol, timeframe);
    return this.computeFromCandles(candles, exchange, symbol, timeframe);
  }

  /** Compute features directly from a candle array (useful for backtesting) */
  computeFromCandles(
    candles: NormalizedCandle[],
    exchange: Exchange,
    symbol: string,
    timeframe: TimeFrame,
  ): FeatureVector {
    const features: Record<string, number> = {};
    let invalidCount = 0;

    const track = (name: string, value: number): void => {
      features[name] = value;
      if (isNaN(value)) invalidCount++;
    };

    // ── Price features ──────────────────────────────────────────
    const pf = ind.priceFeatures(candles);
    for (const [key, val] of Object.entries(pf)) {
      track(key, val);
    }

    // Current price for normalization
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : NaN;
    track("close", currentPrice);

    // ── SMA ─────────────────────────────────────────────────────
    for (const period of this.config.sma) {
      const val = ind.sma(candles, period);
      track(`sma_${period}`, val);
      // Price distance from SMA (normalized)
      track(`sma_${period}_dist`, !isNaN(val) && val !== 0 ? (currentPrice - val) / val : NaN);
    }

    // ── EMA ─────────────────────────────────────────────────────
    for (const period of this.config.ema) {
      const val = ind.ema(candles, period);
      track(`ema_${period}`, val);
      track(`ema_${period}_dist`, !isNaN(val) && val !== 0 ? (currentPrice - val) / val : NaN);
    }

    // ── RSI ─────────────────────────────────────────────────────
    track("rsi", ind.rsi(candles, this.config.rsi));

    // ── MACD ────────────────────────────────────────────────────
    const macdResult = ind.macd(
      candles,
      this.config.macd.fast,
      this.config.macd.slow,
      this.config.macd.signal,
    );
    track("macd", macdResult.macd);
    track("macd_signal", macdResult.signal);
    track("macd_histogram", macdResult.histogram);

    // ── Bollinger Bands ─────────────────────────────────────────
    const bb = ind.bollingerBands(
      candles,
      this.config.bollingerBands.period,
      this.config.bollingerBands.stdDev,
    );
    track("bb_upper", bb.upper);
    track("bb_middle", bb.middle);
    track("bb_lower", bb.lower);
    track("bb_bandwidth", bb.bandwidth);
    track("bb_percentB", bb.percentB);

    // ── ATR ─────────────────────────────────────────────────────
    const atrVal = ind.atr(candles, this.config.atr);
    track("atr", atrVal);
    // Normalized ATR (as % of price)
    track("atr_pct", !isNaN(atrVal) && currentPrice > 0 ? atrVal / currentPrice : NaN);

    // ── Volume ──────────────────────────────────────────────────
    for (const period of this.config.volumeSma) {
      track(`vol_sma_${period}`, ind.volumeSma(candles, period));
      track(`vol_ratio_${period}`, ind.volumeRatio(candles, period));
    }

    // ── Stochastic Oscillator ──────────────────────────────────
    const stoch = ind.stochastic(
      candles,
      this.config.stochastic.kPeriod,
      this.config.stochastic.dPeriod,
    );
    track("stoch_k", stoch.k);
    track("stoch_d", stoch.d);

    // ── OBV (On-Balance Volume) ────────────────────────────────
    if (this.config.enableObv) {
      track("obv", ind.obv(candles));
    }

    // ── VWAP ───────────────────────────────────────────────────
    if (this.config.enableVwap) {
      const vwapVal = ind.vwap(candles);
      track("vwap", vwapVal);
      // Price distance from VWAP (normalized)
      track("vwap_dist", !isNaN(vwapVal) && vwapVal !== 0
        ? (currentPrice - vwapVal) / vwapVal
        : NaN);
    }

    // ── Cross-indicator signals ─────────────────────────────────
    // EMA cross (fast above slow = bullish)
    if (this.config.ema.length >= 2) {
      const fastEma = features[`ema_${this.config.ema[0]}`];
      const slowEma = features[`ema_${this.config.ema[1]}`];
      track("ema_cross", !isNaN(fastEma) && !isNaN(slowEma) && slowEma !== 0
        ? (fastEma - slowEma) / slowEma
        : NaN);
    }

    // ── Rate of Change ─────────────────────────────────────────
    for (const period of [7, 14, 21]) {
      track(`roc_${period}`, ind.roc(candles, period));
    }

    // ── Realized Volatility ────────────────────────────────────
    for (const period of [7, 14, 21]) {
      track(`realized_vol_${period}`, ind.realizedVolatility(candles, period));
    }

    // ── Trend & Momentum ───────────────────────────────────────
    track("momentum_streak", ind.momentumStreak(candles));
    track("trend_strength_20", ind.trendStrength(candles, 20));
    track("trend_direction", ind.trendDirection(candles));

    return {
      symbol,
      exchange,
      timestamp: candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now(),
      timeframe,
      features,
      invalidCount,
    };
  }

  /**
   * Compute an enhanced feature vector with microstructure, regime,
   * and multi-timeframe data. This is the full ML-ready feature set.
   */
  computeEnhanced(
    store: DataStore,
    exchange: Exchange,
    symbol: string,
    timeframes: TimeFrame[],
    orderBook?: OrderBookSnapshot,
  ): EnhancedFeatureVector {
    const primaryTf = timeframes[0] ?? "1m";
    const baseVector = this.compute(store, exchange, symbol, primaryTf);
    const candles = store.getCandles(exchange, symbol, primaryTf);

    // Microstructure from order book
    const microstructure = ind.microstructureFeatures(orderBook);

    // Regime indicators from primary timeframe
    const regime = ind.regimeIndicators(candles);

    // Multi-timeframe features
    const multiTimeframe: Record<TimeFrame, Record<string, number>> = {} as any;
    const dataDepth: Record<TimeFrame, number> = {} as any;
    for (const tf of timeframes) {
      const tfCandles = store.getCandles(exchange, symbol, tf);
      const tfVector = this.computeFromCandles(tfCandles, exchange, symbol, tf);
      multiTimeframe[tf] = tfVector.features;
      dataDepth[tf] = tfCandles.length;
    }

    // Quality flags
    const qualityFlags: QualityFlag[] = [];
    if (candles.length < 100) qualityFlags.push("stale_data");
    if (!orderBook) qualityFlags.push("stale_data");

    return {
      ...baseVector,
      microstructure,
      regime,
      multiTimeframe,
      qualityFlags,
      dataDepth,
    };
  }

  /** Get the list of feature names this engine will produce */
  getFeatureNames(): string[] {
    const names: string[] = [
      "returnPct", "logReturn", "bodyRatio", "upperWick", "lowerWick",
      "close",
    ];

    for (const p of this.config.sma) {
      names.push(`sma_${p}`, `sma_${p}_dist`);
    }
    for (const p of this.config.ema) {
      names.push(`ema_${p}`, `ema_${p}_dist`);
    }
    names.push("rsi");
    names.push("macd", "macd_signal", "macd_histogram");
    names.push("bb_upper", "bb_middle", "bb_lower", "bb_bandwidth", "bb_percentB");
    names.push("atr", "atr_pct");
    for (const p of this.config.volumeSma) {
      names.push(`vol_sma_${p}`, `vol_ratio_${p}`);
    }
    names.push("stoch_k", "stoch_d");
    if (this.config.enableObv) names.push("obv");
    if (this.config.enableVwap) names.push("vwap", "vwap_dist");
    if (this.config.ema.length >= 2) {
      names.push("ema_cross");
    }

    return names;
  }
}
