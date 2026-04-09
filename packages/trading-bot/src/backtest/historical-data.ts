/**
 * Historical Data Manager
 *
 * Loads, validates, and manages historical candle data for backtesting.
 * Supports:
 * - Loading from JSON/CSV files
 * - Synthetic data generation for testing
 * - Data quality validation (gaps, outliers, sufficient length)
 * - Splitting data into train/test windows
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { Candle, TimeFrame } from "../exchange/types.js";

// ─── Timeframe Milliseconds ─────────────────────────────────────────

const TIMEFRAME_MS: Record<TimeFrame, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// ─── Data Quality ───────────────────────────────────────────────────

export interface DataQualityReport {
  totalCandles: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  gaps: { index: number; expectedMs: number; actualMs: number }[];
  outliers: { index: number; field: string; value: number; zScore: number }[];
  duplicates: number;
  valid: boolean;
  warnings: string[];
}

// ─── Historical Data Manager ────────────────────────────────────────

export class HistoricalDataManager {
  /**
   * Load candle data from a JSON file.
   * Expected format: array of objects with { timestamp, open, high, low, close, volume }
   */
  async loadJSON(filePath: string): Promise<Candle[]> {
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      throw new Error(`Expected array in ${filePath}, got ${typeof data}`);
    }

    const candles: Candle[] = data.map((row: Record<string, unknown>) => ({
      timestamp: Number(row.timestamp ?? row.time ?? row.t),
      open: Number(row.open ?? row.o),
      high: Number(row.high ?? row.h),
      low: Number(row.low ?? row.l),
      close: Number(row.close ?? row.c),
      volume: Number(row.volume ?? row.v ?? 0),
      quoteVolume: Number(row.quoteVolume ?? row.qv ?? 0),
      trades: Number(row.trades ?? row.n ?? 0),
      isClosed: true,
    }));

    return candles.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Load candle data from a CSV file.
   * Expected columns: timestamp,open,high,low,close,volume
   * (header row is auto-detected and skipped)
   */
  async loadCSV(filePath: string): Promise<Candle[]> {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n");

    if (lines.length < 2) {
      throw new Error(`CSV file ${filePath} has insufficient data`);
    }

    // Detect if first line is a header
    const firstLine = lines[0].split(",");
    const hasHeader = firstLine.some(cell => /^[a-zA-Z]/.test(cell.trim()));
    const startIdx = hasHeader ? 1 : 0;

    // Build column mapping from header
    let colMap = { ts: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
    if (hasHeader) {
      const headerLower = firstLine.map(h => h.trim().toLowerCase());
      const tsIdx = headerLower.findIndex(h => h === "timestamp" || h === "time" || h === "date" || h === "t");
      const oIdx = headerLower.findIndex(h => h === "open" || h === "o");
      const hIdx = headerLower.findIndex(h => h === "high" || h === "h");
      const lIdx = headerLower.findIndex(h => h === "low" || h === "l");
      const cIdx = headerLower.findIndex(h => h === "close" || h === "c");
      const vIdx = headerLower.findIndex(h => h === "volume" || h === "v" || h === "vol");
      if (tsIdx >= 0) colMap.ts = tsIdx;
      if (oIdx >= 0) colMap.o = oIdx;
      if (hIdx >= 0) colMap.h = hIdx;
      if (lIdx >= 0) colMap.l = lIdx;
      if (cIdx >= 0) colMap.c = cIdx;
      if (vIdx >= 0) colMap.v = vIdx;
    }

    const candles: Candle[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(",").map(s => s.trim());
      if (cols.length < 5) continue;

      let timestamp = Number(cols[colMap.ts]);
      // Auto-detect seconds vs milliseconds
      if (timestamp < 1e12) timestamp *= 1000;

      candles.push({
        timestamp,
        open: Number(cols[colMap.o]),
        high: Number(cols[colMap.h]),
        low: Number(cols[colMap.l]),
        close: Number(cols[colMap.c]),
        volume: Number(cols[colMap.v] ?? 0),
        quoteVolume: 0,
        trades: 0,
        isClosed: true,
      });
    }

    return candles.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Save candle data to a JSON file.
   */
  async saveJSON(filePath: string, candles: Candle[]): Promise<void> {
    const data = candles.map(c => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      quoteVolume: c.quoteVolume,
      trades: c.trades,
    }));
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Validate candle data quality for backtesting suitability.
   */
  validate(candles: Candle[], timeframe: TimeFrame): DataQualityReport {
    const report: DataQualityReport = {
      totalCandles: candles.length,
      startTime: candles[0]?.timestamp ?? 0,
      endTime: candles[candles.length - 1]?.timestamp ?? 0,
      durationMs: 0,
      gaps: [],
      outliers: [],
      duplicates: 0,
      valid: true,
      warnings: [],
    };

    if (candles.length === 0) {
      report.valid = false;
      report.warnings.push("Empty candle data");
      return report;
    }

    report.durationMs = report.endTime - report.startTime;
    const expectedGap = TIMEFRAME_MS[timeframe];

    // Detect gaps and duplicates
    for (let i = 1; i < candles.length; i++) {
      const gap = candles[i].timestamp - candles[i - 1].timestamp;
      if (gap === 0) {
        report.duplicates++;
      } else if (gap > expectedGap * 2) {
        report.gaps.push({
          index: i,
          expectedMs: expectedGap,
          actualMs: gap,
        });
      }
    }

    // Detect price outliers using z-scores on returns
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1].close;
      if (prev > 0) returns.push((candles[i].close - prev) / prev);
    }

    if (returns.length > 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const std = Math.sqrt(
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length,
      );

      if (std > 0) {
        for (let i = 0; i < returns.length; i++) {
          const z = Math.abs((returns[i] - mean) / std);
          if (z > 5) {
            report.outliers.push({
              index: i + 1,
              field: "close",
              value: candles[i + 1].close,
              zScore: z,
            });
          }
        }
      }
    }

    // OHLC sanity checks
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.high < c.low) {
        report.warnings.push(`Bar ${i}: high (${c.high}) < low (${c.low})`);
      }
      if (c.open > c.high || c.open < c.low) {
        report.warnings.push(`Bar ${i}: open (${c.open}) outside high/low range`);
      }
      if (c.close > c.high || c.close < c.low) {
        report.warnings.push(`Bar ${i}: close (${c.close}) outside high/low range`);
      }
      if (c.close <= 0 || c.open <= 0) {
        report.warnings.push(`Bar ${i}: non-positive price detected`);
        report.valid = false;
      }
    }

    // Quality thresholds
    const gapRatio = report.gaps.length / candles.length;
    if (gapRatio > 0.05) {
      report.warnings.push(`High gap ratio: ${(gapRatio * 100).toFixed(1)}% of bars have gaps`);
    }
    if (report.duplicates > 0) {
      report.warnings.push(`${report.duplicates} duplicate timestamps found`);
    }
    if (report.outliers.length > candles.length * 0.01) {
      report.warnings.push(`Excessive outliers: ${report.outliers.length} detected`);
    }
    if (candles.length < 100) {
      report.warnings.push("Insufficient data: <100 candles may produce unreliable backtest results");
      report.valid = false;
    }

    return report;
  }

  /**
   * Remove duplicate timestamps and sort chronologically.
   */
  deduplicate(candles: Candle[]): Candle[] {
    const seen = new Set<number>();
    const result: Candle[] = [];
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    for (const c of sorted) {
      if (!seen.has(c.timestamp)) {
        seen.add(c.timestamp);
        result.push(c);
      }
    }
    return result;
  }

  /**
   * Generate synthetic candle data for testing.
   * Uses geometric Brownian motion with configurable drift and volatility.
   */
  generateSynthetic(options: {
    bars: number;
    startPrice: number;
    startTimestamp: number;
    timeframe: TimeFrame;
    /** Annualized drift (e.g., 0.2 = 20% annual return). Default: 0 */
    drift?: number;
    /** Annualized volatility (e.g., 0.8 = 80%). Default: 0.6 */
    volatility?: number;
    /** Random seed for reproducibility */
    seed?: number;
  }): Candle[] {
    const {
      bars, startPrice, startTimestamp, timeframe,
      drift = 0, volatility = 0.6,
    } = options;

    const intervalMs = TIMEFRAME_MS[timeframe];
    const barsPerYear = (365 * 24 * 60 * 60 * 1000) / intervalMs;
    const dt = 1 / barsPerYear;
    const driftPerBar = drift * dt;
    const volPerBar = volatility * Math.sqrt(dt);

    // Simple seeded PRNG (Mulberry32)
    let seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
    function random(): number {
      seed += 0x6D2B79F5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Box-Muller for normal distribution
    function normalRandom(): number {
      const u1 = random();
      const u2 = random();
      return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    }

    const candles: Candle[] = [];
    let price = startPrice;

    for (let i = 0; i < bars; i++) {
      const open = price;

      // Simulate intra-bar price path (4 sub-steps for OHLC)
      const subSteps = 4;
      let high = open;
      let low = open;
      let current = open;

      for (let s = 0; s < subSteps; s++) {
        const dW = normalRandom();
        const logReturn = driftPerBar / subSteps + (volPerBar / Math.sqrt(subSteps)) * dW;
        current = current * Math.exp(logReturn);
        high = Math.max(high, current);
        low = Math.min(low, current);
      }

      const close = current;
      const volume = (500 + random() * 1500) * (startPrice / close);

      candles.push({
        timestamp: startTimestamp + i * intervalMs,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume: volume * close,
        trades: Math.floor(100 + random() * 500),
        isClosed: true,
      });

      price = close;
    }

    return candles;
  }

  /**
   * Generate synthetic data with regime changes baked in.
   * Useful for testing regime detection and strategy robustness.
   */
  generateMultiRegime(options: {
    startPrice: number;
    startTimestamp: number;
    timeframe: TimeFrame;
    /** Regime schedule: each entry is [regime, bars] */
    regimes: Array<[regime: "bull" | "bear" | "sideways", bars: number]>;
    seed?: number;
  }): Candle[] {
    const allCandles: Candle[] = [];
    let currentPrice = options.startPrice;
    let currentTimestamp = options.startTimestamp;
    let seed = options.seed ?? 42;

    for (const [regime, bars] of options.regimes) {
      const drift = regime === "bull" ? 0.5 : regime === "bear" ? -0.4 : 0.0;
      const vol = regime === "sideways" ? 0.2 : 0.6;

      const segment = this.generateSynthetic({
        bars,
        startPrice: currentPrice,
        startTimestamp: currentTimestamp,
        timeframe: options.timeframe,
        drift,
        volatility: vol,
        seed: seed++,
      });

      allCandles.push(...segment);

      if (segment.length > 0) {
        currentPrice = segment[segment.length - 1].close;
        currentTimestamp = segment[segment.length - 1].timestamp + TIMEFRAME_MS[options.timeframe];
      }
    }

    return allCandles;
  }

  /**
   * Check if a file exists (for conditional loading).
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}
