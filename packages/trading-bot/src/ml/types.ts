/**
 * Adaptive ML Learning Layer — Type Definitions
 *
 * The ML layer is one signal source among many. It never acts as an
 * autonomous decision-maker. When confidence is low, the system
 * degrades gracefully to rule-based fallbacks.
 */

import type { Candle, OrderSide, TimeFrame } from "../exchange/types.js";

// ─── Feature Types ──────────────────────────────────────────────────

export interface FeatureVector {
  timestamp: number;
  symbol: string;
  features: number[];       // normalized numeric features
  labels: string[];         // human-readable feature names
}

export interface FeatureConfig {
  lookbackPeriods: number[];  // e.g. [5, 10, 20, 50]
  timeframe: TimeFrame;
  includeVolume: boolean;
  includeMomentum: boolean;
  includeVolatility: boolean;
  includeTrend: boolean;
}

// ─── Signal Types ───────────────────────────────────────────────────

export type SignalDirection = "long" | "short" | "neutral";

export interface Signal {
  symbol: string;
  direction: SignalDirection;
  strength: number;          // 0..1 — how strong the signal is
  confidence: number;        // 0..1 — how confident the model is
  source: "ml" | "rule" | "ensemble";
  reason: string;
  timestamp: number;
}

// ─── Model Types ────────────────────────────────────────────────────

export interface ModelWeights {
  weights: number[];
  bias: number;
  featureNames: string[];
  trainingSamples: number;
  lastUpdated: number;
}

export interface ModelConfig {
  learningRate: number;        // SGD step size (default 0.01)
  regularization: number;     // L2 penalty (default 0.001)
  minSamplesForPrediction: number;  // won't predict until N samples seen
  decayFactor: number;        // exponential decay for old samples (0.99)
  maxFeatures: number;
}

export interface PredictionResult {
  direction: SignalDirection;
  rawScore: number;           // unbounded model output
  probability: number;        // sigmoid(rawScore), 0..1
  confidence: number;         // calibrated confidence 0..1
  featureImportance: Array<{ name: string; contribution: number }>;
}

// ─── Training Types ─────────────────────────────────────────────────

export interface TradeOutcome {
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  pnlPercent: number;         // (exit - entry) / entry for longs
  features: FeatureVector;    // features at time of entry
}

export interface TrainingStats {
  totalSamples: number;
  winRate: number;
  avgPnl: number;
  recentAccuracy: number;     // accuracy over last N predictions
  modelAge: number;           // ms since first training sample
  lastTrainedAt: number;
}

// ─── Ensemble Types ─────────────────────────────────────────────────

export interface RuleSignal {
  name: string;
  direction: SignalDirection;
  strength: number;           // 0..1
}

export interface EnsembleConfig {
  mlWeight: number;           // weight for ML signal (0..1)
  ruleWeight: number;         // weight for rule-based signals (0..1)
  confidenceThreshold: number;  // below this, ML weight drops to 0
  minAgreement: number;       // minimum sources that must agree (1..N)
}

// ─── Strategy Interface ─────────────────────────────────────────────

export interface AdaptiveStrategy {
  /** Generate a trading signal for the given symbol */
  evaluate(symbol: string, candles: Candle[]): Signal;

  /** Feed a completed trade outcome for online learning */
  learn(outcome: TradeOutcome): void;

  /** Get current model performance stats */
  stats(): TrainingStats;

  /** Export model weights for persistence */
  exportWeights(): ModelWeights;

  /** Import previously saved weights */
  importWeights(weights: ModelWeights): void;

  /** Reset model to untrained state */
  reset(): void;
}
