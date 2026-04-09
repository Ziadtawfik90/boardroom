/**
 * Adapter — Wraps AdaptiveStrategyImpl to conform to the Strategy
 * interface used by StrategyEngine.
 *
 * Maps ML signal directions (long/short/neutral) to engine signal
 * actions (buy/sell/hold), and feeds trade outcomes back to the
 * ML model for online learning.
 */

import type { MarketSnapshot, Signal, Strategy, StrategyConfig } from "../strategy/types.js";
import { AdaptiveStrategyImpl, type AdaptiveStrategyConfig } from "./adaptive-strategy.js";
import type { FeatureVector, TradeOutcome } from "./types.js";

export function createAdaptiveStrategy(config: StrategyConfig): Strategy {
  const mlConfig: AdaptiveStrategyConfig = {
    model: {
      learningRate: (config.params.learningRate as number) ?? 0.01,
      regularization: (config.params.regularization as number) ?? 0.001,
      minSamplesForPrediction: (config.params.minSamples as number) ?? 30,
      decayFactor: (config.params.decayFactor as number) ?? 0.995,
      maxFeatures: 100,
    },
    ensemble: {
      mlWeight: (config.params.mlWeight as number) ?? 0.4,
      ruleWeight: (config.params.ruleWeight as number) ?? 0.6,
      confidenceThreshold: (config.params.confidenceThreshold as number) ?? 0.3,
      minAgreement: (config.params.minAgreement as number) ?? 2,
    },
  };

  return new AdaptiveStrategyBridge(config, mlConfig);
}

class AdaptiveStrategyBridge implements Strategy {
  readonly name = "adaptive-ml";
  readonly config: StrategyConfig;

  private adaptive: AdaptiveStrategyImpl;
  private openTrades: Map<string, { entryPrice: number; entryTime: number; side: "buy" | "sell" }> = new Map();

  constructor(config: StrategyConfig, mlConfig: AdaptiveStrategyConfig) {
    this.config = config;
    this.adaptive = new AdaptiveStrategyImpl(mlConfig);
  }

  async initialize(): Promise<void> {
    // Import saved weights if provided in config
    if (this.config.params.savedWeights) {
      this.adaptive.importWeights(this.config.params.savedWeights as any);
    }
  }

  evaluate(snapshot: MarketSnapshot): Signal {
    const mlSignal = this.adaptive.evaluate(snapshot.symbol, snapshot.candles);

    // Map ML direction to engine action
    let action: "buy" | "sell" | "hold";
    if (mlSignal.direction === "long") action = "buy";
    else if (mlSignal.direction === "short") action = "sell";
    else action = "hold";

    // Track trades for learning feedback
    if (action === "buy" || action === "sell") {
      const existing = this.openTrades.get(snapshot.symbol);

      // If we have an open trade in the opposite direction, close it and learn
      if (existing && ((existing.side === "buy" && action === "sell") || (existing.side === "sell" && action === "buy"))) {
        const pnlPercent = existing.side === "buy"
          ? (snapshot.ticker.price - existing.entryPrice) / existing.entryPrice
          : (existing.entryPrice - snapshot.ticker.price) / existing.entryPrice;

        const lastFeatures = this.adaptive.getLastFeatures(snapshot.symbol);
        if (lastFeatures) {
          const outcome: TradeOutcome = {
            symbol: snapshot.symbol,
            side: existing.side,
            entryPrice: existing.entryPrice,
            exitPrice: snapshot.ticker.price,
            entryTime: existing.entryTime,
            exitTime: Date.now(),
            pnlPercent,
            features: {
              timestamp: lastFeatures.timestamp,
              symbol: snapshot.symbol,
              features: lastFeatures.features,
              labels: lastFeatures.labels,
            },
          };
          this.adaptive.learn(outcome);
        }
        this.openTrades.delete(snapshot.symbol);
      }

      // Open new trade
      if (!this.openTrades.has(snapshot.symbol)) {
        this.openTrades.set(snapshot.symbol, {
          entryPrice: snapshot.ticker.price,
          entryTime: Date.now(),
          side: action,
        });
      }
    }

    return {
      action,
      symbol: snapshot.symbol,
      strength: mlSignal.strength,
      reason: `[${mlSignal.source}] ${mlSignal.reason}`,
      metadata: {
        confidence: mlSignal.confidence,
        source: mlSignal.source,
        stats: this.adaptive.stats(),
      },
      timestamp: mlSignal.timestamp,
    };
  }

  destroy(): void {
    this.adaptive.reset();
    this.openTrades.clear();
  }

  /** Expose underlying adaptive strategy for direct access */
  getAdaptive(): AdaptiveStrategyImpl {
    return this.adaptive;
  }
}
