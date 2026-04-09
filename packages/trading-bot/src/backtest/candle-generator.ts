/**
 * Synthetic Candle Generator
 *
 * Generates realistic OHLCV candle data using Geometric Brownian Motion
 * with configurable market regime schedules. Produces data suitable for
 * backtesting across bull, bear, sideways, volatile, and crash conditions.
 */

import type { Candle, TimeFrame } from "../exchange/types.js";

export type SimRegime = "bull" | "bear" | "sideways" | "volatile" | "crash";

export interface RegimePhase {
  regime: SimRegime;
  /** Number of candles in this phase */
  bars: number;
}

const REGIME_PARAMS: Record<SimRegime, { drift: number; volatility: number }> = {
  bull:     { drift: 0.30,  volatility: 0.40 },
  bear:     { drift: -0.25, volatility: 0.50 },
  sideways: { drift: 0.0,   volatility: 0.20 },
  volatile: { drift: 0.0,   volatility: 0.80 },
  crash:    { drift: -0.60, volatility: 1.20 },
};

const TIMEFRAME_MS: Record<TimeFrame, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * Generate a 6-month regime schedule with varied market conditions.
 * Returns ~4,320 1h candles (180 days).
 */
export function sixMonthSchedule(): RegimePhase[] {
  return [
    { regime: "sideways", bars: 480 },   // ~20 days warmup
    { regime: "bull",     bars: 720 },   // ~30 days bull run
    { regime: "volatile", bars: 240 },   // ~10 days high volatility
    { regime: "bear",     bars: 600 },   // ~25 days bear market
    { regime: "crash",    bars: 120 },   // ~5 days flash crash
    { regime: "sideways", bars: 480 },   // ~20 days consolidation
    { regime: "bull",     bars: 600 },   // ~25 days recovery rally
    { regime: "bear",     bars: 360 },   // ~15 days correction
    { regime: "volatile", bars: 240 },   // ~10 days choppy
    { regime: "sideways", bars: 480 },   // ~20 days flat
  ];
}

/**
 * Generate synthetic candle data with realistic OHLCV across regime phases.
 */
export function generateCandles(
  initialPrice: number,
  timeframe: TimeFrame,
  schedule: RegimePhase[],
  startTime?: number,
  seed?: number,
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = TIMEFRAME_MS[timeframe];
  const dt = intervalMs / (365.25 * 24 * 60 * 60 * 1000); // fraction of year
  let price = initialPrice;
  let time = startTime ?? Date.now() - schedule.reduce((s, p) => s + p.bars, 0) * intervalMs;
  let rng = seed !== undefined ? seededRandom(seed) : Math.random;

  for (const phase of schedule) {
    const params = REGIME_PARAMS[phase.regime];

    for (let i = 0; i < phase.bars; i++) {
      const open = price;

      // Simulate intra-candle price movement with multiple sub-steps
      let high = open;
      let low = open;
      let current = open;
      const subSteps = 10;
      const subDt = dt / subSteps;

      for (let s = 0; s < subSteps; s++) {
        const z = boxMuller(rng);
        const ret = params.drift * subDt + params.volatility * Math.sqrt(subDt) * z;
        current *= (1 + ret);
        current = Math.max(current, 0.01);
        if (current > high) high = current;
        if (current < low) low = current;
      }

      const close = current;
      price = close;

      // Synthetic volume: higher in volatile/crash regimes
      const volMultiplier = params.volatility / 0.4;
      const baseVol = 1000 + rng() * 500;
      const volume = baseVol * volMultiplier * (0.7 + rng() * 0.6);

      candles.push({
        timestamp: time,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume: volume * (open + close) / 2,
        trades: Math.floor(50 + rng() * 200),
        isClosed: true,
      });

      time += intervalMs;
    }
  }

  return candles;
}

/**
 * Generate candle datasets for multiple symbols with correlated but
 * distinct price paths.
 */
export function generateMultiSymbolCandles(
  timeframe: TimeFrame,
  schedule: RegimePhase[],
): Record<string, Candle[]> {
  return {
    "BTC/USDT": generateCandles(65_000, timeframe, schedule, undefined, 42),
    "ETH/USDT": generateCandles(3_400, timeframe, schedule, undefined, 137),
    "SOL/USDT": generateCandles(145, timeframe, schedule, undefined, 256),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function boxMuller(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

/** Simple seeded PRNG (xoshiro128**-like LCG for reproducibility) */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}
