/**
 * Data Pipeline — Orchestrates ingestion from exchange connectors
 * into the DataStore and triggers feature computation.
 *
 * Connects to one or more ExchangeConnectors, subscribes to market
 * data, normalizes incoming candles/tickers, stores them, and emits
 * FeatureVectors for downstream strategy/ML consumption.
 */

import type {
  ExchangeConnector,
  ConnectorEvent,
  TimeFrame,
  Candle,
  MarketDataSubscription,
} from "../exchange/types.js";
import type {
  PipelineConfig,
  PipelineEvent,
  PipelineEventHandler,
  FeatureVector,
} from "./types.js";
import { DEFAULT_PIPELINE_CONFIG } from "./types.js";
import { DataStore } from "./data-store.js";
import { FeatureEngine } from "./feature-engine.js";

export class DataPipeline {
  private store: DataStore;
  private featureEngine: FeatureEngine;
  private config: PipelineConfig;
  private connectors: ExchangeConnector[] = [];
  private handlers: PipelineEventHandler[] = [];
  private running = false;
  private recomputeTimer: ReturnType<typeof setInterval> | null = null;

  /** Latest feature vectors keyed by "exchange:symbol:timeframe" */
  private latestFeatures = new Map<string, FeatureVector>();

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.store = new DataStore(this.config.buffer);
    this.featureEngine = new FeatureEngine(this.config.indicators);
  }

  // ─── Connector Management ───────────────────────────────────────

  /** Register an exchange connector. Call before start(). */
  addConnector(connector: ExchangeConnector): void {
    this.connectors.push(connector);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /** Start ingestion: connect to exchanges, load history, subscribe to live data */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const connector of this.connectors) {
      // Wire up event handler
      connector.on(this.handleConnectorEvent.bind(this));

      // Connect
      await connector.connect();

      // Load historical candles for each symbol/timeframe
      await this.loadHistory(connector);

      // Subscribe to live data
      const subs: MarketDataSubscription[] = [];
      for (const symbol of this.config.symbols) {
        for (const timeframe of this.config.timeframes) {
          subs.push({ symbol, channels: ["candles", "ticker"], timeframe });
        }
      }
      await connector.subscribe(subs);
    }

    // Optional periodic recomputation
    if (this.config.recomputeIntervalMs > 0) {
      this.recomputeTimer = setInterval(() => this.recomputeAll(), this.config.recomputeIntervalMs);
    }
  }

  /** Stop ingestion and disconnect */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.recomputeTimer) {
      clearInterval(this.recomputeTimer);
      this.recomputeTimer = null;
    }

    for (const connector of this.connectors) {
      await connector.disconnect();
    }
  }

  // ─── History Loading ────────────────────────────────────────────

  private async loadHistory(connector: ExchangeConnector): Promise<void> {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        try {
          const candles = await connector.getCandles(symbol, timeframe, this.config.buffer.maxCandles);
          this.store.ingestCandles(connector.exchange, symbol, timeframe, candles);
          this.emit({
            type: "candle_ingested",
            symbol,
            timeframe,
            exchange: connector.exchange,
          });
        } catch (err) {
          this.emit({
            type: "error",
            message: `Failed to load history for ${symbol}/${timeframe}: ${err}`,
            source: "loadHistory",
          });
        }
      }
    }
  }

  // ─── Event Processing ───────────────────────────────────────────

  private handleConnectorEvent(event: ConnectorEvent): void {
    if (!this.running) return;

    if (event.type === "market_data") {
      const md = event.event;

      if (md.type === "candle" && md.data.isClosed) {
        this.store.ingestCandle(
          this.connectors[0]?.exchange ?? "paper", // TODO: tag events with exchange
          md.symbol,
          md.timeframe,
          md.data,
        );

        this.emit({ type: "candle_ingested", symbol: md.symbol, timeframe: md.timeframe, exchange: this.connectors[0]?.exchange ?? "paper" });

        // Recompute features on new closed candle if interval is 0
        if (this.config.recomputeIntervalMs === 0) {
          this.computeAndEmit(this.connectors[0]?.exchange ?? "paper", md.symbol, md.timeframe);
        }
      }

      if (md.type === "ticker") {
        const exchange = this.connectors[0]?.exchange ?? "paper";
        this.store.ingestTicker(exchange, md.data);
        this.emit({ type: "ticker_ingested", symbol: md.data.symbol, exchange });
      }
    }

    if (event.type === "error") {
      this.emit({ type: "error", message: event.message, source: `connector:${event.exchange}` });
    }
  }

  // ─── Feature Computation ────────────────────────────────────────

  private computeAndEmit(exchange: string, symbol: string, timeframe: TimeFrame): void {
    // Skip feature computation during warmup
    const candleCount = this.store.getCandleCount(exchange as any, symbol, timeframe);
    if (candleCount < this.config.warmupPeriod) return;

    const vector = this.featureEngine.compute(
      this.store,
      exchange as any,
      symbol,
      timeframe,
    );

    const key = `${exchange}:${symbol}:${timeframe}`;
    this.latestFeatures.set(key, vector);

    this.emit({ type: "features_computed", vector });
  }

  private recomputeAll(): void {
    for (const connector of this.connectors) {
      for (const symbol of this.config.symbols) {
        for (const timeframe of this.config.timeframes) {
          this.computeAndEmit(connector.exchange, symbol, timeframe);
        }
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────────────

  /** Get the latest computed feature vector */
  getFeatures(exchange: string, symbol: string, timeframe: TimeFrame): FeatureVector | undefined {
    return this.latestFeatures.get(`${exchange}:${symbol}:${timeframe}`);
  }

  /** Get all latest feature vectors */
  getAllFeatures(): FeatureVector[] {
    return Array.from(this.latestFeatures.values());
  }

  /** Direct access to the data store (for backtesting or custom queries) */
  getStore(): DataStore {
    return this.store;
  }

  /** Get feature names the engine will produce */
  getFeatureNames(): string[] {
    return this.featureEngine.getFeatureNames();
  }

  /** Force recompute features now */
  recompute(): void {
    this.recomputeAll();
  }

  /** Manually ingest candles (for backtesting without live connectors) */
  ingestCandles(exchange: string, symbol: string, timeframe: TimeFrame, candles: Candle[]): void {
    this.store.ingestCandles(exchange as any, symbol, timeframe, candles);
  }

  // ─── Events ─────────────────────────────────────────────────────

  on(handler: PipelineEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: PipelineEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  private emit(event: PipelineEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
