/**
 * Backtest Engine
 *
 * Feeds historical candle data through a strategy, simulates order execution
 * with slippage and fees, and produces an equity curve + trade list.
 *
 * Usage:
 *   const engine = new BacktestEngine(config);
 *   const result = engine.run(strategy, candles);
 */

import type { Candle } from "../exchange/types.js";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestStrategy,
  BacktestTrade,
  EquityPoint,
  StrategyContext,
} from "./types.js";
import { calculateMetrics } from "./metrics.js";

export class BacktestEngine {
  private readonly config: BacktestConfig;
  private readonly takerFeePct: number;
  private readonly slippagePct: number;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.takerFeePct = config.takerFeePct ?? 0.001;
    this.slippagePct = config.slippagePct ?? 0.0005;
  }

  /**
   * Run a backtest over historical candle data.
   * Candles must be sorted chronologically (oldest first).
   */
  run(strategy: BacktestStrategy, candles: Candle[]): BacktestResult {
    if (candles.length === 0) {
      throw new Error("Cannot backtest with empty candle data");
    }

    strategy.reset();

    let cash = this.config.initialCapital;
    let positionQty = 0;
    let positionEntryPrice = 0;
    let positionEntryTime = 0;
    let positionEntryBar = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: EquityPoint[] = [];
    let peakEquity = cash;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const positionValue = positionQty * candle.close;
      const equity = cash + positionValue;

      if (equity > peakEquity) peakEquity = equity;
      const drawdown = peakEquity > 0 ? (equity - peakEquity) / peakEquity : 0;

      equityCurve.push({
        timestamp: candle.timestamp,
        equity,
        cash,
        positionValue,
        drawdown,
      });

      // Build context for strategy
      const ctx: StrategyContext = {
        candle,
        history: candles.slice(0, i + 1),
        positionSize: positionQty,
        equity,
        availableCash: cash,
      };

      const signal = strategy.onCandle(ctx);

      // Execute signals
      if (signal.action === "buy" && positionQty === 0) {
        const sizeFraction = signal.size ?? 1;
        const capital = cash * sizeFraction;
        const price = candle.close * (1 + this.slippagePct);
        const fee = capital * this.takerFeePct;
        const qty = (capital - fee) / price;

        if (qty > 0 && capital <= cash) {
          cash -= capital;
          positionQty = qty;
          positionEntryPrice = price;
          positionEntryTime = candle.timestamp;
          positionEntryBar = i;
        }
      } else if (signal.action === "sell" && positionQty > 0) {
        const price = candle.close * (1 - this.slippagePct);
        const gross = positionQty * price;
        const fee = gross * this.takerFeePct;
        const net = gross - fee;
        const cost = positionQty * positionEntryPrice;
        const pnl = net - cost;
        const entryFee = cost * this.takerFeePct;

        trades.push({
          entryTime: positionEntryTime,
          exitTime: candle.timestamp,
          side: "buy",
          entryPrice: positionEntryPrice,
          exitPrice: price,
          quantity: positionQty,
          pnl,
          pnlPct: cost > 0 ? pnl / cost : 0,
          fees: fee + entryFee,
          holdingPeriodBars: i - positionEntryBar,
        });

        cash += net;
        positionQty = 0;
        positionEntryPrice = 0;
      }
    }

    // Close open position at last candle price for final accounting
    if (positionQty > 0) {
      const lastCandle = candles[candles.length - 1];
      const price = lastCandle.close;
      const gross = positionQty * price;
      const fee = gross * this.takerFeePct;
      const net = gross - fee;
      const cost = positionQty * positionEntryPrice;
      const pnl = net - cost;
      const entryFee = cost * this.takerFeePct;

      trades.push({
        entryTime: positionEntryTime,
        exitTime: lastCandle.timestamp,
        side: "buy",
        entryPrice: positionEntryPrice,
        exitPrice: price,
        quantity: positionQty,
        pnl,
        pnlPct: cost > 0 ? pnl / cost : 0,
        fees: fee + entryFee,
        holdingPeriodBars: candles.length - 1 - positionEntryBar,
      });

      cash += net;
      positionQty = 0;

      // Update final equity point
      const last = equityCurve[equityCurve.length - 1];
      last.equity = cash;
      last.cash = cash;
      last.positionValue = 0;
    }

    const metrics = calculateMetrics(
      equityCurve,
      trades,
      this.config.timeframe,
      this.config.initialCapital,
    );

    return {
      strategyName: strategy.name,
      config: { ...this.config },
      metrics,
      trades,
      equityCurve,
    };
  }

  /**
   * Run backtest on a subset of candles (by index range).
   * Useful for walk-forward analysis.
   */
  runSlice(strategy: BacktestStrategy, candles: Candle[], start: number, end: number): BacktestResult {
    return this.run(strategy, candles.slice(start, end));
  }
}
