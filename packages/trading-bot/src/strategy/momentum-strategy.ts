/**
 * Momentum Strategy — Baseline
 *
 * Trend-following strategy using EMA crossover and RSI confirmation.
 * Buys when fast EMA crosses above slow EMA with RSI not overbought.
 * Sells when fast EMA crosses below slow EMA with RSI not oversold.
 *
 * Parameters:
 *   fastPeriod   — Fast EMA period (default: 12)
 *   slowPeriod   — Slow EMA period (default: 26)
 *   rsiPeriod    — RSI lookback (default: 14)
 *   rsiOverbought — RSI threshold to avoid buying (default: 70)
 *   rsiOversold   — RSI threshold to avoid selling (default: 30)
 *   signalStrength — Base signal strength 0-1 (default: 0.5)
 */

import type { Strategy, StrategyConfig, MarketSnapshot, Signal } from "./types.js";
import { ema, rsi } from "./indicators.js";

interface MomentumParams {
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  signalStrength: number;
}

const DEFAULTS: MomentumParams = {
  fastPeriod: 12,
  slowPeriod: 26,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  signalStrength: 0.5,
};

export class MomentumStrategy implements Strategy {
  readonly name = "momentum";
  readonly config: StrategyConfig;
  private readonly params: MomentumParams;
  private priceHistory = new Map<string, number[]>();
  private prevFastEma = new Map<string, number>();
  private prevSlowEma = new Map<string, number>();

  constructor(config: StrategyConfig) {
    this.config = config;
    this.params = { ...DEFAULTS, ...(config.params as Partial<MomentumParams>) };
  }

  async initialize(): Promise<void> {
    // No async setup needed — indicators warm up from price history
    for (const symbol of this.config.symbols) {
      this.priceHistory.set(symbol, []);
    }
  }

  evaluate(snapshot: MarketSnapshot): Signal {
    const { symbol, ticker } = snapshot;
    const hold: Signal = {
      action: "hold",
      symbol,
      strength: 0,
      reason: "insufficient data or no signal",
      timestamp: Date.now(),
    };

    // Accumulate price history
    let prices = this.priceHistory.get(symbol);
    if (!prices) {
      prices = [];
      this.priceHistory.set(symbol, prices);
    }
    prices.push(ticker.price);

    // Also use candle closes if available
    if (snapshot.candles.length > 0 && prices.length < this.params.slowPeriod + 5) {
      const candleCloses = snapshot.candles.map((c) => c.close);
      prices.unshift(...candleCloses);
      this.priceHistory.set(symbol, prices);
    }

    // Cap history to prevent memory growth
    if (prices.length > 500) {
      prices.splice(0, prices.length - 500);
    }

    // Need enough data for slow EMA + RSI
    const minRequired = Math.max(this.params.slowPeriod, this.params.rsiPeriod + 1);
    if (prices.length < minRequired) {
      hold.reason = `warming up: ${prices.length}/${minRequired} prices`;
      return hold;
    }

    // Calculate indicators
    const fastEma = ema(prices, this.params.fastPeriod);
    const slowEma = ema(prices, this.params.slowPeriod);
    const currentRsi = rsi(prices, this.params.rsiPeriod);

    if (fastEma === null || slowEma === null || currentRsi === null) {
      return hold;
    }

    // Detect crossover
    const prevFast = this.prevFastEma.get(symbol);
    const prevSlow = this.prevSlowEma.get(symbol);
    this.prevFastEma.set(symbol, fastEma);
    this.prevSlowEma.set(symbol, slowEma);

    // Need previous EMAs to detect crossover
    if (prevFast === undefined || prevSlow === undefined) {
      hold.reason = "waiting for crossover baseline";
      return hold;
    }

    const wasBelowOrEqual = prevFast <= prevSlow;
    const isAbove = fastEma > slowEma;
    const wasAboveOrEqual = prevFast >= prevSlow;
    const isBelow = fastEma < slowEma;

    const metadata = {
      fastEma: +fastEma.toFixed(4),
      slowEma: +slowEma.toFixed(4),
      rsi: +currentRsi.toFixed(2),
      priceCount: prices.length,
    };

    // Bullish crossover: fast crosses above slow
    if (wasBelowOrEqual && isAbove && currentRsi < this.params.rsiOverbought) {
      return {
        action: "buy",
        symbol,
        strength: this.params.signalStrength,
        reason: `EMA crossover bullish (fast ${fastEma.toFixed(2)} > slow ${slowEma.toFixed(2)}, RSI ${currentRsi.toFixed(1)})`,
        metadata,
        timestamp: Date.now(),
      };
    }

    // Bearish crossover: fast crosses below slow
    if (wasAboveOrEqual && isBelow && currentRsi > this.params.rsiOversold) {
      return {
        action: "sell",
        symbol,
        strength: this.params.signalStrength,
        reason: `EMA crossover bearish (fast ${fastEma.toFixed(2)} < slow ${slowEma.toFixed(2)}, RSI ${currentRsi.toFixed(1)})`,
        metadata,
        timestamp: Date.now(),
      };
    }

    hold.reason = `no crossover (fast=${fastEma.toFixed(2)}, slow=${slowEma.toFixed(2)}, RSI=${currentRsi.toFixed(1)})`;
    hold.metadata = metadata;
    return hold;
  }

  destroy(): void {
    this.priceHistory.clear();
    this.prevFastEma.clear();
    this.prevSlowEma.clear();
  }
}

/** Factory function for dynamic registration */
export function createMomentumStrategy(config: StrategyConfig): MomentumStrategy {
  return new MomentumStrategy(config);
}
