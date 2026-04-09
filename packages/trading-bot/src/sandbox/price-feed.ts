/**
 * Simulated Price Feed
 *
 * Generates realistic price movements using geometric Brownian motion (GBM).
 * Supports multiple market regimes (bull, bear, sideways, volatile) to test
 * strategies across varied conditions as recommended for 3-6 month paper runs.
 */

import type { Ticker } from "../exchange/types.js";

export type MarketRegime = "bull" | "bear" | "sideways" | "volatile" | "crash";

export interface PriceFeedConfig {
  symbol: string;
  /** Starting price */
  initialPrice: number;
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
  /** Annualized volatility as a fraction (0.5 = 50%) */
  volatility: number;
  /** Annualized drift as a fraction (0.1 = 10% upward bias) */
  drift: number;
  /** Bid-ask spread as a fraction of price (0.001 = 0.1%) */
  spreadPct: number;
  /** 24h base volume */
  baseVolume24h: number;
}

export interface RegimeSchedule {
  regime: MarketRegime;
  /** Duration in ticks */
  durationTicks: number;
}

const REGIME_PARAMS: Record<MarketRegime, { drift: number; volatility: number; spreadMultiplier: number }> = {
  bull:     { drift: 0.30,  volatility: 0.40, spreadMultiplier: 0.8 },
  bear:     { drift: -0.25, volatility: 0.50, spreadMultiplier: 1.2 },
  sideways: { drift: 0.0,   volatility: 0.20, spreadMultiplier: 1.0 },
  volatile: { drift: 0.0,   volatility: 0.80, spreadMultiplier: 2.0 },
  crash:    { drift: -0.60, volatility: 1.20, spreadMultiplier: 3.0 },
};

export class PriceFeed {
  private currentPrice: number;
  private readonly config: PriceFeedConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private listeners: Array<(ticker: Ticker) => void> = [];

  private regimeSchedule: RegimeSchedule[] = [];
  private currentRegimeIndex = 0;
  private ticksInCurrentRegime = 0;

  constructor(config: PriceFeedConfig, regimeSchedule?: RegimeSchedule[]) {
    this.config = config;
    this.currentPrice = config.initialPrice;
    this.regimeSchedule = regimeSchedule ?? [
      { regime: "sideways", durationTicks: 500 },
      { regime: "bull", durationTicks: 1000 },
      { regime: "volatile", durationTicks: 300 },
      { regime: "bear", durationTicks: 800 },
      { regime: "crash", durationTicks: 100 },
      { regime: "sideways", durationTicks: 500 },
    ];
  }

  /** Subscribe to price updates */
  onTick(listener: (ticker: Ticker) => void): void {
    this.listeners.push(listener);
  }

  /** Remove a price listener */
  offTick(listener: (ticker: Ticker) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** Start generating price ticks */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
    // Emit initial tick immediately
    this.tick();
  }

  /** Stop generating price ticks */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Generate a single price tick (can also be called manually for backtesting) */
  tick(): Ticker {
    const regime = this.getCurrentRegime();
    const params = REGIME_PARAMS[regime];

    // Geometric Brownian Motion step
    // dS = S * (μ*dt + σ*√dt*Z) where Z ~ N(0,1)
    const dt = this.config.tickIntervalMs / (365.25 * 24 * 60 * 60 * 1000); // fraction of a year
    const drift = params.drift * dt;
    const vol = params.volatility * Math.sqrt(dt);
    const z = this.boxMullerRandom();

    const returnPct = drift + vol * z;
    this.currentPrice *= (1 + returnPct);

    // Floor price at 0.01 to avoid negative prices
    this.currentPrice = Math.max(this.currentPrice, 0.01);

    const spreadHalf = this.currentPrice * this.config.spreadPct * params.spreadMultiplier * 0.5;
    const volumeNoise = 0.7 + Math.random() * 0.6; // ±30% volume variation

    const ticker: Ticker = {
      symbol: this.config.symbol,
      price: this.currentPrice,
      bid: this.currentPrice - spreadHalf,
      ask: this.currentPrice + spreadHalf,
      volume24h: this.config.baseVolume24h * volumeNoise,
      timestamp: Date.now(),
    };

    this.tickCount++;
    this.ticksInCurrentRegime++;
    this.advanceRegime();

    for (const listener of this.listeners) {
      try { listener(ticker); } catch { /* don't let listener errors kill the feed */ }
    }

    return ticker;
  }

  getCurrentRegime(): MarketRegime {
    if (this.regimeSchedule.length === 0) return "sideways";
    return this.regimeSchedule[this.currentRegimeIndex % this.regimeSchedule.length].regime;
  }

  getCurrentPrice(): number {
    return this.currentPrice;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  private advanceRegime(): void {
    if (this.regimeSchedule.length === 0) return;
    const current = this.regimeSchedule[this.currentRegimeIndex % this.regimeSchedule.length];
    if (this.ticksInCurrentRegime >= current.durationTicks) {
      this.currentRegimeIndex++;
      this.ticksInCurrentRegime = 0;
    }
  }

  /** Box-Muller transform for standard normal random variable */
  private boxMullerRandom(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

/** Create default price feeds for common crypto pairs */
export function createDefaultFeeds(tickIntervalMs = 1000): PriceFeed[] {
  const defaultSchedule: RegimeSchedule[] = [
    { regime: "sideways", durationTicks: 500 },
    { regime: "bull", durationTicks: 1000 },
    { regime: "volatile", durationTicks: 300 },
    { regime: "bear", durationTicks: 800 },
    { regime: "crash", durationTicks: 100 },
    { regime: "sideways", durationTicks: 500 },
    { regime: "bull", durationTicks: 600 },
    { regime: "bear", durationTicks: 400 },
  ];

  return [
    new PriceFeed({
      symbol: "BTC/USDT",
      initialPrice: 65_000,
      tickIntervalMs,
      volatility: 0.50,
      drift: 0.0,
      spreadPct: 0.0005,
      baseVolume24h: 25_000,
    }, defaultSchedule),
    new PriceFeed({
      symbol: "ETH/USDT",
      initialPrice: 3_400,
      tickIntervalMs,
      volatility: 0.60,
      drift: 0.0,
      spreadPct: 0.0008,
      baseVolume24h: 150_000,
    }, defaultSchedule),
    new PriceFeed({
      symbol: "SOL/USDT",
      initialPrice: 145,
      tickIntervalMs,
      volatility: 0.80,
      drift: 0.0,
      spreadPct: 0.0012,
      baseVolume24h: 500_000,
    }, defaultSchedule),
  ];
}
