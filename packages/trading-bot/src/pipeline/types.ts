/**
 * Data Ingestion & Feature Pipeline — Type Definitions
 *
 * Normalized market data and computed feature vectors consumed by
 * strategy engines and ML models.
 */

import type { Candle, TimeFrame, Ticker, Exchange } from "../exchange/types.js";

// ─── Normalized Market Data ─────────────────────────────────────────

/** Exchange-agnostic OHLCV bar with metadata */
export interface NormalizedCandle extends Candle {
  symbol: string;
  exchange: Exchange;
  timeframe: TimeFrame;
}

/** Multi-timeframe candle set for a single symbol */
export interface MultiTimeframeData {
  symbol: string;
  exchange: Exchange;
  candles: Map<TimeFrame, NormalizedCandle[]>;
  latestTicker: Ticker | null;
}

// ─── Quality Flags ──────────────────────────────────────────────────

export type QualityFlag = "outlier_volume" | "outlier_price" | "gap_detected" | "stale_data";

// ─── Ring Buffer Config ─────────────────────────────────────────────

export interface BufferConfig {
  /** Max candles retained per symbol/timeframe pair */
  maxCandles: number;
  /** Max tickers retained per symbol */
  maxTickers: number;
}

export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxCandles: 500,
  maxTickers: 100,
};

// ─── Feature Vector ─────────────────────────────────────────────────

/** A single computed feature with metadata */
export interface Feature {
  name: string;
  value: number;
  /** NaN or null signals insufficient data — strategies must handle this */
  valid: boolean;
}

/** Complete feature snapshot for one symbol at one point in time */
export interface FeatureVector {
  symbol: string;
  exchange: Exchange;
  timestamp: number;
  timeframe: TimeFrame;
  features: Record<string, number>;
  /** Number of features that had insufficient data */
  invalidCount: number;
}

// ─── Indicator Config ───────────────────────────────────────────────

export interface IndicatorConfig {
  sma: number[];           // e.g. [7, 25, 99]
  ema: number[];           // e.g. [12, 26]
  rsi: number;             // e.g. 14
  macd: {
    fast: number;          // e.g. 12
    slow: number;          // e.g. 26
    signal: number;        // e.g. 9
  };
  bollingerBands: {
    period: number;        // e.g. 20
    stdDev: number;        // e.g. 2
  };
  atr: number;             // e.g. 14
  volumeSma: number[];     // e.g. [20]
  stochastic: {
    kPeriod: number;       // e.g. 14
    dPeriod: number;       // e.g. 3
  };
  enableObv: boolean;      // on-balance volume
  enableVwap: boolean;     // volume-weighted avg price
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  sma: [7, 25, 99],
  ema: [12, 26],
  rsi: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bollingerBands: { period: 20, stdDev: 2 },
  atr: 14,
  volumeSma: [20],
  stochastic: { kPeriod: 14, dPeriod: 3 },
  enableObv: true,
  enableVwap: true,
};

// ─── Pipeline Config ────────────────────────────────────────────────

export interface PipelineConfig {
  symbols: string[];
  timeframes: TimeFrame[];
  indicators: IndicatorConfig;
  buffer: BufferConfig;
  /** How often to recompute features (ms). 0 = on every new candle */
  recomputeIntervalMs: number;
  /** Max candles retained per symbol/timeframe series in candle store */
  maxCandlesPerSeries: number;
  /** Candles with volume below this are flagged as outliers */
  minVolumeFilter: number;
  /** Price change exceeding this % is flagged as outlier */
  maxPriceChangePct: number;
  /** Minimum candles before features are emitted */
  warmupPeriod: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  symbols: ["BTC/USDT"],
  timeframes: ["1m", "5m", "1h"],
  indicators: DEFAULT_INDICATOR_CONFIG,
  buffer: DEFAULT_BUFFER_CONFIG,
  recomputeIntervalMs: 0,
  maxCandlesPerSeries: 500,
  minVolumeFilter: 0.001,
  maxPriceChangePct: 15,
  warmupPeriod: 100,
};

// ─── Pipeline Events ────────────────────────────────────────────────

export type PipelineEvent =
  | { type: "candle_ingested"; symbol: string; timeframe: TimeFrame; exchange: Exchange }
  | { type: "ticker_ingested"; symbol: string; exchange: Exchange }
  | { type: "features_computed"; vector: FeatureVector }
  | { type: "quality_flag"; symbol: string; flag: QualityFlag; detail: string }
  | { type: "error"; message: string; source: string };

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ─── Market Microstructure Features ────────────────────────────────

export interface MicrostructureFeatures {
  /** Bid-ask spread as fraction of mid price */
  spreadPct: number;
  /** Ratio of bid volume to ask volume (top N levels) */
  bidAskImbalance: number;
  /** Order book depth on bid side (top 10 levels notional) */
  bidDepthNotional: number;
  /** Order book depth on ask side (top 10 levels notional) */
  askDepthNotional: number;
  /** Mid price from order book */
  midPrice: number;
  /** Volume-weighted mid price from best bid/ask */
  weightedMidPrice: number;
}

// ─── Regime Indicators ─────────────────────────────────────────────

export interface RegimeIndicators {
  /** Trend direction: 1 = up, -1 = down, 0 = sideways */
  trendDirection: number;
  /** Trend strength 0-1 (ratio of net change to total absolute changes) */
  trendStrength: number;
  /** Realized volatility percentile vs rolling history (0-1) */
  volatilityRegime: number;
  /** Volume relative to 20-period average */
  volumeRegime: number;
  /** Consecutive same-direction candles (positive = up, negative = down) */
  momentumStreak: number;
}

// ─── Enhanced Feature Vector ───────────────────────────────────────

export interface EnhancedFeatureVector extends FeatureVector {
  /** Order book microstructure (NaN values when no book data) */
  microstructure: Record<string, number>;
  /** Market regime classification */
  regime: Record<string, number>;
  /** Per-timeframe feature vectors for multi-timeframe analysis */
  multiTimeframe: Record<TimeFrame, Record<string, number>>;
  /** Data quality flags detected during computation */
  qualityFlags: QualityFlag[];
  /** Candle depth available per timeframe */
  dataDepth: Record<TimeFrame, number>;
}
