/**
 * Connector Router
 *
 * Factory/registry for exchange connectors. Instantiates connectors by
 * exchange ID, manages lifecycle, and exposes aggregate health.
 */

import { BinanceConnector } from "./binance-connector.js";
import { KrakenConnector } from "./kraken-connector.js";
import type {
  Exchange,
  ExchangeConnector,
  ExchangeConnectorConfig,
  ConnectorHealth,
} from "./types.js";

const DEFAULT_CONFIG: Omit<ExchangeConnectorConfig, "exchange" | "credentials"> = {
  rateLimits: { maxRequestsPerSecond: 10, maxOrdersPerSecond: 5 },
  websocket: {
    reconnectBackoffMs: 1000,
    reconnectMaxMs: 60_000,
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 10_000,
  },
  retry: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10_000 },
};

export class ConnectorRouter {
  private connectors = new Map<Exchange, ExchangeConnector>();

  /**
   * Create and register a connector for the given exchange.
   * Returns the connector instance for immediate use.
   */
  create(config: ExchangeConnectorConfig): ExchangeConnector {
    if (this.connectors.has(config.exchange)) {
      throw new Error(`Connector for ${config.exchange} already registered. Disconnect first.`);
    }

    const merged = { ...DEFAULT_CONFIG, ...config };
    let connector: ExchangeConnector;

    switch (config.exchange) {
      case "binance":
        connector = new BinanceConnector(merged);
        break;
      case "kraken":
        connector = new KrakenConnector(merged);
        break;
      case "paper":
        throw new Error("Paper connector should be created via PaperConnector directly");
      default:
        throw new Error(`Unknown exchange: ${config.exchange}`);
    }

    this.connectors.set(config.exchange, connector);
    return connector;
  }

  get(exchange: Exchange): ExchangeConnector | undefined {
    return this.connectors.get(exchange);
  }

  async connectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.connectors.values()).map((c) => c.connect()),
    );
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.connectors.values()).map((c) => c.disconnect()),
    );
    this.connectors.clear();
  }

  healthAll(): ConnectorHealth[] {
    return Array.from(this.connectors.values()).map((c) => c.health());
  }
}
