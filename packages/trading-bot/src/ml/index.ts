export { FeatureExtractor } from "./feature-extractor.js";
export { OnlineModel } from "./online-model.js";
export { AdaptiveStrategyImpl } from "./adaptive-strategy.js";
export type { AdaptiveStrategyConfig } from "./adaptive-strategy.js";
export { createAdaptiveStrategy } from "./adaptive-strategy-adapter.js";
export { RegimeDetector } from "./regime-detector.js";
export { RiskManager } from "./risk-manager.js";
export {
  momentumSignal,
  meanReversionSignal,
  rsiSignal,
  volumeSpikeSignal,
  allRuleSignals,
} from "./rule-signals.js";

// Re-export types with ML prefix to avoid conflicts with strategy/data modules
export type {
  AdaptiveStrategy,
  EnsembleConfig,
  FeatureConfig,
  ModelConfig,
  ModelWeights,
  PredictionResult,
  RuleSignal,
  SignalDirection,
  TradeOutcome,
  TrainingStats,
} from "./types.js";

// These types conflict with strategy/Signal and data/FeatureVector,
// so re-export under prefixed names
export type {
  Signal as MLSignal,
  FeatureVector as MLFeatureVector,
} from "./types.js";
