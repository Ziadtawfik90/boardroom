/**
 * Strategy Bridge
 *
 * Adapts the StrategyEngine (event-driven Signal interface) into the
 * SandboxRunner's StrategyFn format. This lets the sandbox run any
 * registered strategy from the pluggable engine, converting signals
 * into concrete OrderRequest[] based on position state and signal strength.
 */

import type { OrderRequest, Ticker, Balance, Position } from "../exchange/types.js";
import type { Signal } from "../strategy/types.js";
import { StrategyEngine } from "../strategy/strategy-engine.js";
import type { StrategyContext, StrategyFn } from "./sandbox-runner.js";

export interface BridgeConfig {
  /** Base position size as fraction of free quote balance (default: 0.02 = 2%) */
  basePositionSizePct?: number;
  /** Minimum order value in quote currency (default: 10) */
  minOrderValue?: number;
}

/**
 * Create a StrategyFn that routes tickers through a StrategyEngine
 * and converts resulting signals into executable orders.
 */
export function createStrategyBridge(
  engine: StrategyEngine,
  config?: BridgeConfig,
): StrategyFn {
  const baseSize = config?.basePositionSizePct ?? 0.02;
  const minOrder = config?.minOrderValue ?? 10;

  return (ctx: StrategyContext): OrderRequest[] => {
    // Feed the ticker into the engine to evaluate all registered strategies
    const signals = engine.feedTickerSync(ctx.ticker);

    const orders: OrderRequest[] = [];

    for (const signal of signals) {
      const order = signalToOrder(signal, ctx, baseSize, minOrder);
      if (order) orders.push(order);
    }

    return orders;
  };
}

function signalToOrder(
  signal: Signal,
  ctx: StrategyContext,
  baseSize: number,
  minOrder: number,
): OrderRequest | null {
  if (signal.action === "hold") return null;

  const [base, quote] = signal.symbol.split("/");
  const quoteBalance = ctx.balances.find((b) => b.asset === quote);
  const basePosition = ctx.positions.find((p) => p.symbol === signal.symbol);
  const hasOpenOrders = ctx.openOrders.some((o) => o.symbol === signal.symbol);

  if (hasOpenOrders) return null;

  if (signal.action === "buy") {
    if (!quoteBalance || quoteBalance.free <= 0) return null;

    // Scale position by signal strength
    const sizePct = baseSize * Math.max(signal.strength, 0.1);
    const allocAmount = quoteBalance.free * sizePct;
    const quantity = allocAmount / ctx.ticker.ask;

    if (quantity * ctx.ticker.ask < minOrder) return null;

    return {
      symbol: signal.symbol,
      side: "buy",
      type: "market",
      quantity,
    };
  }

  if (signal.action === "sell") {
    if (!basePosition || basePosition.quantity <= 0) return null;

    // Sell proportional to signal strength (at least 50% of position)
    const sellPct = 0.5 + 0.5 * Math.min(signal.strength, 1);
    const quantity = basePosition.quantity * sellPct;

    if (quantity * ctx.ticker.bid < minOrder) return null;

    return {
      symbol: signal.symbol,
      side: "sell",
      type: "market",
      quantity,
    };
  }

  return null;
}
