/**
 * Market Data Simulator
 *
 * Generates realistic synthetic price series across different market regimes:
 *   - Bull: sustained uptrend with pullbacks
 *   - Bear: sustained downtrend with relief rallies
 *   - Sideways: range-bound with mean reversion
 *   - Volatile: high variance, regime switches
 *   - Crash: sudden sharp decline followed by recovery
 *
 * Uses geometric Brownian motion with regime-dependent drift/volatility
 * parameters. Each tick represents ~1 hour of trading.
 */

import type { Ticker } from "../exchange/types.js";

export type MarketRegime = "bull" | "bear" | "sideways" | "volatile" | "crash";

export interface RegimeParams {
  /** Hourly drift (annualized ~drift*8760) */
  drift: number;
  /** Hourly volatility */
  volatility: number;
  /** Duration in ticks (hours) */
  duration: number;
}

export interface MarketSimulatorConfig {
  symbol: string;
  startPrice: number;
  /** Sequence of regimes to simulate */
  regimes: MarketRegime[];
  /** Ticks per regime (default: ~720 = ~1 month of hourly data) */
  ticksPerRegime?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

const REGIME_DEFAULTS: Record<MarketRegime, Omit<RegimeParams, "duration">> = {
  bull:     { drift: 0.00015,  volatility: 0.012 },   // ~15% annual, moderate vol
  bear:     { drift: -0.00020, volatility: 0.015 },   // ~-20% annual, higher vol
  sideways: { drift: 0.00002,  volatility: 0.008 },   // ~flat, low vol
  volatile: { drift: 0.00005,  volatility: 0.025 },   // slight up, very high vol
  crash:    { drift: -0.00080, volatility: 0.040 },   // sharp down, extreme vol
};

/** Simple seeded PRNG (mulberry32) for reproducible simulations */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform for normal distribution */
function normalRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

export class MarketSimulator {
  private readonly config: Required<MarketSimulatorConfig>;
  private readonly rng: () => number;

  constructor(config: MarketSimulatorConfig) {
    this.config = {
      ticksPerRegime: 720,
      seed: 42,
      ...config,
    };
    this.rng = createRng(this.config.seed);
  }

  /**
   * Generate the full price series as an array of Ticker objects.
   * Each tick ~1 hour. Total ticks = regimes.length * ticksPerRegime.
   */
  generate(): Ticker[] {
    const tickers: Ticker[] = [];
    let price = this.config.startPrice;
    const startTime = Date.now() - this.totalTicks() * 3600_000;

    for (const regime of this.config.regimes) {
      const params = REGIME_DEFAULTS[regime];
      const duration = regime === "crash"
        ? Math.floor(this.config.ticksPerRegime * 0.3) // Crashes are short
        : this.config.ticksPerRegime;

      for (let i = 0; i < duration; i++) {
        const noise = normalRandom(this.rng);
        const returnPct = params.drift + params.volatility * noise;
        price = price * (1 + returnPct);
        price = Math.max(price * 0.001, price); // Floor: never go below 0.1% of current

        const spread = price * 0.001; // 0.1% spread
        const tickIndex = tickers.length;

        tickers.push({
          symbol: this.config.symbol,
          price,
          bid: price - spread / 2,
          ask: price + spread / 2,
          volume24h: 1000 + this.rng() * 5000,
          timestamp: startTime + tickIndex * 3600_000,
        });
      }

      // After crash, add recovery phase
      if (regime === "crash") {
        const recoveryTicks = Math.floor(this.config.ticksPerRegime * 0.7);
        for (let i = 0; i < recoveryTicks; i++) {
          const noise = normalRandom(this.rng);
          const returnPct = 0.0003 + 0.020 * noise; // Recovery drift + high vol
          price = price * (1 + returnPct);
          const spread = price * 0.001;
          const tickIndex = tickers.length;

          tickers.push({
            symbol: this.config.symbol,
            price,
            bid: price - spread / 2,
            ask: price + spread / 2,
            volume24h: 2000 + this.rng() * 8000,
            timestamp: startTime + tickIndex * 3600_000,
          });
        }
      }
    }

    return tickers;
  }

  totalTicks(): number {
    return this.config.regimes.length * this.config.ticksPerRegime;
  }
}

/**
 * Pre-built market scenarios for validation.
 */
export const VALIDATION_SCENARIOS = {
  /** 6-month mixed conditions: bull → sideways → bear → volatile → sideways → bull */
  mixed6Month: (symbol: string, startPrice: number, seed = 42): MarketSimulator =>
    new MarketSimulator({
      symbol,
      startPrice,
      regimes: ["bull", "sideways", "bear", "volatile", "sideways", "bull"],
      ticksPerRegime: 720,
      seed,
    }),

  /** 3-month bear market stress test */
  bearStress: (symbol: string, startPrice: number, seed = 123): MarketSimulator =>
    new MarketSimulator({
      symbol,
      startPrice,
      regimes: ["bear", "crash", "bear"],
      ticksPerRegime: 720,
      seed,
    }),

  /** 3-month bull run */
  bullRun: (symbol: string, startPrice: number, seed = 456): MarketSimulator =>
    new MarketSimulator({
      symbol,
      startPrice,
      regimes: ["bull", "volatile", "bull"],
      ticksPerRegime: 720,
      seed,
    }),

  /** Range-bound / sideways for 3 months */
  rangebound: (symbol: string, startPrice: number, seed = 789): MarketSimulator =>
    new MarketSimulator({
      symbol,
      startPrice,
      regimes: ["sideways", "sideways", "sideways"],
      ticksPerRegime: 720,
      seed,
    }),
} as const;
