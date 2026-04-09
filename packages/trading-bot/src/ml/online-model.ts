/**
 * Online Learning Model — Incremental SGD classifier
 *
 * Learns from trade outcomes as they arrive. No batch retraining needed.
 * Uses logistic regression with L2 regularization and exponential decay
 * on older samples so the model adapts to regime changes.
 *
 * This is intentionally simple — complex deep learning models are a
 * liability in low-data, non-stationary crypto markets. A transparent
 * linear model lets us inspect feature importance and catch when the
 * model is confused.
 */

import type {
  ModelConfig,
  ModelWeights,
  PredictionResult,
  SignalDirection,
  TradeOutcome,
  TrainingStats,
} from "./types.js";

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  learningRate: 0.01,
  regularization: 0.001,
  minSamplesForPrediction: 30,
  decayFactor: 0.995,
  maxFeatures: 100,
};

export class OnlineModel {
  private weights: number[];
  private bias: number;
  private featureNames: string[];
  private config: ModelConfig;

  // Training history for stats
  private totalSamples: number;
  private wins: number;
  private totalPnl: number;
  private recentPredictions: Array<{ predicted: number; actual: number }>;
  private firstTrainedAt: number;
  private lastTrainedAt: number;

  // Running variance for feature normalization
  private featureMeans: number[];
  private featureM2: number[];   // sum of squared deviations
  private featureCount: number;

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_CONFIG, ...config };
    this.weights = [];
    this.bias = 0;
    this.featureNames = [];
    this.totalSamples = 0;
    this.wins = 0;
    this.totalPnl = 0;
    this.recentPredictions = [];
    this.firstTrainedAt = 0;
    this.lastTrainedAt = 0;
    this.featureMeans = [];
    this.featureM2 = [];
    this.featureCount = 0;
  }

  /**
   * Update model with a completed trade outcome.
   * Label: +1 if trade was profitable, -1 if not.
   */
  train(outcome: TradeOutcome): void {
    const features = outcome.features.features;
    const label = outcome.pnlPercent > 0 ? 1 : -1;

    // Initialize weights on first sample
    if (this.weights.length === 0) {
      this.initializeWeights(features.length, outcome.features.labels);
    }

    // Ensure feature dimensions match
    if (features.length !== this.weights.length) {
      return; // skip mismatched dimensions rather than crash
    }

    // Update running normalization stats
    this.updateNormStats(features);

    // Normalize features
    const normalized = this.normalizeFeatures(features);

    // SGD update step
    const rawScore = this.dotProduct(normalized, this.weights) + this.bias;
    const predicted = this.sigmoid(rawScore);
    const target = label === 1 ? 1 : 0;
    const error = predicted - target;

    // Gradient descent with L2 regularization
    const lr = this.config.learningRate;
    const reg = this.config.regularization;

    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] -= lr * (error * normalized[i] + reg * this.weights[i]);
    }
    this.bias -= lr * error;

    // Apply decay to weights (forget old patterns gradually)
    const decay = this.config.decayFactor;
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] *= decay;
    }
    this.bias *= decay;

    // Track stats
    this.totalSamples++;
    if (outcome.pnlPercent > 0) this.wins++;
    this.totalPnl += outcome.pnlPercent;
    if (this.firstTrainedAt === 0) this.firstTrainedAt = Date.now();
    this.lastTrainedAt = Date.now();

    // Track recent prediction accuracy (sliding window of 100)
    this.recentPredictions.push({
      predicted: rawScore > 0 ? 1 : -1,
      actual: label,
    });
    if (this.recentPredictions.length > 100) {
      this.recentPredictions.shift();
    }
  }

  /**
   * Predict direction and confidence for given features.
   * Returns null if model hasn't seen enough training data.
   */
  predict(features: number[], featureLabels: string[]): PredictionResult | null {
    if (this.totalSamples < this.config.minSamplesForPrediction) {
      return null; // not enough data — caller should use rule-based fallback
    }

    if (features.length !== this.weights.length) {
      return null; // dimension mismatch
    }

    const normalized = this.normalizeFeatures(features);
    const rawScore = this.dotProduct(normalized, this.weights) + this.bias;
    const probability = this.sigmoid(rawScore);

    // Confidence based on: distance from 0.5, recent accuracy, sample count
    const predictionStrength = Math.abs(probability - 0.5) * 2; // 0..1
    const accuracyFactor = this.recentAccuracy();
    const sampleFactor = Math.min(this.totalSamples / 200, 1); // ramps up to 200 samples
    const confidence = predictionStrength * accuracyFactor * sampleFactor;

    // Direction
    let direction: SignalDirection;
    if (probability > 0.55) direction = "long";
    else if (probability < 0.45) direction = "short";
    else direction = "neutral";

    // Feature importance (weight * feature value)
    const featureImportance = normalized.map((feat, i) => ({
      name: this.featureNames[i] || featureLabels[i] || `f${i}`,
      contribution: this.weights[i] * feat,
    }));
    featureImportance.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      direction,
      rawScore,
      probability,
      confidence,
      featureImportance: featureImportance.slice(0, 10), // top 10
    };
  }

  /** Get current training statistics */
  stats(): TrainingStats {
    return {
      totalSamples: this.totalSamples,
      winRate: this.totalSamples > 0 ? this.wins / this.totalSamples : 0,
      avgPnl: this.totalSamples > 0 ? this.totalPnl / this.totalSamples : 0,
      recentAccuracy: this.recentAccuracy(),
      modelAge: this.firstTrainedAt > 0 ? Date.now() - this.firstTrainedAt : 0,
      lastTrainedAt: this.lastTrainedAt,
    };
  }

  /** Export weights for persistence */
  exportWeights(): ModelWeights {
    return {
      weights: [...this.weights],
      bias: this.bias,
      featureNames: [...this.featureNames],
      trainingSamples: this.totalSamples,
      lastUpdated: this.lastTrainedAt,
    };
  }

  /** Import previously saved weights */
  importWeights(saved: ModelWeights): void {
    this.weights = [...saved.weights];
    this.bias = saved.bias;
    this.featureNames = [...saved.featureNames];
    this.totalSamples = saved.trainingSamples;
    this.lastTrainedAt = saved.lastUpdated;
  }

  /** Reset to untrained state */
  reset(): void {
    this.weights = [];
    this.bias = 0;
    this.featureNames = [];
    this.totalSamples = 0;
    this.wins = 0;
    this.totalPnl = 0;
    this.recentPredictions = [];
    this.firstTrainedAt = 0;
    this.lastTrainedAt = 0;
    this.featureMeans = [];
    this.featureM2 = [];
    this.featureCount = 0;
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  private initializeWeights(numFeatures: number, labels: string[]): void {
    const n = Math.min(numFeatures, this.config.maxFeatures);
    // Xavier-style initialization
    const scale = Math.sqrt(2 / n);
    this.weights = Array.from({ length: n }, () => (Math.random() - 0.5) * scale);
    this.bias = 0;
    this.featureNames = labels.slice(0, n);
    this.featureMeans = new Array(n).fill(0);
    this.featureM2 = new Array(n).fill(0);
    this.featureCount = 0;
  }

  private updateNormStats(features: number[]): void {
    this.featureCount++;
    for (let i = 0; i < features.length && i < this.featureMeans.length; i++) {
      const delta = features[i] - this.featureMeans[i];
      this.featureMeans[i] += delta / this.featureCount;
      const delta2 = features[i] - this.featureMeans[i];
      this.featureM2[i] += delta * delta2;
    }
  }

  private normalizeFeatures(features: number[]): number[] {
    if (this.featureCount < 2) return features.slice(0, this.weights.length);

    return features.slice(0, this.weights.length).map((val, i) => {
      const variance = this.featureM2[i] / (this.featureCount - 1);
      const std = Math.sqrt(variance);
      return std > 1e-10 ? (val - this.featureMeans[i]) / std : 0;
    });
  }

  private sigmoid(x: number): number {
    if (x > 500) return 1;
    if (x < -500) return 0;
    return 1 / (1 + Math.exp(-x));
  }

  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) sum += a[i] * b[i];
    return sum;
  }

  private recentAccuracy(): number {
    if (this.recentPredictions.length < 5) return 0.5; // uncertain
    let correct = 0;
    for (const p of this.recentPredictions) {
      if (p.predicted === p.actual) correct++;
    }
    return correct / this.recentPredictions.length;
  }
}
