/**
 * Sandbox Configuration
 *
 * Defines presets for running paper trading under different market scenarios.
 * Each preset configures initial capital, trading pairs, fee models,
 * and regime schedules for realistic multi-month simulations.
 */

import type { PriceFeedConfig, RegimeSchedule } from "./price-feed.js";

export interface SandboxConfig {
  /** Human-readable name for this sandbox run */
  name: string;
  /** Initial balances across assets */
  initialBalances: Record<string, number>;
  /** Price feed configurations */
  feeds: Array<PriceFeedConfig & { regimeSchedule?: RegimeSchedule[] }>;
  /** Taker fee rate (fraction) */
  takerFeeRate: number;
  /** Maker fee rate (fraction) */
  makerFeeRate: number;
  /** Slippage rate (fraction) */
  slippageRate: number;
  /** How often to log performance stats (in ticks) */
  reportIntervalTicks: number;
  /** Max ticks to run (0 = unlimited, use stop() to halt) */
  maxTicks: number;
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
}

/** Conservative test: $10k USDT, single pair, moderate conditions */
export const PRESET_CONSERVATIVE: SandboxConfig = {
  name: "conservative-single-pair",
  initialBalances: { USDT: 10_000 },
  feeds: [
    {
      symbol: "BTC/USDT",
      initialPrice: 65_000,
      tickIntervalMs: 500,
      volatility: 0.40,
      drift: 0.0,
      spreadPct: 0.0005,
      baseVolume24h: 25_000,
    },
  ],
  takerFeeRate: 0.001,
  makerFeeRate: 0.001,
  slippageRate: 0.0005,
  reportIntervalTicks: 100,
  maxTicks: 5000,
  tickIntervalMs: 500,
};

/** Multi-pair test: $50k USDT across BTC, ETH, SOL with regime shifts */
export const PRESET_MULTI_PAIR: SandboxConfig = {
  name: "multi-pair-regime-shifts",
  initialBalances: { USDT: 50_000 },
  feeds: [
    {
      symbol: "BTC/USDT",
      initialPrice: 65_000,
      tickIntervalMs: 500,
      volatility: 0.50,
      drift: 0.0,
      spreadPct: 0.0005,
      baseVolume24h: 25_000,
      regimeSchedule: [
        { regime: "sideways", durationTicks: 300 },
        { regime: "bull", durationTicks: 800 },
        { regime: "volatile", durationTicks: 200 },
        { regime: "bear", durationTicks: 600 },
        { regime: "crash", durationTicks: 80 },
        { regime: "sideways", durationTicks: 400 },
      ],
    },
    {
      symbol: "ETH/USDT",
      initialPrice: 3_400,
      tickIntervalMs: 500,
      volatility: 0.60,
      drift: 0.0,
      spreadPct: 0.0008,
      baseVolume24h: 150_000,
      regimeSchedule: [
        { regime: "bull", durationTicks: 500 },
        { regime: "volatile", durationTicks: 300 },
        { regime: "bear", durationTicks: 700 },
        { regime: "sideways", durationTicks: 400 },
        { regime: "crash", durationTicks: 60 },
        { regime: "bull", durationTicks: 300 },
      ],
    },
    {
      symbol: "SOL/USDT",
      initialPrice: 145,
      tickIntervalMs: 500,
      volatility: 0.80,
      drift: 0.0,
      spreadPct: 0.0012,
      baseVolume24h: 500_000,
      regimeSchedule: [
        { regime: "volatile", durationTicks: 400 },
        { regime: "bull", durationTicks: 600 },
        { regime: "crash", durationTicks: 100 },
        { regime: "bear", durationTicks: 500 },
        { regime: "sideways", durationTicks: 300 },
        { regime: "bull", durationTicks: 400 },
      ],
    },
  ],
  takerFeeRate: 0.001,
  makerFeeRate: 0.001,
  slippageRate: 0.0005,
  reportIntervalTicks: 200,
  maxTicks: 10_000,
  tickIntervalMs: 500,
};

/** Stress test: high volatility, crash scenarios, tight capital */
export const PRESET_STRESS_TEST: SandboxConfig = {
  name: "stress-test-crash-heavy",
  initialBalances: { USDT: 5_000 },
  feeds: [
    {
      symbol: "BTC/USDT",
      initialPrice: 65_000,
      tickIntervalMs: 200,
      volatility: 0.90,
      drift: -0.15,
      spreadPct: 0.002,
      baseVolume24h: 25_000,
      regimeSchedule: [
        { regime: "volatile", durationTicks: 200 },
        { regime: "crash", durationTicks: 150 },
        { regime: "bear", durationTicks: 500 },
        { regime: "crash", durationTicks: 100 },
        { regime: "volatile", durationTicks: 300 },
        { regime: "sideways", durationTicks: 200 },
      ],
    },
  ],
  takerFeeRate: 0.002,
  makerFeeRate: 0.001,
  slippageRate: 0.001,
  reportIntervalTicks: 100,
  maxTicks: 5000,
  tickIntervalMs: 200,
};

export const PRESETS = {
  conservative: PRESET_CONSERVATIVE,
  "multi-pair": PRESET_MULTI_PAIR,
  "stress-test": PRESET_STRESS_TEST,
} as const;
