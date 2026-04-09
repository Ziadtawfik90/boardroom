# Exchange API Connector Architecture

## Overview

A modular, exchange-agnostic connector layer that abstracts exchange-specific APIs behind a unified interface. Supports both REST (for order management, account info) and WebSocket (for real-time market data) connections. Initial targets: **Binance** and **Kraken**.

## Design Principles

1. **Exchange-agnostic interface** — All strategies interact through a common `ExchangeConnector` interface, never directly with exchange APIs.
2. **Rate limiting built-in** — Each connector enforces exchange-specific rate limits using a token bucket algorithm. Requests that would exceed limits are queued, not dropped.
3. **Resilient connections** — WebSocket connections auto-reconnect with exponential backoff. REST calls retry on transient errors (5xx, timeouts) with configurable retry policy.
4. **Paper trading parity** — A `PaperExchangeConnector` implements the same interface with simulated fills, enabling risk-free strategy validation.
5. **Observable** — Every API call, WebSocket message, reconnect, and rate-limit event is emitted as a structured log event for the audit trail.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Strategy Layer                     │
│         (consumes unified market data +              │
│          submits orders via interface)                │
└──────────────────────┬──────────────────────────────┘
                       │ ExchangeConnector interface
┌──────────────────────▼──────────────────────────────┐
│              Connector Router                         │
│    (selects connector by exchange ID,                │
│     manages lifecycle, health checks)                │
└───┬──────────────┬──────────────┬───────────────────┘
    │              │              │
    ▼              ▼              ▼
┌────────┐  ┌────────────┐  ┌─────────────┐
│Binance │  │  Kraken     │  │   Paper     │
│Connector│  │ Connector  │  │ Connector   │
└───┬────┘  └─────┬──────┘  └──────┬──────┘
    │             │                │
    ▼             ▼                ▼
┌────────┐  ┌──────────┐   ┌───────────┐
│Binance │  │ Kraken   │   │ Simulated │
│REST+WS │  │ REST+WS  │   │ Order Book│
│  APIs  │  │  APIs    │   │           │
└────────┘  └──────────┘   └───────────┘
```

## Core Components

### 1. ExchangeConnector (Interface)

The primary contract. Every exchange implementation must provide:

- **Market Data** — Subscribe/unsubscribe to real-time price feeds (candles, ticker, order book depth).
- **Order Management** — Place, cancel, and query orders. Supports market and limit orders.
- **Account Info** — Query balances, open positions, trade history.
- **Health** — Connection status, latency metrics, rate limit headroom.

See `src/exchange/types.ts` for the full TypeScript interface.

### 2. Rate Limiter

Each connector wraps its HTTP client with a rate limiter configured per exchange rules:

| Exchange | Request Weight Limit      | Order Limit         |
|----------|--------------------------|---------------------|
| Binance  | 6000 weight / 5 min      | 10 orders / sec     |
| Kraken   | 15 calls / sec (tier 1)  | Varies by tier      |

Implementation: Token bucket with sliding window. When tokens are exhausted, requests queue with a max wait time (default 30s) before rejecting.

### 3. WebSocket Manager

Handles real-time data streams:

- **Connection lifecycle** — Connect, authenticate (if needed), subscribe to channels.
- **Auto-reconnect** — On disconnect: exponential backoff starting at 1s, max 60s, with jitter.
- **Heartbeat** — Periodic ping/pong to detect stale connections. If no pong in 10s, force reconnect.
- **Message normalization** — Raw exchange messages are parsed into unified `MarketDataEvent` types before emission.

### 4. Paper Exchange Connector

Implements `ExchangeConnector` with simulated execution:

- Consumes real market data (from a live connector or historical replay).
- Simulates order fills using last traded price (market orders) or limit price matching against the book.
- Tracks virtual balances, positions, and P&L.
- Introduces configurable simulated latency and slippage.

### 5. Connector Router

Factory/registry that:

- Instantiates connectors by exchange ID string (e.g., `"binance"`, `"kraken"`, `"paper"`).
- Manages connection lifecycle (connect/disconnect/reconnect).
- Exposes aggregate health status across all active connectors.

## Error Handling Strategy

| Error Class          | Handling                                       |
|---------------------|------------------------------------------------|
| Rate limit (429)     | Queue request, wait for token refill           |
| Transient (5xx)      | Retry up to 3x with exponential backoff        |
| Auth failure (401)   | Emit critical event, halt trading, notify       |
| Network timeout      | Retry once, then mark connector unhealthy       |
| Invalid order (400)  | Do not retry — emit error event with details    |
| WebSocket disconnect | Auto-reconnect with backoff, re-subscribe       |

## Configuration

Each connector is configured via a typed config object:

```typescript
{
  exchange: "binance",
  credentials: {
    apiKey: "...",      // from env vars, never hardcoded
    apiSecret: "..."
  },
  rateLimits: {
    maxRequestsPerSecond: 10,
    maxOrdersPerSecond: 5
  },
  websocket: {
    reconnectBackoffMs: 1000,
    reconnectMaxMs: 60000,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000
  },
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000
  }
}
```

## Data Flow: Market Data Ingestion

```
Exchange WS → Raw Message → Normalize → MarketDataEvent → EventEmitter
                                              │
                                    ┌─────────┴──────────┐
                                    │                    │
                              Strategy Engine      Data Logger
                              (live signals)     (persistent store)
