/**
 * Candle Store — Multi-Timeframe Ring Buffer
 *
 * Stores candle data per symbol/timeframe with bounded memory.
 * Handles missing data detection, outlier filtering, and
 * multi-timeframe aggregation from 1m base candles.
 */

import type { Candle, Ticker, TimeFrame } from "../exchange/types.js";
import type { PipelineConfig, QualityFlag } from "./types.js";

const TIMEFRAME_MS: Record<TimeFrame, number> = {
  "1m":  60_000,
  "5m":  300_000,
  "15m": 900_000,
  "1h":  3_600_000,
  "4h":  14_400_000,
  "1d":  86_400_000,
};

export class CandleStore {
  /** candles[symbol][timeframe] = Candle[] (ring buffer) */
  private candles = new Map<string, Map<TimeFrame, Candle[]>>();
  /** Partial candles being built from ticks for aggregation */
  private partials = new Map<string, Map<TimeFrame, Candle>>();
  /** Last seen timestamp per series for gap detection */
  private lastTimestamp = new Map<string, Map<TimeFrame, number>>();

  private readonly config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * Ingest a finalized candle for a specific symbol/timeframe.
   * Returns quality flags if any issues detected.
   */
  ingestCandle(symbol: string, timeframe: TimeFrame, candle: Candle): QualityFlag[] {
    const flags: QualityFlag[] = [];

    // Outlier detection
    if (candle.volume > 0 && candle.volume < this.config.minVolumeFilter) {
      flags.push("outlier_volume");
    }
    const priceChange = Math.abs((candle.close - candle.open) / candle.open) * 100;
    if (priceChange > this.config.maxPriceChangePct) {
      flags.push("outlier_price");
    }

    // Gap detection
    const lastTs = this.getLastTimestamp(symbol, timeframe);
    if (lastTs !== null) {
      const expectedGap = TIMEFRAME_MS[timeframe];
      const actualGap = candle.timestamp - lastTs;
      if (actualGap > expectedGap * 2.5) {
        flags.push("gap_detected");
      }
    }

    // Store candle
    const series = this.getSeries(symbol, timeframe);
    series.push(candle);
    if (series.length > this.config.maxCandlesPerSeries) {
      series.shift(); // ring buffer eviction
    }

    // Update last timestamp
    this.setLastTimestamp(symbol, timeframe, candle.timestamp);

    return flags;
  }

  /**
   * Aggregate a 1m candle into higher timeframes.
   * Returns list of timeframes that produced a new closed candle.
   */
  aggregateFromBase(symbol: string, candle: Candle): { timeframe: TimeFrame; candle: Candle; flags: QualityFlag[] }[] {
    const results: { timeframe: TimeFrame; candle: Candle; flags: QualityFlag[] }[] = [];

    for (const tf of this.config.timeframes) {
      if (tf === "1m") {
        // Base timeframe — ingest directly
        const flags = this.ingestCandle(symbol, "1m", candle);
        results.push({ timeframe: "1m", candle, flags });
        continue;
      }

      const tfMs = TIMEFRAME_MS[tf];
      const bucketStart = Math.floor(candle.timestamp / tfMs) * tfMs;

      const partials = this.getPartials(symbol);
      const existing = partials.get(tf);

      if (!existing || existing.timestamp !== bucketStart) {
        // New bucket — close the old partial if it exists
        if (existing) {
          existing.isClosed = true;
          const flags = this.ingestCandle(symbol, tf, { ...existing });
          results.push({ timeframe: tf, candle: { ...existing }, flags });
        }
        // Start new partial
        partials.set(tf, {
          timestamp: bucketStart,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          quoteVolume: candle.quoteVolume,
          trades: candle.trades,
          isClosed: false,
        });
      } else {
        // Update existing partial
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume += candle.volume;
        existing.quoteVolume += candle.quoteVolume;
        existing.trades += candle.trades;
      }
    }

    return results;
  }

  /**
   * Build a synthetic 1m candle from a ticker update.
   * Used when only ticker data is available (e.g., paper trading).
   */
  tickerToCandle(ticker: Ticker, intervalMs = 60_000): Candle {
    const bucketStart = Math.floor(ticker.timestamp / intervalMs) * intervalMs;
    return {
      timestamp: bucketStart,
      open: ticker.price,
      high: ticker.price,
      low: ticker.price,
      close: ticker.price,
      volume: ticker.volume24h / (86_400_000 / intervalMs), // approximate per-candle volume
      quoteVolume: ticker.price * (ticker.volume24h / (86_400_000 / intervalMs)),
      trades: 1,
      isClosed: false,
    };
  }

  /** Get all candles for a series */
  getCandles(symbol: string, timeframe: TimeFrame): Candle[] {
    return this.getSeries(symbol, timeframe);
  }

  /** Get the N most recent candles */
  getRecentCandles(symbol: string, timeframe: TimeFrame, count: number): Candle[] {
    const series = this.getSeries(symbol, timeframe);
    return series.slice(-count);
  }

  /** Get the latest candle (or null if none) */
  getLatestCandle(symbol: string, timeframe: TimeFrame): Candle | null {
    const series = this.getSeries(symbol, timeframe);
    return series.length > 0 ? series[series.length - 1] : null;
  }

  /** Number of candles stored for a series */
  depth(symbol: string, timeframe: TimeFrame): number {
    return this.getSeries(symbol, timeframe).length;
  }

  /** Bulk load historical candles (e.g., from REST API on startup) */
  loadHistory(symbol: string, timeframe: TimeFrame, candles: Candle[]): QualityFlag[] {
    const allFlags: QualityFlag[] = [];
    // Sort by timestamp ascending
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    for (const c of sorted) {
      const flags = this.ingestCandle(symbol, timeframe, c);
      allFlags.push(...flags);
    }
    return allFlags;
  }

  /** Clear all data for a symbol */
  clearSymbol(symbol: string): void {
    this.candles.delete(symbol);
    this.partials.delete(symbol);
    this.lastTimestamp.delete(symbol);
  }

  /** Clear everything */
  clearAll(): void {
    this.candles.clear();
    this.partials.clear();
    this.lastTimestamp.clear();
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private getSeries(symbol: string, timeframe: TimeFrame): Candle[] {
    let symMap = this.candles.get(symbol);
    if (!symMap) {
      symMap = new Map();
      this.candles.set(symbol, symMap);
    }
    let series = symMap.get(timeframe);
    if (!series) {
      series = [];
      symMap.set(timeframe, series);
    }
    return series;
  }

  private getPartials(symbol: string): Map<TimeFrame, Candle> {
    let partials = this.partials.get(symbol);
    if (!partials) {
      partials = new Map();
      this.partials.set(symbol, partials);
    }
    return partials;
  }

  private getLastTimestamp(symbol: string, timeframe: TimeFrame): number | null {
    return this.lastTimestamp.get(symbol)?.get(timeframe) ?? null;
  }

  private setLastTimestamp(symbol: string, timeframe: TimeFrame, ts: number): void {
    let symMap = this.lastTimestamp.get(symbol);
    if (!symMap) {
      symMap = new Map();
      this.lastTimestamp.set(symbol, symMap);
    }
    symMap.set(timeframe, ts);
  }
}
