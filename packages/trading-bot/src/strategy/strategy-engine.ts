/**
 * Strategy Engine
 *
 * Manages strategy lifecycle, routes market data to registered strategies,
 * and emits signals for the execution layer to act on.
 *
 * Usage:
 *   const engine = new StrategyEngine(connector);
 *   engine.register(new MomentumStrategy(config));
 *   engine.on(event => { if (event.type === 'signal') executeOrder(event.signal); });
 *   await engine.start();
 */

import type { ExchangeConnector, Ticker, Candle, Position, Balance, ConnectorEvent } from "../exchange/types.js";
import type { Strategy, StrategyFactory, StrategyConfig, MarketSnapshot, Signal, StrategyEngineEvent, StrategyEngineEventHandler } from "./types.js";

// ─── Candle Buffer ──────────────────────────────────────────────────

class CandleBuffer {
  private candles = new Map<string, Candle[]>();
  private readonly maxLength: number;

  constructor(maxLength = 200) {
    this.maxLength = maxLength;
  }

  push(symbol: string, candle: Candle): void {
    let buf = this.candles.get(symbol);
    if (!buf) {
      buf = [];
      this.candles.set(symbol, buf);
    }
    // Only store closed candles; update last if still forming
    if (candle.isClosed) {
      buf.push(candle);
      if (buf.length > this.maxLength) buf.shift();
    }
  }

  get(symbol: string): Candle[] {
    return this.candles.get(symbol) ?? [];
  }
}

// ─── Engine ─────────────────────────────────────────────────────────

export class StrategyEngine {
  private strategies = new Map<string, Strategy>();
  private factories = new Map<string, StrategyFactory>();
  private handlers: StrategyEngineEventHandler[] = [];
  private candleBuffer = new CandleBuffer(200);
  private running = false;
  private connectorHandler: ((event: ConnectorEvent) => void) | null = null;
  private cachedPositions: Position[] = [];
  private cachedBalances: Balance[] = [];
  private autoExecute = false;
  private maxPositionSize = 0.1; // 10% of portfolio per trade
  private confidenceThreshold = 0.3; // minimum signal strength to execute

  constructor(private readonly connector: ExchangeConnector) {}

  /**
   * Enable auto-execution: signals above confidence threshold are
   * automatically converted to orders on the connector.
   */
  enableAutoExecute(opts?: { maxPositionSize?: number; confidenceThreshold?: number }): void {
    this.autoExecute = true;
    if (opts?.maxPositionSize !== undefined) this.maxPositionSize = opts.maxPositionSize;
    if (opts?.confidenceThreshold !== undefined) this.confidenceThreshold = opts.confidenceThreshold;
  }

  disableAutoExecute(): void {
    this.autoExecute = false;
  }

  // ─── Strategy Registration ──────────────────────────────────────────

  /** Register a strategy factory by name, for dynamic instantiation */
  registerFactory(name: string, factory: StrategyFactory): void {
    this.factories.set(name, factory);
  }

  /** Register and initialize a strategy instance */
  async register(strategy: Strategy): Promise<void> {
    if (this.strategies.has(strategy.config.id)) {
      throw new Error(`Strategy ${strategy.config.id} already registered`);
    }
    await strategy.initialize();
    this.strategies.set(strategy.config.id, strategy);
    this.emit({ type: "strategy_added", strategyId: strategy.config.id, name: strategy.name });
  }