```

## Data Flow: Order Execution

```
Strategy → OrderRequest → Validate → Rate Limit Check → Exchange REST API
                                                              │
                                                         OrderResponse
                                                              │
                                                    ┌─────────┴──────────┐
                                                    │                    │
                                              Position Tracker     Audit Logger
```

## Exchange-Specific API Mappings

### Binance

**Base URLs:**
- REST (live): `https://api.binance.com`
- REST (testnet): `https://testnet.binance.vision`
- WebSocket (live): `wss://stream.binance.com:9443/ws`
- WebSocket (testnet): `wss://testnet.binance.vision/ws`

**Authentication:**
- REST requests signed with HMAC-SHA256 of query string using `apiSecret`
- `X-MBX-APIKEY` header carries the `apiKey`
- Timestamp parameter required; reject window ±5000ms (configurable via `recvWindow`)
- WebSocket streams are unauthenticated for market data; user data streams require a `listenKey` obtained via `POST /api/v3/userDataStream` (keep-alive every 30 min)

**Rate Limits (enforced server-side):**
- Request weight: 6000 per 5 minutes (each endpoint has a weight; e.g., `GET /api/v3/klines` = weight 2)
- Order rate: 10 orders/sec, 200,000 orders/day
- Response headers `X-MBX-USED-WEIGHT-*` report current usage — the connector must read these and sync local token bucket

**Key REST Endpoints → Interface Mapping:**

| Interface Method   | Binance Endpoint                     | Weight |
|--------------------|--------------------------------------|--------|
| `getCandles()`     | `GET /api/v3/klines`                 | 2      |
| `getTicker()`      | `GET /api/v3/ticker/price`           | 2      |
| `getOrderBook()`   | `GET /api/v3/depth`                  | 5-50   |
| `placeOrder()`     | `POST /api/v3/order`                 | 1      |
| `cancelOrder()`    | `DELETE /api/v3/order`               | 1      |
| `getOrder()`       | `GET /api/v3/order`                  | 4      |
| `getOpenOrders()`  | `GET /api/v3/openOrders`             | 6-40   |
| `getBalances()`    | `GET /api/v3/account`                | 20     |

**WebSocket Streams:**
- Kline: `<symbol>@kline_<interval>` (e.g., `btcusdt@kline_1m`)
- Ticker: `<symbol>@ticker`
- Depth: `<symbol>@depth<levels>@100ms` (levels: 5, 10, 20)
- Combined streams via `wss://stream.binance.com:9443/stream?streams=<stream1>/<stream2>`

**Message Normalization (Binance → unified types):**

```typescript
// Binance kline → Candle
{
  timestamp: msg.k.t,        // kline start time
  open: parseFloat(msg.k.o),
  high: parseFloat(msg.k.h),
  low: parseFloat(msg.k.l),
  close: parseFloat(msg.k.c),
  volume: parseFloat(msg.k.v),
  quoteVolume: parseFloat(msg.k.q),
  trades: msg.k.n,
  isClosed: msg.k.x
}
```

---

### Kraken

**Base URLs:**
- REST: `https://api.kraken.com`
- WebSocket (public): `wss://ws.kraken.com/v2`
- WebSocket (private): `wss://ws-auth.kraken.com/v2`

**Authentication:**
- REST: `API-Key` header + `API-Sign` header (HMAC-SHA512 of nonce + POST data, keyed with base64-decoded `apiSecret`)
- Nonce must be strictly increasing (use microsecond timestamp)
- WebSocket private: obtain a token via `POST /0/private/GetWebSocketsToken`, pass in subscribe message

**Rate Limits:**
- Tier-based: Starter = 15 calls/min, Intermediate = 20/min, Pro = 20/min with higher burst
- Matching engine rate limit: separate per-pair order rate
- No rate-limit headers — must track locally based on tier config

**Key REST Endpoints → Interface Mapping:**

