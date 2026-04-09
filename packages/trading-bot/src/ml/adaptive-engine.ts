/**
 * Adaptive Engine — Bridges ML Layer into the Strategy Engine
 *
 * Wraps the AdaptiveStrategyImpl + RiskManager to implement the
 * Strategy interface from strategy/types.ts. This is the single
 * entry point for plugging adaptive ML into the existing trading loop.
 *
 * Architecture:
 *   StrategyEngine → AdaptiveEngine.evaluate(snapshot)
 *                     ├── FeatureExtractor → features
 *                     ├── OnlineModel → ML signal (or skip)
 *                     ├── Rule signals → fallback/ensemble
 *                     ├── Ensemble → blended signal
 *                     └── RiskManager → approved/blocked
 *
 * Graceful degradation:
 *   - ML not warmed up → rules only
 *   - ML confidence < threshold → rules only
 *   - ML + rules disagree → defer to rules (conservative)
 *   - Kill switch active → hold everything
 */

import type {
  Strategy,
  StrategyConfig,
  MarketSnapshot,
  Signal as StrategySignal,
} from "../strategy/types.js";
import type { TradeOutcome, EnsembleConfig, ModelWeights, SignalDirection } from "./types.js";
import type { FeatureConfig } from "./types.js";
import type { ModelConfig } from "./types.js";
import { AdaptiveStrategyImpl, type AdaptiveStrategyConfig } from "./adaptive-strategy.js";
import { RiskManager, type RiskLimits } from "./risk-manager.js";

// ─── Configuration ──────────────────────────────────────────────────

export interface AdaptiveEngineConfig {
  /** Configuration for the underlying adaptive strategy */
  strategy?: AdaptiveStrategyConfig;
  /** Immutable risk limits */
  risk?: Partial<RiskLimits>;
}

// ─── Engine ─────────────────────────────────────────────────────────

export class AdaptiveEngine implements Strategy {
  readonly name = "adaptive-ml";
  readonly config: StrategyConfig;

  private readonly strategy: AdaptiveStrategyImpl;
  private readonly riskManager: RiskManager;
  private lastTradeTime = new Map<string, number>();
  private readonly cooldownSec: number;

  constructor(
    strategyConfig: StrategyConfig,
    engineConfig: Partial<AdaptiveEngineConfig> = {},
  ) {
    this.config = strategyConfig;
    this.strategy = new AdaptiveStrategyImpl(engineConfig.strategy);
    this.riskManager = new RiskManager(engineConfig.risk);
    this.cooldownSec = engineConfig.risk?.minTradeCooldownSec ?? 60;
  }

  async initialize(): Promise<void> {
    // No async setup needed — model warms up from live data
  }

  /**
   * Evaluate the market snapshot and return a strategy-compatible signal.
   *
   * The ML signal is one input among many. When confidence is low, the
   * system degrades gracefully to rule-based-only operation.
   * The risk manager is the final gate — it cannot be overridden.
   */
  evaluate(snapshot: MarketSnapshot): StrategySignal {
    const holdSignal: StrategySignal = {
      action: "hold",
      symbol: snapshot.symbol,
      strength: 0,
      reason: "no actionable signal",
      timestamp: Date.now(),
    };

    // Kill switch check first
    if (this.riskManager.isKilled()) {
      holdSignal.reason = "KILL SWITCH ACTIVE — all trading halted";
      return holdSignal;
    }

    // Delegate to the adaptive strategy for ML + rule ensemble
    const mlSignal = this.strategy.evaluate(snapshot.symbol, snapshot.candles);

    // Map ml module's signal to strategy module's action
    if (mlSignal.direction === "neutral") {
      holdSignal.reason = mlSignal.reason;
      holdSignal.metadata = { source: mlSignal.source, confidence: mlSignal.confidence };
      return holdSignal;
    }

    // Cooldown check
    const lastTrade = this.lastTradeTime.get(snapshot.symbol);
    if (lastTrade !== undefined) {
      const elapsedSec = (Date.now() - lastTrade) / 1000;
      if (elapsedSec < this.cooldownSec) {
        holdSignal.reason = `cooldown: ${elapsedSec.toFixed(0)}s / ${this.cooldownSec}s`;
        return holdSignal;
      }
    }

    // Risk manager: position size, drawdown, daily loss, etc.
    const riskDecision = this.riskManager.check(
      mlSignal,
      snapshot.positions,
      snapshot.balances,
    );

    if (!riskDecision.allowed) {
      holdSignal.reason = `risk: ${riskDecision.reason}`;
      holdSignal.metadata = { riskRule: riskDecision.rule, mlSignal: mlSignal.reason };
      return holdSignal;
    }

    const action = mlSignal.direction === "long" ? "buy" as const : "sell" as const;

    return {
      action,
      symbol: snapshot.symbol,
      strength: riskDecision.adjustedStrength,
      reason: mlSignal.reason,
      metadata: {
        source: mlSignal.source,
        confidence: mlSignal.confidence,
        riskCheck: riskDecision.reason,
        mlStrength: mlSignal.strength,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Feed a completed trade outcome for online learning.
   * Call this when a position is closed so the model can update.
   */
  learn(outcome: TradeOutcome): void {
    this.strategy.learn(outcome);
    this.riskManager.recordPnl(outcome.pnlPercent);
    this.riskManager.recordTrade(outcome.symbol, outcome.pnlPercent);
    this.lastTradeTime.set(outcome.symbol, Date.now());
  }

  /** Initialize risk manager — call before trading starts */
  initializeRisk(totalEquity: number): void {
    this.riskManager.initialize(totalEquity);
  }

  /** Export model weights for persistence */
  exportWeights(): ModelWeights {
    return this.strategy.exportWeights();
  }

  /** Import previously saved weights */
  importWeights(weights: ModelWeights): void {
    this.strategy.importWeights(weights);
  }

  /** Get model performance stats */
  getStats() {
    return this.strategy.stats();
  }

  /** Get risk state */
  getRiskState() {
    return this.riskManager.getState();
  }

  /** Access risk manager for kill switch operations */
  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  /** Get cached features for a symbol (for constructing TradeOutcome) */
  getLastFeatures(symbol: string) {
    return this.strategy.getLastFeatures(symbol);
  }

  /** Reset model to untrained state */
  resetModel(): void {
    this.strategy.reset();
  }

  destroy(): void {
    // Clean up
    this.lastTradeTime.clear();
  }
}
