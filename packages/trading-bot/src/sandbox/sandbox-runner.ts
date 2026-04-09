/**
 * Sandbox Runner
 *
 * Wires together PaperExchange, PriceFeeds, and PerformanceTracker
 * into a runnable paper trading sandbox. Supports pluggable strategies
 * via the StrategyFn interface.
 *
 * Usage:
 *   const sandbox = new SandboxRunner(PRESET_CONSERVATIVE);
 *   sandbox.setStrategy(myStrategy);
 *   await sandbox.run();
 *   const report = sandbox.getReport();
 */

import { PaperExchange } from "../paper/paper-exchange.js";
import type { Ticker, OrderRequest } from "../exchange/types.js";
import { PriceFeed } from "./price-feed.js";
import { PerformanceTracker } from "./performance-tracker.js";
import type { SandboxConfig } from "./sandbox-config.js";

// ─── Strategy Interface ──────────────────────────────────────────────

export interface StrategyContext {
  /** Current ticker for this symbol */
  ticker: Ticker;
  /** Recent ticker history for this symbol (newest last) */
  history: Ticker[];
  /** Current balances */
  balances: Awaited<ReturnType<PaperExchange["getBalances"]>>;
  /** Current open positions */
  positions: Awaited<ReturnType<PaperExchange["getPositions"]>>;
  /** Current open orders */
  openOrders: Awaited<ReturnType<PaperExchange["getOpenOrders"]>>;
  /** Total tick count */
  tick: number;
}

/** A strategy receives market context and returns zero or more order requests */
export type StrategyFn = (ctx: StrategyContext) => OrderRequest[];

// ─── Built-in: Simple Momentum Strategy ──────────────────────────────

/**
 * Simple momentum strategy for testing the sandbox.
 * Buys after N consecutive up-ticks, sells after N consecutive down-ticks.
 * Position sized to a fixed fraction of available capital.
 */
export function createSimpleMomentumStrategy(options?: {
  lookback?: number;
  positionSizePct?: number;
}): StrategyFn {
  const lookback = options?.lookback ?? 5;
  const positionSizePct = options?.positionSizePct ?? 0.02; // 2% of equity per trade

  return (ctx: StrategyContext): OrderRequest[] => {
    if (ctx.history.length < lookback + 1) return [];

    const recent = ctx.history.slice(-lookback - 1);
    const changes = [];
    for (let i = 1; i < recent.length; i++) {
      changes.push(recent[i].price - recent[i - 1].price);
    }

    const allUp = changes.every((c) => c > 0);
    const allDown = changes.every((c) => c < 0);

    const [base, quote] = ctx.ticker.symbol.split("/");
    const quoteBalance = ctx.balances.find((b) => b.asset === quote);
    const basePosition = ctx.positions.find((p) => p.symbol === ctx.ticker.symbol);
    const hasOpenOrders = ctx.openOrders.some((o) => o.symbol === ctx.ticker.symbol);

    if (hasOpenOrders) return [];

    const orders: OrderRequest[] = [];

    if (allUp && quoteBalance && quoteBalance.free > 0) {
      // Buy signal: allocate positionSizePct of free quote balance
      const allocAmount = quoteBalance.free * positionSizePct;
      const quantity = allocAmount / ctx.ticker.ask;
      if (quantity * ctx.ticker.ask > 10) { // minimum $10 order
        orders.push({
          symbol: ctx.ticker.symbol,
          side: "buy",
          type: "market",
          quantity,
        });
      }
    } else if (allDown && basePosition && basePosition.quantity > 0) {
      // Sell signal: close entire position
      orders.push({
        symbol: ctx.ticker.symbol,
        side: "sell",
        type: "market",
        quantity: basePosition.quantity,
      });
    }

    return orders;
  };
}

// ─── Runner ──────────────────────────────────────────────────────────

export class SandboxRunner {
  private readonly config: SandboxConfig;
  private readonly exchange: PaperExchange;
  private readonly feeds: PriceFeed[];
  private readonly perfTracker: PerformanceTracker;
  private readonly tickerHistory = new Map<string, Ticker[]>();

  private strategy: StrategyFn | null = null;
  private tickCount = 0;
  private running = false;
  private stopped = false;

  private static readonly MAX_HISTORY = 200;

