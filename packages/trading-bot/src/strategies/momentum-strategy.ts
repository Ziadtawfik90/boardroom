/**
 * Momentum Strategy (Baseline)
 *
 * Buys when price shows sustained upward momentum over a lookback window.
 * Sells when momentum reverses. Uses rate-of-change (ROC) and simple
 * moving average crossover as primary signals.
 *
 * Parameters:
 *   - shortWindow: fast MA period (default: 10)
 *   - longWindow: slow MA period (default: 30)
 *   - rocPeriod: rate-of-change lookback (default: 14)
 *   - rocThreshold: min ROC to trigger buy (default: 0.02 = 2%)
 */

import type { Ticker, OrderRequest } from "../exchange/types.js";
import type { Strategy, Signal, StrategyConfig, StrategyState } from "./types.js";

export interface MomentumConfig extends StrategyConfig {
  shortWindow?: number;
  longWindow?: number;
  rocPeriod?: number;
  rocThreshold?: number;
  /** Quantity per trade in base asset (e.g., 0.01 BTC) */
  tradeQuantity: number;
}

export class MomentumStrategy implements Strategy {
  readonly name = "momentum";

  private readonly config: Required<MomentumConfig>;
  private prices: number[] = [];
  private currentSignal: Signal = "hold";
  private inPosition = false;

  constructor(config: MomentumConfig) {
    this.config = {
      shortWindow: 10,
      longWindow: 30,
      rocPeriod: 14,
      rocThreshold: 0.02,
      ...config,
    };
  }

  onTick(ticker: Ticker): Signal {
    this.prices.push(ticker.price);

    // Need enough data for long MA + some buffer
    if (this.prices.length < this.config.longWindow + 1) {
      this.currentSignal = "hold";
      return "hold";
    }

    const shortMA = this.sma(this.config.shortWindow);
    const longMA = this.sma(this.config.longWindow);
    const roc = this.rateOfChange(this.config.rocPeriod);

    // Buy: short MA crosses above long MA AND positive momentum
    if (!this.inPosition && shortMA > longMA && roc > this.config.rocThreshold) {
      this.currentSignal = "buy";
      this.inPosition = true;
      return "buy";
    }

    // Sell: short MA crosses below long MA OR momentum reversal
    if (this.inPosition && (shortMA < longMA || roc < -this.config.rocThreshold)) {
      this.currentSignal = "sell";
      this.inPosition = false;
      return "sell";
    }

    this.currentSignal = "hold";
    return "hold";
  }

  getOrder(ticker: Ticker, availableBalance: number): OrderRequest | null {
    const signal = this.currentSignal;
    if (signal === "hold") return null;

    const maxSpend = availableBalance * this.config.maxPositionPct;
    const quantity = signal === "buy"
      ? Math.min(this.config.tradeQuantity, maxSpend / ticker.ask)
      : this.config.tradeQuantity;

    if (quantity <= 0) return null;

    return {
      symbol: this.config.symbol,
      side: signal,
      type: "market",
      quantity,
    };
  }

  getState(): StrategyState {
    const indicators: Record<string, number> = {};
    if (this.prices.length >= this.config.longWindow) {
      indicators.shortMA = this.sma(this.config.shortWindow);
      indicators.longMA = this.sma(this.config.longWindow);
      indicators.roc = this.rateOfChange(this.config.rocPeriod);
    }
    return {
      name: this.name,
      signal: this.currentSignal,
      confidence: this.prices.length >= this.config.longWindow ? 0.6 : 0,
      indicators,
    };
  }

  reset(): void {
    this.prices = [];
    this.currentSignal = "hold";
    this.inPosition = false;
  }

  private sma(period: number): number {
    const slice = this.prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  private rateOfChange(period: number): number {
    if (this.prices.length < period + 1) return 0;
    const current = this.prices[this.prices.length - 1];
    const past = this.prices[this.prices.length - 1 - period];
    return (current - past) / past;
  }
}
