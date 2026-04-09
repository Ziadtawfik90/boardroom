/**
 * Connector Factory
 *
 * Creates exchange connectors by exchange ID.
 * Manages lifecycle and aggregate health.
 */

import { BinanceConnector } from "./binance-connector.js";
import { KrakenConnector } from "./kraken-connector.js";
import type {
  ExchangeConnector,
  ExchangeConnectorConfig,
  ConnectorHealth,
} from "./types.js";

const DEFAULT_CONFIG: Omit<ExchangeConnectorConfig, "exchange" | "credentials" | "sandbox"> = {
  rateLimits: {
    maxRequestsPerSecond: 10,
    maxOrdersPerSecond: 5,
  },
  websocket: {
    reconnectBackoffMs: 1000,
    reconnectMaxMs: 60_000,
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 10_000,
  },
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
  },
};

export function createConnector(config: Partial<ExchangeConnectorConfig> & { exchange: ExchangeConnectorConfig["exchange"] }): ExchangeConnector {
  const merged: ExchangeConnectorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    rateLimits: { ...DEFAULT_CONFIG.rateLimits, ...config.rateLimits },
    websocket: { ...DEFAULT_CONFIG.websocket, ...config.websocket },
    retry: { ...DEFAULT_CONFIG.retry, ...config.retry },
  };

  switch (merged.exchange) {
    case "binance":
      return new BinanceConnector(merged);
    case "kraken":
      return new KrakenConnector(merged);
    case "paper":
      throw new Error("Paper connector not yet implemented — coming in phase 2");
    default:
      throw new Error(`Unknown exchange: ${merged.exchange}`);
  }
}

/**
 * Aggregate health across multiple connectors.
 */
export function aggregateHealth(connectors: ExchangeConnector[]): ConnectorHealth[] {
  return connectors.map((c) => c.health());
}
