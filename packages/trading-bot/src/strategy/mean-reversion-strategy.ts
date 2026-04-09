/**
 * Mean Reversion Strategy — Baseline
 *
 * Buys when price drops below the lower Bollinger Band (oversold bounce).
 * Sells when price rises above the upper Bollinger Band (overbought fade).
 * Uses RSI as confirmation filter.
 *
 * Parameters:
 *   bbPeriod       — Bollinger Band SMA period (default: 20)
 *   bbStdDev       — Standard deviation multiplier (default: 2)
 *   rsiPeriod      — RSI lookback (default: 14)
 *   rsiOversold    — RSI threshold for buy confirmation (default: 30)
 *   rsiOverbought  — RSI threshold for sell confirmation (default: 70)
 *   signalStrength — Base signal strength 0-1 (default: 0.5)
 */

import type { Strategy, StrategyConfig, MarketSnapshot, Signal } from "./types.js";
import { bollingerBands, rsi } from "./indicators.js";

interface MeanReversionParams {
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  signalStrength: number;
}

const DEFAULTS: MeanReversionParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  signalStrength: 0.5,
};

export class MeanReversionStrategy implements Strategy {
  readonly name = "mean-reversion";
  readonly config: StrategyConfig;
  private readonly params: MeanReversionParams;
  private priceHistory = new Map<string, number[]>();

  constructor(config: StrategyConfig) {
    this.config = config;
    this.params = { ...DEFAULTS, ...(config.params as Partial<MeanReversionParams>) };
  }

  async initialize(): Promise<void> {
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

    // Backfill from candles if warming up
    if (snapshot.candles.length > 0 && prices.length < this.params.bbPeriod + 5) {
      const candleCloses = snapshot.candles.map((c) => c.close);
      prices.unshift(...candleCloses);
      this.priceHistory.set(symbol, prices);
    }

    // Cap history
    if (prices.length > 500) {
      prices.splice(0, prices.length - 500);
    }

    // Need enough data for Bollinger Bands + RSI
    const minRequired = Math.max(this.params.bbPeriod, this.params.rsiPeriod + 1);
    if (prices.length < minRequired) {
      hold.reason = `warming up: ${prices.length}/${minRequired} prices`;
      return hold;
    }

    // Calculate indicators
    const bb = bollingerBands(prices, this.params.bbPeriod, this.params.bbStdDev);
    const currentRsi = rsi(prices, this.params.rsiPeriod);

    if (!bb || currentRsi === null) {
      return hold;
    }

    const price = ticker.price;
    const metadata = {
      bbUpper: +bb.upper.toFixed(4),
      bbMiddle: +bb.middle.toFixed(4),
      bbLower: +bb.lower.toFixed(4),
      bandwidth: +bb.bandwidth.toFixed(6),
      rsi: +currentRsi.toFixed(2),
      priceCount: prices.length,
    };

    // Buy signal: price below lower band + RSI confirms oversold
    if (price <= bb.lower && currentRsi <= this.params.rsiOversold) {
      // Strength increases the further below the band
      const deviation = (bb.lower - price) / (bb.upper - bb.lower || 1);
      const strength = Math.min(1, this.params.signalStrength + deviation * 0.3);

      return {
        action: "buy",
        symbol,
        strength,
        reason: `price ${price.toFixed(2)} below lower BB ${bb.lower.toFixed(2)}, RSI ${currentRsi.toFixed(1)} oversold`,
        metadata,
        timestamp: Date.now(),
      };
    }

    // Sell signal: price above upper band + RSI confirms overbought
    if (price >= bb.upper && currentRsi >= this.params.rsiOverbought) {
      const deviation = (price - bb.upper) / (bb.upper - bb.lower || 1);
      const strength = Math.min(1, this.params.signalStrength + deviation * 0.3);

      return {
        action: "sell",
        symbol,
        strength,
        reason: `price ${price.toFixed(2)} above upper BB ${bb.upper.toFixed(2)}, RSI ${currentRsi.toFixed(1)} overbought`,
        metadata,
        timestamp: Date.now(),
      };
    }

    // Mean reversion back to middle — lighter signal
    // If we have a position and price is returning to the mean, signal exit
    if (price > bb.lower && price < bb.middle && currentRsi > 45 && currentRsi < 55) {
      hold.reason = `price reverting to mean (${bb.middle.toFixed(2)}), no action`;
      hold.metadata = metadata;
      return hold;
    }

    hold.reason = `price within bands (lower=${bb.lower.toFixed(2)}, upper=${bb.upper.toFixed(2)}, RSI=${currentRsi.toFixed(1)})`;
    hold.metadata = metadata;
    return hold;
  }

  destroy(): void {
    this.priceHistory.clear();
  }
}

/** Factory function for dynamic registration */
export function createMeanReversionStrategy(config: StrategyConfig): MeanReversionStrategy {
  return new MeanReversionStrategy(config);
}
