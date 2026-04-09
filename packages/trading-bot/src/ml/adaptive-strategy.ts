/**
 * Adaptive Strategy — The ensemble brain that combines ML and rule-based signals.
 *
 * Core design principle: ML is ONE signal among many, never the sole
 * decision-maker. When ML confidence is below threshold, the system
 * degrades gracefully to pure rule-based operation.
 *
 * Signal flow:
 *   Candles → FeatureExtractor → OnlineModel.predict() → ML Signal
 *   Candles → Rule Signals (momentum, mean-reversion, RSI, volume)
 *   ML Signal + Rule Signals → Ensemble → Final Signal
 *
 * Learning flow:
 *   Trade closes → TradeOutcome → OnlineModel.train() → Updated weights
 */

import type { Candle } from "../exchange/types.js";
import { FeatureExtractor } from "./feature-extractor.js";
import { OnlineModel } from "./online-model.js";
import { RegimeDetector, type RegimeState, type RegimeDetectorConfig } from "./regime-detector.js";
import { allRuleSignals } from "./rule-signals.js";
import type {
  AdaptiveStrategy,
  EnsembleConfig,
  FeatureConfig,
  ModelConfig,
  ModelWeights,
  RuleSignal,
  Signal,
  SignalDirection,
  TradeOutcome,
  TrainingStats,
} from "./types.js";

const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  mlWeight: 0.4,
  ruleWeight: 0.6,
  confidenceThreshold: 0.3,   // ML must be at least 30% confident to participate
  minAgreement: 2,            // at least 2 signal sources must agree
};

export interface AdaptiveStrategyConfig {
  model?: Partial<ModelConfig>;
  features?: Partial<FeatureConfig>;
  ensemble?: Partial<EnsembleConfig>;
  regime?: Partial<RegimeDetectorConfig>;
}

export class AdaptiveStrategyImpl implements AdaptiveStrategy {
  private model: OnlineModel;
  private extractor: FeatureExtractor;
  private regimeDetector: RegimeDetector;
  private ensembleConfig: EnsembleConfig;
  private lastRegime: RegimeState | null = null;

  // Track last feature vector for learning when trade closes
  private lastFeatures: Map<string, { features: number[]; labels: string[]; timestamp: number }> = new Map();

  constructor(config: AdaptiveStrategyConfig = {}) {
    this.model = new OnlineModel(config.model);
    this.extractor = new FeatureExtractor(config.features);
    this.regimeDetector = new RegimeDetector(config.regime);
    this.ensembleConfig = { ...DEFAULT_ENSEMBLE_CONFIG, ...config.ensemble };
  }

  /**
   * Generate a trading signal for the given symbol.
   *
   * If the ML model hasn't seen enough data or its confidence is below
   * threshold, the signal comes purely from rule-based strategies.
   */
  evaluate(symbol: string, candles: Candle[]): Signal {
    const now = Date.now();

    // 1. Extract features for ML
    const featureVec = this.extractor.extract(symbol, candles);

    // 2. Get ML prediction (may return null if not ready)
    let mlSignal: { direction: SignalDirection; strength: number; confidence: number } | null = null;

    if (featureVec) {
      // Cache features for later learning
      this.lastFeatures.set(symbol, {
        features: featureVec.features,
        labels: featureVec.labels,
        timestamp: featureVec.timestamp,
      });

      const prediction = this.model.predict(featureVec.features, featureVec.labels);
      if (prediction) {
        mlSignal = {
          direction: prediction.direction,
          strength: prediction.probability > 0.5
            ? (prediction.probability - 0.5) * 2
            : (0.5 - prediction.probability) * 2,
          confidence: prediction.confidence,
        };
      }
    }

    // 3. Get rule-based signals
    const ruleSignals = allRuleSignals(candles);

    // 4. Detect market regime
    this.lastRegime = this.regimeDetector.detect(candles);

    // 5. Ensemble: combine ML and rules
    return this.ensemble(symbol, mlSignal, ruleSignals, now);
  }

  /**
   * Feed a completed trade outcome to the model for online learning.
   */
  learn(outcome: TradeOutcome): void {
    this.model.train(outcome);
  }

  /**
   * Get the features cached from the last evaluate() call for a symbol.
   * Useful for constructing TradeOutcome when a trade closes.
   */
  getLastFeatures(symbol: string) {
    return this.lastFeatures.get(symbol) ?? null;
  }

