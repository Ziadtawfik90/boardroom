/**
 * Technical Indicators — Shared Utilities
 *
 * Lightweight, dependency-free implementations used by baseline strategies.
 */

/** Simple Moving Average */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/** Exponential Moving Average */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let avg = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    avg = values[i] * k + avg * (1 - k);
  }
  return avg;
}

/** Relative Strength Index (0-100) */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth using Wilder's method
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (delta < 0 ? Math.abs(delta) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Bollinger Bands: { upper, middle, lower, bandwidth } */
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): { upper: number; middle: number; lower: number; bandwidth: number } | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;

  return {
    upper,
    middle,
    lower,
    bandwidth: middle > 0 ? (upper - lower) / middle : 0,
  };
}

/** Rate of Change (percentage) */
export function roc(values: number[], period: number): number | null {
  if (values.length <= period) return null;
  const current = values[values.length - 1];
  const past = values[values.length - 1 - period];
  if (past === 0) return null;
  return ((current - past) / past) * 100;
}

/** Average True Range */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (highs.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  // Simple average of last `period` true ranges
  const slice = trueRanges.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}
