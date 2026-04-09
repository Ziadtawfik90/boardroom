/**
 * Strategy Adapters for Backtest Engine
 *
 * Bridges the Strategy interface (onTick) to the BacktestStrategy interface
 * (onCandle) used by the backtest engine. This lets us validate the
 * existing momentum and mean-reversion strategies through the full
 * backtesting pipeline.
 */

import type { Ticker } from "../exchange/types.js";
import type { BacktestStrategy, StrategySignal, StrategyContext } from "../backtest/types.js";
import { MomentumStrategy, type MomentumConfig } from "../strategies/momentum-strategy.js";
import { MeanReversionStrategy, type MeanReversionConfig } from "../strategies/mean-reversion-strategy.js";

/**
 * Adapts MomentumStrategy (ticker-based) to BacktestStrategy (candle-based).
 * Converts candle close prices to synthetic tickers for the strategy.
 */
export class MomentumBacktestAdapter implements BacktestStrategy {
  readonly name: string;
  private readonly strategy: MomentumStrategy;
  private readonly positionSizePct: number;

  constructor(config: MomentumConfig) {
    this.strategy = new MomentumStrategy(config);
    this.name = `momentum (short=${config.shortWindow ?? 10}, long=${config.longWindow ?? 30}, roc=${config.rocPeriod ?? 14})`;
    this.positionSizePct = config.maxPositionPct;
  }

  reset(): void {
    this.strategy.reset();
  }

  onCandle(ctx: StrategyContext): StrategySignal {
    const ticker = candleToTicker(ctx.candle, "BTC/USDT");
    const signal = this.strategy.onTick(ticker);

    if (signal === "buy" && ctx.positionSize === 0) {
      return { action: "buy", size: this.positionSizePct, reason: "momentum buy signal" };
    }
    if (signal === "sell" && ctx.positionSize > 0) {
      return { action: "sell", reason: "momentum sell signal" };
    }
    return { action: "hold" };
  }
}

/**
 * Adapts MeanReversionStrategy (ticker-based) to BacktestStrategy (candle-based).
 */
export class MeanReversionBacktestAdapter implements BacktestStrategy {
  readonly name: string;
  private readonly strategy: MeanReversionStrategy;
  private readonly positionSizePct: number;

  constructor(config: MeanReversionConfig) {
    this.strategy = new MeanReversionStrategy(config);
    this.name = `mean-reversion (period=${config.period ?? 20}, bands=${config.bandWidth ?? 2})`;
    this.positionSizePct = config.maxPositionPct;
  }

  reset(): void {
    this.strategy.reset();
  }

  onCandle(ctx: StrategyContext): StrategySignal {
    const ticker = candleToTicker(ctx.candle, "BTC/USDT");
    const signal = this.strategy.onTick(ticker);

    if (signal === "buy" && ctx.positionSize === 0) {
      return { action: "buy", size: this.positionSizePct, reason: "oversold - below lower band" };
    }
    if (signal === "sell" && ctx.positionSize > 0) {
      return { action: "sell", reason: "overbought - above upper band" };
    }
    return { action: "hold" };
  }
}

/** Convert a candle's close price to a synthetic Ticker */
function candleToTicker(candle: import("../exchange/types.js").Candle, symbol: string): Ticker {
  const spread = candle.close * 0.0005; // 0.05% synthetic spread
  return {
    symbol,
    price: candle.close,
    bid: candle.close - spread / 2,
    ask: candle.close + spread / 2,
    volume24h: candle.volume * 24,
    timestamp: candle.timestamp,
  };
}
