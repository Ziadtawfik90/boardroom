/**
 * Strategy Registry
 *
 * Central registry for strategy factories. Provides default configurations
 * and a convenience method to create a StrategyEngine pre-loaded with
 * all baseline strategies.
 */

import type { ExchangeConnector, TimeFrame } from "../exchange/types.js";
import type { StrategyConfig, StrategyFactory } from "./types.js";
import { StrategyEngine } from "./strategy-engine.js";
import { createMomentumStrategy } from "./momentum-strategy.js";
import { createMeanReversionStrategy } from "./mean-reversion-strategy.js";
import { createAdaptiveStrategy } from "../ml/adaptive-strategy-adapter.js";

// ─── Built-in Factories ──────────────────────────────────────────────

const BUILTIN_FACTORIES: Record<string, StrategyFactory> = {
  momentum: createMomentumStrategy,
  "mean-reversion": createMeanReversionStrategy,
  "adaptive-ml": createAdaptiveStrategy,
};

// ─── Default Configurations ──────────────────────────────────────────

export interface StrategyPreset {
  name: string;
  description: string;
  factory: string;
  defaultConfig: Omit<StrategyConfig, "id">;
}

export const STRATEGY_PRESETS: Record<string, StrategyPreset> = {
  "momentum-conservative": {
    name: "Conservative Momentum",
    description: "Slow crossover with strict RSI filters — fewer signals, higher confidence",
    factory: "momentum",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "1h" as TimeFrame,
      params: {
        fastPeriod: 20,
        slowPeriod: 50,
        rsiPeriod: 14,
        rsiOverbought: 65,
        rsiOversold: 35,
        signalStrength: 0.3,
      },
    },
  },
  "momentum-aggressive": {
    name: "Aggressive Momentum",
    description: "Fast crossover with relaxed RSI — more signals, scalping style",
    factory: "momentum",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "5m" as TimeFrame,
      params: {
        fastPeriod: 8,
        slowPeriod: 21,
        rsiPeriod: 10,
        rsiOverbought: 75,
        rsiOversold: 25,
        signalStrength: 0.6,
      },
    },
  },
  "mean-reversion-standard": {
    name: "Standard Mean Reversion",
    description: "Classic Bollinger Band bounce with RSI confirmation",
    factory: "mean-reversion",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "15m" as TimeFrame,
      params: {
        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        rsiOversold: 30,
        rsiOverbought: 70,
        signalStrength: 0.5,
      },
    },
  },
  "mean-reversion-tight": {
    name: "Tight Mean Reversion",
    description: "Narrower bands for range-bound markets — more frequent signals",
    factory: "mean-reversion",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "5m" as TimeFrame,
      params: {
        bbPeriod: 15,
        bbStdDev: 1.5,
        rsiPeriod: 10,
        rsiOversold: 35,
        rsiOverbought: 65,
        signalStrength: 0.4,
      },
    },
  },
  "adaptive-ml-conservative": {
    name: "Adaptive ML (Conservative)",
    description: "ML ensemble with rule-based fallback — learns from paper trading, degrades to rules when uncertain",
    factory: "adaptive-ml",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "1h" as TimeFrame,
      params: {
        learningRate: 0.01,
        regularization: 0.001,
        minSamples: 30,
        decayFactor: 0.995,
        mlWeight: 0.3,
        ruleWeight: 0.7,
        confidenceThreshold: 0.4,
        minAgreement: 2,
      },
    },
  },
  "adaptive-ml-balanced": {
    name: "Adaptive ML (Balanced)",
    description: "Equal weight between ML and rules — more responsive once model is trained",
    factory: "adaptive-ml",
    defaultConfig: {
      symbols: ["BTC/USDT"],
      timeframe: "15m" as TimeFrame,
      params: {
        learningRate: 0.01,
        regularization: 0.001,
        minSamples: 20,
        decayFactor: 0.995,
        mlWeight: 0.5,
        ruleWeight: 0.5,
        confidenceThreshold: 0.3,
        minAgreement: 2,
      },
    },
  },
};

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Create a StrategyEngine with all built-in factories pre-registered.
 * Optionally load preset strategies by name.
 */
export async function createStrategyEngine(
  connector: ExchangeConnector,
  presets?: string[],
): Promise<StrategyEngine> {
  const engine = new StrategyEngine(connector);

  // Register all built-in factories
  for (const [name, factory] of Object.entries(BUILTIN_FACTORIES)) {
    engine.registerFactory(name, factory);
  }

  // Instantiate requested presets
  if (presets) {
    for (const presetName of presets) {
      const preset = STRATEGY_PRESETS[presetName];
      if (!preset) {
        throw new Error(
          `Unknown strategy preset: ${presetName}. Available: ${Object.keys(STRATEGY_PRESETS).join(", ")}`,
        );
      }
      const config: StrategyConfig = {
        ...preset.defaultConfig,
        id: `${presetName}-${Date.now()}`,
      };
      await engine.createAndRegister(preset.factory, config);
    }
  }

  return engine;
}

/** List available strategy factory names */
export function listFactories(): string[] {
  return Object.keys(BUILTIN_FACTORIES);
}

/** List available preset names */
export function listPresets(): string[] {
  return Object.keys(STRATEGY_PRESETS);
}

/** Get preset details */
export function getPreset(name: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS[name];
}