  /** Create a strategy from a registered factory and add it */
  async createAndRegister(name: string, config: StrategyConfig): Promise<Strategy> {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`No factory registered for strategy: ${name}`);
    const strategy = factory(config);
    await this.register(strategy);
    return strategy;
  }

  /** Remove a strategy by ID */
  remove(strategyId: string): boolean {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return false;
    strategy.destroy();
    this.strategies.delete(strategyId);
    this.emit({ type: "strategy_removed", strategyId });
    return true;
  }

  /** Get all registered strategy IDs */
  getStrategyIds(): string[] {
    return [...this.strategies.keys()];
  }

  /** Get a strategy by ID */
  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /** Start listening to connector events and routing to strategies */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.connectorHandler = (event: ConnectorEvent) => {
      if (event.type === "market_data") {
        if (event.event.type === "ticker") {
          this.onTicker(event.event.data);
        } else if (event.event.type === "candle") {
          this.candleBuffer.push(event.event.symbol, event.event.data);
        }
      }
    };

    this.connector.on(this.connectorHandler);
  }

  /** Stop listening to events */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.connectorHandler) {
      this.connector.off(this.connectorHandler);
      this.connectorHandler = null;
    }
  }

  /** Destroy all strategies and stop */
  async destroy(): Promise<void> {
    this.stop();
    for (const [id, strategy] of this.strategies) {
      strategy.destroy();
      this.emit({ type: "strategy_removed", strategyId: id });
    }
    this.strategies.clear();
  }

  /** Manually feed a ticker — async version for general use */
  async feedTicker(ticker: Ticker): Promise<Signal[]> {
    return this.onTicker(ticker);
  }

  /** Synchronous ticker feed for sandbox/bridge use (skips auto-execution) */
  feedTickerSync(ticker: Ticker): Signal[] {
    const signals: Signal[] = [];
    for (const [id, strategy] of this.strategies) {
      if (!strategy.config.symbols.includes(ticker.symbol)) continue;
      try {
        const snapshot = this.buildSnapshot(ticker);
        const signal = strategy.evaluate(snapshot);
        if (signal.action !== "hold") {
          signals.push(signal);
          this.emit({ type: "signal", strategyId: id, signal });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: "error", strategyId: id, message });
      }
    }
    return signals;
  }

  // ─── Events ─────────────────────────────────────────────────────────

  on(handler: StrategyEngineEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: StrategyEngineEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  // ─── Core Loop ──────────────────────────────────────────────────────

  private onTicker(ticker: Ticker): Signal[] {
    const signals: Signal[] = [];

    for (const [id, strategy] of this.strategies) {
      // Only route tickers to strategies that care about this symbol
      if (!strategy.config.symbols.includes(ticker.symbol)) continue;

      try {
        const snapshot = this.buildSnapshot(ticker);
        const signal = strategy.evaluate(snapshot);

        if (signal.action !== "hold") {
          signals.push(signal);
          this.emit({ type: "signal", strategyId: id, signal });

          if (this.autoExecute && signal.strength >= this.confidenceThreshold) {
            this.executeSignal(id, signal, ticker).catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              this.emit({ type: "error", strategyId: id, message: `execution failed: ${msg}` });
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: "error", strategyId: id, message });
      }
    }

    return signals;
  }

  private buildSnapshot(ticker: Ticker): MarketSnapshot {
    return {
      symbol: ticker.symbol,
      ticker,
      candles: this.candleBuffer.get(ticker.symbol),
      positions: this.cachedPositions,
      balances: this.cachedBalances,
      timestamp: Date.now(),
    };
  }

  /**
   * Convert a signal into an order on the connector.
   * Position size is calculated as a fraction of available quote balance.
   */
  private async executeSignal(strategyId: string, signal: Signal, ticker: Ticker): Promise<void> {
    if (signal.action === "hold") return;

    const [base, quote] = signal.symbol.split("/");
    const balances = this.cachedBalances;
    const quoteBalance = balances.find((b) => b.asset === quote);

    if (signal.action === "buy") {
      if (!quoteBalance || quoteBalance.free <= 0) return;
      const allocAmount = quoteBalance.free * this.maxPositionSize * signal.strength;
      const quantity = allocAmount / ticker.price;
      if (quantity <= 0) return;
      await this.connector.placeOrder({
        symbol: signal.symbol,
        side: "buy",
        type: "market",
        quantity,
      });
    } else if (signal.action === "sell") {
      const baseBalance = balances.find((b) => b.asset === base);
      if (!baseBalance || baseBalance.free <= 0) return;
      const quantity = baseBalance.free * signal.strength;
      if (quantity <= 0) return;
      await this.connector.placeOrder({
        symbol: signal.symbol,
        side: "sell",
        type: "market",
        quantity,
      });
    }
  }

  /**
   * Refresh cached positions and balances from the connector.
   * Call this before a tick cycle or on a timer.
   */
  async refreshAccountState(): Promise<void> {
    try {
      const [positions, balances] = await Promise.all([
        this.connector.getPositions(),
        this.connector.getBalances(),
      ]);
      this.cachedPositions = positions;
      this.cachedBalances = balances;
    } catch {
      // Keep stale cache rather than crashing
    }
  }

  private emit(event: StrategyEngineEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors crash the engine
      }
    }
  }
}
