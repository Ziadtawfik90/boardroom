/**
 * Mean Reversion Strategy (Baseline)
 *
 * Uses Bollinger Bands to detect overbought/oversold conditions.
 * - BUY when price drops below lower band (oversold)
 * - SELL when price rises above upper band (overbought)
 * - HOLD when price is between bands
 *
 * Works best in range-bound markets. Dangerous in trending markets.
 */

import type { Ticker, OrderRequest } from "../exchange/types.js";
import type { Signal, Strategy, StrategyConfig, StrategyState } from "./types.js";

export interface MeanReversionConfig extends StrategyConfig {
  /** Lookback period for SMA / std dev (default: 20) */
  period?: number;
  /** Number of standard deviations for bands (default: 2) */
  bandWidth?: number;
  /** Minimum ticks between trades (default: 10) */
  cooldownTicks?: number;
  /** Quantity per trade in base asset */
  tradeQuantity: number;
}

export class MeanReversionStrategy implements Strategy {
  readonly name = "mean-reversion-bollinger";

  private readonly config: Required<MeanReversionConfig>;
  private prices: number[] = [];
  private tickCount = 0;
  private lastTradeTick = -Infinity;
  private currentSignal: Signal = "hold";
  private inPosition = false;
  private lastSma = 0;
  private lastStdDev = 0;
  private lastUpperBand = 0;
  private lastLowerBand = 0;

  constructor(config: MeanReversionConfig) {
    this.config = {
      period: 20,
      bandWidth: 2,
      cooldownTicks: 10,
      ...config,
    };
  }

  onTick(ticker: Ticker): Signal {
    this.tickCount++;
    this.prices.push(ticker.price);

    // Keep only the lookback window
    if (this.prices.length > this.config.period) {
      this.prices.shift();
    }

    // Need full window before trading
    if (this.prices.length < this.config.period) {
      this.currentSignal = "hold";
      return "hold";
    }

    // Compute Bollinger Bands
    this.lastSma = this.prices.reduce((s, p) => s + p, 0) / this.prices.length;
    const variance = this.prices.reduce((s, p) => s + (p - this.lastSma) ** 2, 0) / this.prices.length;
    this.lastStdDev = Math.sqrt(variance);
    this.lastUpperBand = this.lastSma + this.config.bandWidth * this.lastStdDev;
    this.lastLowerBand = this.lastSma - this.config.bandWidth * this.lastStdDev;
    const price = ticker.price;

    // Enforce cooldown
    if (this.tickCount - this.lastTradeTick < this.config.cooldownTicks) {
      this.currentSignal = "hold";
      return "hold";
    }

    // Buy when oversold, sell when overbought
    if (!this.inPosition && price <= this.lastLowerBand) {
      this.lastTradeTick = this.tickCount;
      this.currentSignal = "buy";
      this.inPosition = true;
      return "buy";
    }

    if (this.inPosition && price >= this.lastUpperBand) {
      this.lastTradeTick = this.tickCount;
      this.currentSignal = "sell";
      this.inPosition = false;
      return "sell";
    }

    this.currentSignal = "hold";
    return "hold";
  }

  getOrder(ticker: Ticker, availableBalance: number): OrderRequest | null {
    if (this.currentSignal === "hold") return null;

    const maxSpend = availableBalance * this.config.maxPositionPct;
    const quantity = this.currentSignal === "buy"
      ? Math.min(this.config.tradeQuantity, maxSpend / ticker.ask)
      : this.config.tradeQuantity;

    if (quantity <= 0) return null;

    return {
      symbol: this.config.symbol,
      side: this.currentSignal,
      type: "market",
      quantity,
    };
  }

  getState(): StrategyState {
    return {
      name: this.name,
      signal: this.currentSignal,
      confidence: this.prices.length >= this.config.period ? 0.5 : 0,
      indicators: {
        sma: this.lastSma,
        stdDev: this.lastStdDev,
        upperBand: this.lastUpperBand,
        lowerBand: this.lastLowerBand,
      },
    };
  }

  reset(): void {
    this.prices = [];
    this.tickCount = 0;
    this.lastTradeTick = -Infinity;
    this.currentSignal = "hold";
    this.inPosition = false;
    this.lastSma = 0;
    this.lastStdDev = 0;
    this.lastUpperBand = 0;
    this.lastLowerBand = 0;
  }
}
