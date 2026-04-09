/**
 * Base Exchange Connector
 *
 * Shared logic for all exchange implementations: event emitter,
 * rate limiting, retry with exponential backoff, health tracking.
 */

import { RateLimiter } from "./rate-limiter.js";
import type {
  Exchange,
  ExchangeConnectorConfig,
  ConnectorEvent,
  ConnectorEventHandler,
  ConnectorHealth,
  ConnectionStatus,
  RetryConfig,
} from "./types.js";

export abstract class BaseConnector {
  readonly exchange: Exchange;
  protected readonly config: ExchangeConnectorConfig;
  protected readonly restLimiter: RateLimiter;
  protected readonly orderLimiter: RateLimiter;
  protected status: ConnectionStatus = "disconnected";
  protected wsConnected = false;
  protected lastHeartbeat: number | null = null;
  protected restLatencyMs: number | null = null;
  protected errors24h = 0;
  private handlers: ConnectorEventHandler[] = [];
  private errorResetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ExchangeConnectorConfig) {
    this.exchange = config.exchange;
    this.config = config;
    this.restLimiter = new RateLimiter({
      maxTokens: config.rateLimits.maxRequestsPerSecond,
      refillRate: config.rateLimits.maxRequestsPerSecond,
    });
    this.orderLimiter = new RateLimiter({
      maxTokens: config.rateLimits.maxOrdersPerSecond,
      refillRate: config.rateLimits.maxOrdersPerSecond,
    });

    // Reset error counter every 24h
    this.errorResetTimer = setInterval(() => {
      this.errors24h = 0;
    }, 86_400_000);
  }

  health(): ConnectorHealth {
    return {
      exchange: this.exchange,
      status: this.status,
      restLatencyMs: this.restLatencyMs,
      wsConnected: this.wsConnected,
      rateLimitRemaining: this.restLimiter.remainingPercent,
      lastHeartbeat: this.lastHeartbeat,
      errors24h: this.errors24h,
    };
  }

  on(handler: ConnectorEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: ConnectorEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  protected emit(event: ConnectorEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Don't let a broken handler crash the connector
      }
    }
  }

  protected recordError(message: string, code?: string): void {
    this.errors24h++;
    this.emit({ type: "error", exchange: this.exchange, message, code });
  }

  /**
   * Retry a function with exponential backoff + jitter.
   * Only retries on transient errors (5xx, network).
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> {
    const { maxRetries, baseDelayMs, maxDelayMs } = this.config.retry;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        const isLast = attempt === maxRetries;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (isLast || !this.isRetryable(err)) {
          this.recordError(`${label} failed: ${errMsg}`);
          throw err;
        }

        const delay = Math.min(
          baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs,
          maxDelayMs,
        );
        await sleep(delay);
      }
    }

    throw new Error("unreachable");
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      // Retry on network errors and 5xx
      if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("enotfound")) return true;
      if (msg.includes("fetch failed") || msg.includes("network")) return true;
      if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    }
    return false;
  }

  protected destroyBase(): void {
    if (this.errorResetTimer) {
      clearInterval(this.errorResetTimer);
      this.errorResetTimer = null;
    }
    this.restLimiter.destroy();
    this.orderLimiter.destroy();
    this.handlers = [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
