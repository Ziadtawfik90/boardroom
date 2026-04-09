/**
 * Historical Data Loader
 *
 * Loads candle data from CSV or JSON files for backtesting.
 * Supports filtering by date range and generates Ticker objects
 * from candle data for PaperExchange consumption.
 *
 * CSV format: timestamp,open,high,low,close,volume,quoteVolume,trades
 * JSON format: array of Candle objects
 */

import { readFileSync } from "node:fs";
import type { Candle, Ticker, TimeFrame } from "../exchange/types.js";

export interface LoadedData {
  symbol: string;
  timeframe: TimeFrame;
  candles: Candle[];
  source: string;
}

export interface LoadOptions {
  symbol: string;
  timeframe: TimeFrame;
  /** Unix ms — only include candles at or after this time */
  startTime?: number;
  /** Unix ms — only include candles at or before this time */
  endTime?: number;
}

/**
 * Load candle data from a CSV file.
 *
 * Expected columns: timestamp,open,high,low,close,volume[,quoteVolume,trades]
 * First row is treated as header if it starts with a non-numeric character.
 */
export function loadCandlesFromCsv(filePath: string, options: LoadOptions): LoadedData {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.trim().split("\n");

  if (lines.length === 0) {
    return { symbol: options.symbol, timeframe: options.timeframe, candles: [], source: filePath };
  }

  // Skip header if present
  let startLine = 0;
  if (lines[0] && /^[a-zA-Z]/.test(lines[0])) {
    startLine = 1;
  }

  const candles: Candle[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    if (cols.length < 6) continue;

    const timestamp = Number(cols[0]);
    if (Number.isNaN(timestamp)) continue;

    if (options.startTime && timestamp < options.startTime) continue;
    if (options.endTime && timestamp > options.endTime) continue;

    candles.push({
      timestamp,
      open: Number(cols[1]),
      high: Number(cols[2]),
      low: Number(cols[3]),
      close: Number(cols[4]),
      volume: Number(cols[5]),
      quoteVolume: cols[6] ? Number(cols[6]) : 0,
      trades: cols[7] ? Number(cols[7]) : 0,
      isClosed: true,
    });
  }

  // Sort chronologically
  candles.sort((a, b) => a.timestamp - b.timestamp);

  return { symbol: options.symbol, timeframe: options.timeframe, candles, source: filePath };
}

/**
 * Load candle data from a JSON file.
 *
 * Expects an array of Candle-compatible objects.
 */
export function loadCandlesFromJson(filePath: string, options: LoadOptions): LoadedData {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;

  let candles: Candle[] = parsed.map(item => ({
    timestamp: Number(item.timestamp ?? item.time ?? item.t ?? 0),
    open: Number(item.open ?? item.o ?? 0),
    high: Number(item.high ?? item.h ?? 0),
    low: Number(item.low ?? item.l ?? 0),
    close: Number(item.close ?? item.c ?? 0),
    volume: Number(item.volume ?? item.v ?? 0),
    quoteVolume: Number(item.quoteVolume ?? item.qv ?? 0),
    trades: Number(item.trades ?? item.n ?? 0),
    isClosed: true,
  }));

  if (options.startTime) candles = candles.filter(c => c.timestamp >= options.startTime!);
  if (options.endTime) candles = candles.filter(c => c.timestamp <= options.endTime!);

  candles.sort((a, b) => a.timestamp - b.timestamp);

  return { symbol: options.symbol, timeframe: options.timeframe, candles, source: filePath };
}

/**
 * Auto-detect format and load candle data.
 */
export function loadCandles(filePath: string, options: LoadOptions): LoadedData {
  if (filePath.endsWith(".json")) {
    return loadCandlesFromJson(filePath, options);
  }
  return loadCandlesFromCsv(filePath, options);
}

/**
 * Convert a Candle to a synthetic Ticker for PaperExchange consumption.
 * Uses close price with a synthetic spread.
 */
export function candleToTicker(candle: Candle, symbol: string, spreadPct = 0.001): Ticker {
  const halfSpread = candle.close * spreadPct / 2;
  return {
    symbol,
    price: candle.close,
    bid: candle.close - halfSpread,
    ask: candle.close + halfSpread,
    volume24h: candle.volume,
    timestamp: candle.timestamp,
  };
}

/**
 * Generate synthetic candle data for testing.
 * Creates a random walk starting from a given price.
 */
export function generateSyntheticCandles(options: {
  symbol: string;
  startPrice: number;
  count: number;
  timeframe: TimeFrame;
  volatility?: number;
  trend?: number;
  startTime?: number;
}): Candle[] {
  const {
    startPrice,
    count,
    volatility = 0.02,
    trend = 0,
    startTime = Date.now() - count * 60_000,
  } = options;

  const tfMs: Record<TimeFrame, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };

  const intervalMs = tfMs[options.timeframe];
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const open = price;
    // Random walk with trend bias
    const change1 = price * (Math.random() - 0.5 + trend) * volatility;
    const change2 = price * (Math.random() - 0.5 + trend) * volatility;
    const change3 = price * (Math.random() - 0.5 + trend) * volatility;
    const mid = open + change1;
    const close = mid + change2;
    const extreme = mid + change3;

    const high = Math.max(open, close, mid, extreme);
    const low = Math.min(open, close, mid, extreme);
    const volume = 100 + Math.random() * 900;

    candles.push({
      timestamp: startTime + i * intervalMs,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      trades: Math.floor(50 + Math.random() * 200),
      isClosed: true,
    });

    price = close;
  }

  return candles;
}
