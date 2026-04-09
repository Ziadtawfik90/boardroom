/**
 * Feature Normalizer — Z-score normalization for ML model input.
 *
 * Tracks running mean/variance per feature name using Welford's online
 * algorithm. Produces normalized feature vectors suitable for neural
 * networks and gradient-based models.
 *
 * Two modes:
 *  1. Batch: fit() on historical data, then transform() new data
 *  2. Online: update() incrementally as new data arrives
 */

import type { FeatureVector } from "./types.js";

export interface FeatureStats {
  mean: number;
  variance: number;
  stdDev: number;
  count: number;
  min: number;
  max: number;
}

export class FeatureNormalizer {
  /** Running stats per feature name */
  private stats = new Map<string, { mean: number; m2: number; count: number; min: number; max: number }>();

  /** Fit normalizer on a batch of feature vectors */
  fit(vectors: FeatureVector[]): void {
    this.stats.clear();
    for (const vec of vectors) {
      this.update(vec);
    }
  }

  /** Incrementally update stats with a single feature vector (Welford's) */
  update(vec: FeatureVector): void {
    for (const [name, value] of Object.entries(vec.features)) {
      if (!isFinite(value)) continue;
      let s = this.stats.get(name);
      if (!s) {
        s = { mean: 0, m2: 0, count: 0, min: Infinity, max: -Infinity };
        this.stats.set(name, s);
      }
      s.count++;
      const delta = value - s.mean;
      s.mean += delta / s.count;
      const delta2 = value - s.mean;
      s.m2 += delta * delta2;
      if (value < s.min) s.min = value;
      if (value > s.max) s.max = value;
    }
  }

  /**
   * Normalize a feature vector using z-score: (value - mean) / stdDev.
   * NaN features are set to 0 (neutral).
   * Returns a new Record with the same keys as vec.features.
   */
  transform(vec: FeatureVector): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const [name, value] of Object.entries(vec.features)) {
      const s = this.stats.get(name);
      if (!s || s.count < 2 || !isFinite(value)) {
        normalized[name] = 0;
        continue;
      }
      const stdDev = Math.sqrt(s.m2 / s.count);
      normalized[name] = stdDev > 0 ? (value - s.mean) / stdDev : 0;
    }
    return normalized;
  }

  /**
   * Min-max normalization to [0, 1] range.
   * Alternative to z-score for bounded inputs (e.g., RSI already 0-100).
   */
  transformMinMax(vec: FeatureVector): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const [name, value] of Object.entries(vec.features)) {
      const s = this.stats.get(name);
      if (!s || !isFinite(value)) {
        normalized[name] = 0;
        continue;
      }
      const range = s.max - s.min;
      normalized[name] = range > 0 ? (value - s.min) / range : 0.5;
    }
    return normalized;
  }

  /** Get stats for a specific feature */
  getStats(featureName: string): FeatureStats | undefined {
    const s = this.stats.get(featureName);
    if (!s) return undefined;
    const variance = s.count > 1 ? s.m2 / s.count : 0;
    return {
      mean: s.mean,
      variance,
      stdDev: Math.sqrt(variance),
      count: s.count,
      min: s.min,
      max: s.max,
    };
  }

  /** Get all feature stats */
  getAllStats(): Map<string, FeatureStats> {
    const result = new Map<string, FeatureStats>();
    for (const [name] of this.stats) {
      result.set(name, this.getStats(name)!);
    }
    return result;
  }

  /** Export normalizer state for persistence */
  serialize(): Record<string, { mean: number; m2: number; count: number; min: number; max: number }> {
    const obj: Record<string, { mean: number; m2: number; count: number; min: number; max: number }> = {};
    for (const [name, s] of this.stats) {
      obj[name] = { ...s };
    }
    return obj;
  }

  /** Restore normalizer state from serialized data */
  deserialize(data: Record<string, { mean: number; m2: number; count: number; min: number; max: number }>): void {
    this.stats.clear();
    for (const [name, s] of Object.entries(data)) {
      this.stats.set(name, { ...s });
    }
  }

  /** Number of features being tracked */
  get featureCount(): number {
    return this.stats.size;
  }

  /** Number of samples seen */
  get sampleCount(): number {
    const first = this.stats.values().next();
    return first.done ? 0 : first.value.count;
  }

  /** Reset all stats */
  reset(): void {
    this.stats.clear();
  }
}