  stats(): TrainingStats {
    return this.model.stats();
  }

  exportWeights(): ModelWeights {
    return this.model.exportWeights();
  }

  importWeights(weights: ModelWeights): void {
    this.model.importWeights(weights);
  }

  reset(): void {
    this.model.reset();
    this.lastFeatures.clear();
  }

  // ─── Ensemble Logic ─────────────────────────────────────────────────

  private ensemble(
    symbol: string,
    mlSignal: { direction: SignalDirection; strength: number; confidence: number } | null,
    ruleSignals: RuleSignal[],
    timestamp: number,
  ): Signal {
    const votes: Array<{ direction: SignalDirection; weight: number; source: string }> = [];

    // Regime-aware ML gating:
    // - Volatile regime with high confidence → suppress ML (unpredictable market)
    // - Trending regime → boost ML weight (patterns are clearer)
    // - Ranging regime → reduce ML weight (noise dominates)
    const regime = this.lastRegime;
    const mlSuppressedByRegime = regime !== null &&
      regime.regime === "volatile" && regime.confidence > 0.6;

    let effectiveMlWeight = this.ensembleConfig.mlWeight;
    if (regime) {
      if (regime.regime === "trending_up" || regime.regime === "trending_down") {
        effectiveMlWeight = Math.min(0.8, effectiveMlWeight * (1 + regime.confidence * 0.5));
      } else if (regime.regime === "ranging") {
        effectiveMlWeight *= 0.6;
      }
    }

    // ML vote (only if confidence exceeds threshold AND not suppressed by regime)
    const mlActive =
      mlSignal !== null &&
      !mlSuppressedByRegime &&
      mlSignal.confidence >= this.ensembleConfig.confidenceThreshold;

    if (mlActive && mlSignal) {
      votes.push({
        direction: mlSignal.direction,
        weight: effectiveMlWeight * mlSignal.strength * mlSignal.confidence,
        source: "ml",
      });
    }

    // Rule votes
    for (const rule of ruleSignals) {
      if (rule.direction !== "neutral" && rule.strength > 0.1) {
        votes.push({
          direction: rule.direction,
          weight: this.ensembleConfig.ruleWeight * rule.strength / ruleSignals.length,
          source: rule.name,
        });
      }
    }

    // Tally weighted votes per direction
    const tally = { long: 0, short: 0, neutral: 0 };
    const sources = { long: 0, short: 0, neutral: 0 };

    for (const vote of votes) {
      tally[vote.direction] += vote.weight;
      sources[vote.direction]++;
    }

    // Determine winning direction
    let direction: SignalDirection = "neutral";
    let strength = 0;

    if (tally.long > tally.short && sources.long >= this.ensembleConfig.minAgreement) {
      direction = "long";
      strength = tally.long;
    } else if (tally.short > tally.long && sources.short >= this.ensembleConfig.minAgreement) {
      direction = "short";
      strength = tally.short;
    }

    // Clamp strength to 0..1
    strength = Math.min(Math.max(strength, 0), 1);

    // Confidence: how much agreement + ML confidence (if active)
    const agreementRatio = votes.length > 0
      ? sources[direction] / votes.length
      : 0;
    const confidence = mlActive && mlSignal
      ? agreementRatio * 0.5 + mlSignal.confidence * 0.5
      : agreementRatio;

    // Build reason string
    const reasons: string[] = [];
    if (regime) {
      reasons.push(`regime(${regime.regime},conf=${regime.confidence.toFixed(2)})`);
    }
    if (mlSuppressedByRegime) {
      reasons.push("ML(suppressed:volatile)");
    } else if (mlActive && mlSignal) {
      reasons.push(`ML(${mlSignal.direction},conf=${mlSignal.confidence.toFixed(2)})`);
    } else {
      reasons.push("ML(inactive)");
    }
    for (const rule of ruleSignals) {
      if (rule.direction !== "neutral") {
        reasons.push(`${rule.name}(${rule.direction},str=${rule.strength.toFixed(2)})`);
      }
    }

    return {
      symbol,
      direction,
      strength,
      confidence: Math.min(confidence, 1),
      source: mlActive ? "ensemble" : "rule",
      reason: reasons.join(" | "),
      timestamp,
    };
  }
}