| Interface Method   | Kraken Endpoint                  | Notes                    |
|--------------------|----------------------------------|--------------------------|
| `getCandles()`     | `GET /0/public/OHLC`            | Max 720 candles          |
| `getTicker()`      | `GET /0/public/Ticker`          |                          |
| `getOrderBook()`   | `GET /0/public/Depth`           | Max 500 levels           |
| `placeOrder()`     | `POST /0/private/AddOrder`      |                          |
| `cancelOrder()`    | `POST /0/private/CancelOrder`   |                          |
| `getOrder()`       | `POST /0/private/QueryOrders`   |                          |
| `getOpenOrders()`  | `POST /0/private/OpenOrders`    |                          |
| `getBalances()`    | `POST /0/private/Balance`       |                          |

**Symbol Mapping:**
Kraken uses non-standard pair names (e.g., `XXBTZUSD` for BTC/USD, `XETHZUSD` for ETH/USD). The connector must maintain a symbol mapping table loaded at connect time via `GET /0/public/AssetPairs`.

**WebSocket Subscriptions (v2 API):**
```json
{
  "method": "subscribe",
  "params": {
    "channel": "ohlc",
    "symbol": ["BTC/USD"],
    "interval": 1
  }
}
```

Channels: `ohlc`, `ticker`, `book` (with depth param).

---

## WebSocket Protocol Details

### Connection State Machine

```
DISCONNECTED → CONNECTING → CONNECTED → SUBSCRIBING → ACTIVE
     ↑              │            │                        │
     │              │            │                        │
     └──────────────┴────────────┴── on error/close ──────┘
                         │
                    RECONNECTING (backoff)
```

### Reconnection Algorithm

```
delay = min(baseDelay * 2^attempt + jitter, maxDelay)
jitter = random(0, baseDelay * 0.5)
```

On reconnect:
1. Re-establish WebSocket connection
2. Re-authenticate (if private channel)
3. Re-subscribe to all previously active subscriptions
4. Emit `reconnecting` event with attempt count
5. On success, emit `connected` event and reset attempt counter
6. Request snapshot for order book channels to avoid stale state

### Heartbeat Protocol

- **Binance**: Server sends ping frames; client must respond with pong within 10 minutes or connection is dropped. Additionally, the connector sends application-level pings every 30s to detect stale connections early.
- **Kraken v2**: Server sends `heartbeat` messages every ~30s. If none received within 60s, assume stale and reconnect.

### Message Ordering Guarantees

- WebSocket messages may arrive out of order during high volatility
- Candle updates: use `timestamp` field to discard stale updates
- Order book updates: Binance provides `lastUpdateId` — apply updates sequentially, request snapshot if gap detected
- Order updates: use `updatedAt` timestamp; ignore updates older than last known state

---

## Security Considerations

1. **Credentials** — Never stored in code or config files. Loaded exclusively from environment variables (`BINANCE_API_KEY`, `BINANCE_API_SECRET`, `KRAKEN_API_KEY`, `KRAKEN_API_SECRET`).
2. **API Key Permissions** — Keys should be created with minimum required permissions: read market data + spot trading only. No withdrawal permissions. IP whitelist recommended.
3. **Request Signing** — Signature computation happens in-memory; secrets are never logged or serialized.
4. **Testnet First** — All development and paper trading uses exchange testnet URLs. Live URLs are only activated via explicit `sandbox: false` config.
5. **Kill Switch** — The `ConnectorRouter` exposes an `emergencyDisconnectAll()` method that cancels all open orders and disconnects all connectors within 1 second.

---

## Testing Strategy

### Unit Tests
- Rate limiter: token refill timing, queue ordering, deadline expiry, weighted requests
- Message normalization: Binance raw → unified type mapping, Kraken raw → unified type mapping
- Symbol mapping: Kraken non-standard pairs resolve correctly

### Integration Tests (against testnet)
- REST: place/cancel/query order lifecycle on Binance testnet
- WebSocket: subscribe to kline stream, receive and parse ≥1 candle
- Reconnection: force-close WebSocket, verify auto-reconnect and re-subscribe
- Rate limiting: burst requests beyond limit, verify queuing (not rejection)

### Paper Connector Tests
- Simulated market order fills at last price ± slippage
- Limit order matching against simulated book
- Balance tracking through buy/sell cycle
- Position P&L calculation accuracy

---

## Phase 1 Scope (Week 1)

- [x] Define TypeScript interfaces (`ExchangeConnector`, all data types)
- [x] Implement rate limiter utility
- [ ] Implement Binance REST connector (market data + order placement)
- [ ] Implement Binance WebSocket connector (kline/candle streams)
- [ ] Implement Paper connector
- [ ] Unit tests for rate limiter and message normalization
- [ ] Binance message normalizers (kline, ticker, depth → unified types)
- [ ] Kraken symbol mapping table loader
