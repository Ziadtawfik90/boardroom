/**
 * Backtest-Compatible Strategy Adapters
 *
 * Wraps the live-trading Strategy interface into the simpler BacktestStrategy
 * interface used by the backtest engine. Also provides direct backtest-native
 * implementations for cleaner candle-based evaluation.
 */

import type { BacktestStrategy, StrategyContext, StrategySignal } from "./types.js";
import { ema, rsi, bollingerBands, sma } from "../strategy/indicators.js";

// ─── Momentum Strategy (Backtest Version) ──────────────────────────

export interface MomentumBacktestParams {
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  positionSizePct: number;
}

const MOMENTUM_DEFAULTS: MomentumBacktestParams = {
  fastPeriod: 12,
  slowPeriod: 26,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  positionSizePct: 0.95,
};

export class MomentumBacktest implements BacktestStrategy {
  readonly name: string;
  private readonly params: MomentumBacktestParams;
  private prevFastEma: number | null = null;
  private prevSlowEma: number | null = null;

  constructor(params?: Partial<MomentumBacktestParams>, name?: string) {
    this.params = { ...MOMENTUM_DEFAULTS, ...params };
    this.name = name ?? "momentum";
  }

  reset(): void {
    this.prevFastEma = null;
    this.prevSlowEma = null;
  }

  onCandle(ctx: StrategyContext): StrategySignal {
    const closes = ctx.history.map((c) => c.close);
    const minRequired = Math.max(this.params.slowPeriod, this.params.rsiPeriod + 1);

    if (closes.length < minRequired) {
      return { action: "hold", reason: `warming up: ${closes.length}/${minRequired}` };
    }

    const fastEma = ema(closes, this.params.fastPeriod);
    const slowEma = ema(closes, this.params.slowPeriod);
    const currentRsi = rsi(closes, this.params.rsiPeriod);

    if (fastEma === null || slowEma === null || currentRsi === null) {
      return { action: "hold", reason: "indicator calculation failed" };
    }

    const signal: StrategySignal = { action: "hold" };

    // Detect EMA crossover
    if (this.prevFastEma !== null && this.prevSlowEma !== null) {
      const wasBelowOrEqual = this.prevFastEma <= this.prevSlowEma;
      const isAbove = fastEma > slowEma;
      const wasAboveOrEqual = this.prevFastEma >= this.prevSlowEma;
      const isBelow = fastEma < slowEma;

      // Bullish crossover
      if (wasBelowOrEqual && isAbove && currentRsi < this.params.rsiOverbought) {
        if (ctx.positionSize === 0) {
          signal.action = "buy";
          signal.size = this.params.positionSizePct;
          signal.reason = `EMA bullish crossover (fast=${fastEma.toFixed(2)} > slow=${slowEma.toFixed(2)}, RSI=${currentRsi.toFixed(1)})`;
        }
      }

      // Bearish crossover
      if (wasAboveOrEqual && isBelow && currentRsi > this.params.rsiOversold) {
        if (ctx.positionSize > 0) {
          signal.action = "sell";
          signal.reason = `EMA bearish crossover (fast=${fastEma.toFixed(2)} < slow=${slowEma.toFixed(2)}, RSI=${currentRsi.toFixed(1)})`;
        }
      }
    }

    this.prevFastEma = fastEma;
    this.prevSlowEma = slowEma;
    return signal;
  }
}

// ─── Mean Reversion Strategy (Backtest Version) ────────────────────

export interface MeanReversionBacktestParams {
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  positionSizePct: number;
}

const MEAN_REVERSION_DEFAULTS: MeanReversionBacktestParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  positionSizePct: 0.95,
};

export class MeanReversionBacktest implements BacktestStrategy {
  readonly name: string;
  private readonly params: MeanReversionBacktestParams;

  constructor(params?: Partial<MeanReversionBacktestParams>, name?: string) {
    this.params = { ...MEAN_REVERSION_DEFAULTS, ...params };
    this.name = name ?? "mean-reversion";
  }

  reset(): void {
    // Stateless — BB and RSI computed fresh from history each call
  }

  onCandle(ctx: StrategyContext): StrategySignal {
    const closes = ctx.history.map((c) => c.close);
    const minRequired = Math.max(this.params.bbPeriod, this.params.rsiPeriod + 1);

    if (closes.length < minRequired) {
      return { action: "hold", reason: `warming up: ${closes.length}/${minRequired}` };
    }

    const bb = bollingerBands(closes, this.params.bbPeriod, this.params.bbStdDev);
    const currentRsi = rsi(closes, this.params.rsiPeriod);

    if (!bb || currentRsi === null) {
      return { action: "hold", reason: "indicator calculation failed" };
    }

    const price = ctx.candle.close;

    // Buy: price below lower band + RSI oversold
    if (price <= bb.lower && currentRsi <= this.params.rsiOversold && ctx.positionSize === 0) {
      return {
        action: "buy",
        size: this.params.positionSizePct,
        reason: `price ${price.toFixed(2)} < BB lower ${bb.lower.toFixed(2)}, RSI ${currentRsi.toFixed(1)}`,
      };
    }

    // Sell: price above upper band + RSI overbought (or mean reversion exit)
    if (ctx.positionSize > 0) {
      // Exit on overbought
      if (price >= bb.upper && currentRsi >= this.params.rsiOverbought) {
        return {
          action: "sell",
          reason: `price ${price.toFixed(2)} > BB upper ${bb.upper.toFixed(2)}, RSI ${currentRsi.toFixed(1)}`,
        };
      }
      // Exit on mean reversion to middle band
      if (price >= bb.middle && currentRsi > 50) {
        return {
          action: "sell",
          reason: `mean reversion exit at ${price.toFixed(2)} (mid=${bb.middle.toFixed(2)}, RSI ${currentRsi.toFixed(1)})`,
        };
      }
    }

    return { action: "hold" };
  }
}

// ─── Buy & Hold Benchmark ──────────────────────────────────────────

export class BuyAndHoldBacktest implements BacktestStrategy {
  readonly name = "buy-and-hold";
  private bought = false;

  reset(): void {
    this.bought = false;
  }

  onCandle(ctx: StrategyContext): StrategySignal {
    if (!this.bought && ctx.positionSize === 0) {
      this.bought = true;
      return { action: "buy", size: 0.95, reason: "buy and hold entry" };
    }
    return { action: "hold" };
  }
}