  constructor(config: SandboxConfig) {
    this.config = config;

    this.exchange = new PaperExchange({
      initialBalances: config.initialBalances,
      takerFeeRate: config.takerFeeRate,
      makerFeeRate: config.makerFeeRate,
      slippageRate: config.slippageRate,
    });

    this.feeds = config.feeds.map(
      (feedConfig) =>
        new PriceFeed(
          { ...feedConfig, tickIntervalMs: config.tickIntervalMs },
          feedConfig.regimeSchedule,
        ),
    );

    const startEquity = Object.values(config.initialBalances).reduce((a, b) => a + b, 0);
    this.perfTracker = new PerformanceTracker(config.name, startEquity);
  }

  /** Set the trading strategy */
  setStrategy(strategy: StrategyFn): void {
    this.strategy = strategy;
  }

  /** Run the sandbox synchronously (fast-forward mode for backtesting) */
  async runSync(): Promise<void> {
    await this.exchange.connect();
    this.running = true;
    this.stopped = false;

    const maxTicks = this.config.maxTicks || Infinity;

    while (this.tickCount < maxTicks && !this.stopped) {
      await this.processTick();
    }

    this.running = false;
    for (const feed of this.feeds) feed.stop();
    await this.exchange.disconnect();
  }

  /** Run the sandbox in real-time (each tick waits tickIntervalMs) */
  async run(): Promise<void> {
    await this.exchange.connect();
    this.running = true;
    this.stopped = false;

    const maxTicks = this.config.maxTicks || Infinity;

    while (this.tickCount < maxTicks && !this.stopped) {
      await this.processTick();
      await this.sleep(this.config.tickIntervalMs);
    }

    this.running = false;
    for (const feed of this.feeds) feed.stop();
    await this.exchange.disconnect();
  }

  /** Stop the sandbox */
  stop(): void {
    this.stopped = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Get the final performance report */
  getReport() {
    const fills = this.exchange.getFills();
    return this.perfTracker.generateReport(fills);
  }

  /** Get formatted report string */
  getFormattedReport(): string {
    return PerformanceTracker.formatReport(this.getReport());
  }

  getExchange(): PaperExchange {
    return this.exchange;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async processTick(): Promise<void> {
    this.tickCount++;

    // Generate new prices from all feeds
    const currentPrices: Record<string, number> = {};
    for (const feed of this.feeds) {
      const ticker = feed.tick();
      this.exchange.feedTicker(ticker);
      currentPrices[ticker.symbol] = ticker.price;

      // Maintain history
      let history = this.tickerHistory.get(ticker.symbol);
      if (!history) {
        history = [];
        this.tickerHistory.set(ticker.symbol, history);
      }
      history.push(ticker);
      if (history.length > SandboxRunner.MAX_HISTORY) {
        history.shift();
      }

      // Run strategy for this symbol
      if (this.strategy) {
        await this.runStrategy(ticker);
      }
    }

    // Record performance at reporting intervals
    if (this.tickCount % this.config.reportIntervalTicks === 0) {
      const balances = await this.exchange.getBalances();
      const positions = await this.exchange.getPositions();
      const regime = this.feeds[0]?.getCurrentRegime() ?? "unknown";
      this.perfTracker.recordSnapshot(this.tickCount, balances, positions, regime, currentPrices);

      // Log progress
      const equity = balances.reduce((sum, b) => {
        if (b.asset === "USDT") return sum + b.total;
        const price = currentPrices[`${b.asset}/USDT`] ?? 0;
        return sum + b.total * price;
      }, 0);
      console.log(
        `[tick ${this.tickCount}] regime=${regime} equity=$${equity.toFixed(2)} trades=${this.exchange.getFills().length}`,
      );
    }
  }

  private async runStrategy(ticker: Ticker): Promise<void> {
    if (!this.strategy) return;

    try {
      const [balances, positions, openOrders] = await Promise.all([
        this.exchange.getBalances(),
        this.exchange.getPositions(),
        this.exchange.getOpenOrders(ticker.symbol),
      ]);

      const history = this.tickerHistory.get(ticker.symbol) ?? [];

      const orders = this.strategy({
        ticker,
        history,
        balances,
        positions,
        openOrders,
        tick: this.tickCount,
      });

      for (const order of orders) {
        try {
          await this.exchange.placeOrder(order);
        } catch (err) {
          // Log but don't crash on order failures
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[tick ${this.tickCount}] Order failed: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tick ${this.tickCount}] Strategy error: ${msg}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
