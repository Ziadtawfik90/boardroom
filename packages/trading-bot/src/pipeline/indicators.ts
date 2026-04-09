/**
 * Technical Indicators — Pure functions over candle arrays.
 *
 * Every function returns NaN when insufficient data is available.
 * Callers (the feature pipeline) mark features invalid when NaN.
 */

import type { NormalizedCandle } from "./types.js";

// ─── Moving Averages ────────────────────────────────────────────────

/** Simple Moving Average of close prices */
export function sma(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period) return NaN;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += candles[i].close;
  }
  return sum / period;
}

/** Exponential Moving Average of close prices */
export function ema(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period) return NaN;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` candles
  let value = 0;
  for (let i = 0; i < period; i++) {
    value += candles[i].close;
  }
  value /= period;
  // Apply EMA from period onward
  for (let i = period; i < candles.length; i++) {
    value = candles[i].close * k + value * (1 - k);
  }
  return value;
}

// ─── RSI ────────────────────────────────────────────────────────────

/** Relative Strength Index (Wilder's smoothing) */
export function rsi(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period + 1) return NaN;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining candles
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ───────────────────────────────────────────────────────────

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/** MACD with configurable fast/slow/signal periods */
export function macd(
  candles: NormalizedCandle[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MACDResult {
  const fastEma = ema(candles, fastPeriod);
  const slowEma = ema(candles, slowPeriod);

  if (isNaN(fastEma) || isNaN(slowEma)) {
    return { macd: NaN, signal: NaN, histogram: NaN };
  }

  const macdLine = fastEma - slowEma;

  // Build MACD series for signal line computation
  if (candles.length < slowPeriod + signalPeriod) {
    return { macd: macdLine, signal: NaN, histogram: NaN };
  }

  // Compute MACD values over a window for signal EMA
  const macdValues: number[] = [];
  for (let end = slowPeriod; end <= candles.length; end++) {
    const slice = candles.slice(0, end);
    const f = ema(slice, fastPeriod);
    const s = ema(slice, slowPeriod);
    if (!isNaN(f) && !isNaN(s)) {
      macdValues.push(f - s);
    }
  }

  if (macdValues.length < signalPeriod) {
    return { macd: macdLine, signal: NaN, histogram: NaN };
  }

  // Signal line = EMA of MACD values
  const k = 2 / (signalPeriod + 1);
  let signalLine = 0;
  for (let i = 0; i < signalPeriod; i++) {
    signalLine += macdValues[i];
  }
  signalLine /= signalPeriod;
  for (let i = signalPeriod; i < macdValues.length; i++) {
    signalLine = macdValues[i] * k + signalLine * (1 - k);
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

// ─── Bollinger Bands ────────────────────────────────────────────────

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
}

/** Bollinger Bands = SMA ± (stdDev × multiplier) */
export function bollingerBands(
  candles: NormalizedCandle[],
  period: number,
  stdDevMultiplier: number,
): BollingerBandsResult {
  const middle = sma(candles, period);
  if (isNaN(middle)) {
    return { upper: NaN, middle: NaN, lower: NaN, bandwidth: NaN, percentB: NaN };
  }

  let sumSq = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - middle;
    sumSq += diff * diff;
  }
  const stdDev = Math.sqrt(sumSq / period);

  const upper = middle + stdDev * stdDevMultiplier;
  const lower = middle - stdDev * stdDevMultiplier;
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const currentPrice = candles[candles.length - 1].close;
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  return { upper, middle, lower, bandwidth, percentB };
}

// ─── ATR (Average True Range) ───────────────────────────────────────

/** Average True Range — volatility indicator */
export function atr(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period + 1) return NaN;

  // True Range for each candle (starting from index 1)
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  if (trueRanges.length < period) return NaN;

  // Initial ATR = simple average of first `period` TRs
  let atrValue = 0;
  for (let i = 0; i < period; i++) {
    atrValue += trueRanges[i];
  }
  atrValue /= period;

  // Wilder smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atrValue = (atrValue * (period - 1) + trueRanges[i]) / period;
  }

  return atrValue;
}

// ─── Volume Indicators ──────────────────────────────────────────────

/** Simple Moving Average of volume */
export function volumeSma(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period) return NaN;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += candles[i].volume;
  }
  return sum / period;
}

/** Volume ratio = current volume / SMA(volume) — measures volume spike */
export function volumeRatio(candles: NormalizedCandle[], period: number): number {
  const avg = volumeSma(candles, period);
  if (isNaN(avg) || avg === 0) return NaN;
  return candles[candles.length - 1].volume / avg;
}

// ─── Stochastic Oscillator ──────────────────────────────────────────

export interface StochasticResult {
  k: number;
  d: number;
}

/** Stochastic Oscillator — %K and %D (SMA of %K) */
export function stochastic(
  candles: NormalizedCandle[],
  kPeriod: number,
  dPeriod: number,
): StochasticResult {
  if (candles.length < kPeriod + dPeriod - 1) return { k: NaN, d: NaN };

  const kValues: number[] = [];
  for (let end = candles.length - dPeriod; end < candles.length; end++) {
    const start = end - kPeriod + 1;
    if (start < 0) return { k: NaN, d: NaN };

    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = start; j <= end; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }

    const range = highest - lowest;
    kValues.push(range === 0 ? 50 : ((candles[end].close - lowest) / range) * 100);
  }

  const k = kValues[kValues.length - 1];
  const d = kValues.reduce((a, b) => a + b, 0) / kValues.length;
  return { k, d };
}

// ─── On-Balance Volume (OBV) ────────────────────────────────────────

/** On-Balance Volume — cumulative volume flow */
export function obv(candles: NormalizedCandle[]): number {
  if (candles.length < 2) return NaN;
  let value = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) value += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) value -= candles[i].volume;
  }
  return value;
}

// ─── VWAP (Volume-Weighted Average Price) ───────────────────────────

/** VWAP — computed over all provided candles */
export function vwap(candles: NormalizedCandle[]): number {
  if (candles.length === 0) return NaN;
  let cumTPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? NaN : cumTPV / cumVol;
}

// ─── Price-Derived Features ─────────────────────────────────────────

/** Returns-based features for the most recent candle */
export function priceFeatures(candles: NormalizedCandle[]): Record<string, number> {
  if (candles.length < 2) {
    return { returnPct: NaN, logReturn: NaN, bodyRatio: NaN, upperWick: NaN, lowerWick: NaN };
  }

  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const returnPct = prev.close !== 0 ? (curr.close - prev.close) / prev.close : 0;
  const logReturn = prev.close > 0 && curr.close > 0 ? Math.log(curr.close / prev.close) : NaN;

  // Candlestick structure features
  const range = curr.high - curr.low;
  const body = Math.abs(curr.close - curr.open);
  const bodyRatio = range > 0 ? body / range : 0;
  const upperWick = range > 0 ? (curr.high - Math.max(curr.open, curr.close)) / range : 0;
  const lowerWick = range > 0 ? (Math.min(curr.open, curr.close) - curr.low) / range : 0;

  return { returnPct, logReturn, bodyRatio, upperWick, lowerWick };
}

// ─── Rate of Change ────────────────────────────────────────────────

/** Rate of Change (%) over `period` candles */
export function roc(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const current = candles[candles.length - 1].close;
  const previous = candles[candles.length - 1 - period].close;
  return previous !== 0 ? ((current - previous) / previous) * 100 : NaN;
}

// ─── Realized Volatility ──────────────────────────────────────────

/** Standard deviation of log returns over `period` candles */
export function realizedVolatility(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const slice = candles.slice(-(period + 1));
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close > 0 && slice[i - 1].close > 0) {
      returns.push(Math.log(slice[i].close / slice[i - 1].close));
    }
  }
  if (returns.length < 2) return NaN;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// ─── Momentum & Trend ──────────────────────────────────────────────

/** Consecutive same-direction candles (positive = up, negative = down) */
export function momentumStreak(candles: NormalizedCandle[]): number {
  if (candles.length < 2) return 0;
  let streak = 0;
  const lastDir = candles[candles.length - 1].close >= candles[candles.length - 1].open ? 1 : -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    const dir = candles[i].close >= candles[i].open ? 1 : -1;
    if (dir === lastDir) streak++;
    else break;
  }
  return streak * lastDir;
}

/** Trend strength: ratio of net change to total absolute changes (0-1) */
export function trendStrength(candles: NormalizedCandle[], period: number): number {
  if (candles.length < period) return NaN;
  const slice = candles.slice(-period);
  const netChange = Math.abs(slice[slice.length - 1].close - slice[0].close);
  let totalChange = 0;
  for (let i = 1; i < slice.length; i++) {
    totalChange += Math.abs(slice[i].close - slice[i - 1].close);
  }
  return totalChange > 0 ? netChange / totalChange : 0;
}

/** Trend direction via SMA crossover: 1=up, -1=down, 0=neutral */
export function trendDirection(candles: NormalizedCandle[], shortPeriod = 20, longPeriod = 50): number {
  const shortSma = sma(candles, shortPeriod);
  const longSma = sma(candles, longPeriod);
  if (isNaN(shortSma) || isNaN(longSma) || longSma === 0) return 0;
  const diff = (shortSma - longSma) / longSma;
  if (diff > 0.005) return 1;
  if (diff < -0.005) return -1;
  return 0;
}

/** Volatility percentile: where current vol sits vs rolling history (0-1) */
export function volatilityPercentile(candles: NormalizedCandle[], volPeriod = 14, lookback = 100): number {
  if (candles.length < lookback + volPeriod) return 0.5;
  const currentVol = realizedVolatility(candles, volPeriod);
  if (isNaN(currentVol)) return 0.5;
  let below = 0;
  for (let end = candles.length - 1; end >= candles.length - lookback; end--) {
    const slice = candles.slice(0, end);
    const vol = realizedVolatility(slice, volPeriod);
    if (!isNaN(vol) && vol < currentVol) below++;
  }
  return below / lookback;
}

// ─── Order Book Microstructure ─────────────────────────────────────

import type { OrderBookSnapshot } from "../exchange/types.js";

/** Compute microstructure features from an order book snapshot */
export function microstructureFeatures(book: OrderBookSnapshot | undefined): Record<string, number> {
  if (!book || book.bids.length === 0 || book.asks.length === 0) {
    return {
      spreadPct: NaN, bidAskImbalance: NaN,
      bidDepthNotional: NaN, askDepthNotional: NaN,
      midPrice: NaN, weightedMidPrice: NaN,
    };
  }

  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  const midPrice = (bestBid.price + bestAsk.price) / 2;
  const spreadPct = midPrice > 0 ? (bestAsk.price - bestBid.price) / midPrice : NaN;

  const totalBestVol = bestBid.quantity + bestAsk.quantity;
  const weightedMidPrice = totalBestVol > 0
    ? (bestBid.price * bestAsk.quantity + bestAsk.price * bestBid.quantity) / totalBestVol
    : midPrice;

  const depth = Math.min(10, book.bids.length, book.asks.length);
  let bidDepthNotional = 0;
  let askDepthNotional = 0;
  let bidVolume = 0;
  let askVolume = 0;
  for (let i = 0; i < depth; i++) {
    if (i < book.bids.length) {
      bidDepthNotional += book.bids[i].price * book.bids[i].quantity;
      bidVolume += book.bids[i].quantity;
    }
    if (i < book.asks.length) {
      askDepthNotional += book.asks[i].price * book.asks[i].quantity;
      askVolume += book.asks[i].quantity;
    }
  }

  const totalVolume = bidVolume + askVolume;
  const bidAskImbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

  return { spreadPct, bidAskImbalance, bidDepthNotional, askDepthNotional, midPrice, weightedMidPrice };
}

// ─── Regime Classification ─────────────────────────────────────────

/** Compute all regime indicators from candle history */
export function regimeIndicators(candles: NormalizedCandle[]): Record<string, number> {
  const volAvg = candles.length >= 21
    ? candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20
    : 0;
  const relVol = volAvg > 0 && candles.length > 0
    ? candles[candles.length - 1].volume / volAvg
    : 1;

  return {
    trendDirection: trendDirection(candles),
    trendStrength: candles.length >= 20 ? trendStrength(candles, 20) : 0,
    volatilityRegime: volatilityPercentile(candles),
    volumeRegime: relVol,
    momentumStreak: momentumStreak(candles),
  };
}
