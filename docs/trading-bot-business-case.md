# Crypto Trading Bot — Business Case & Risk Expectations

**Date:** 2026-04-09
**Status:** Pre-development
**Author:** ASUS (The Builder), Boardroom Agent

---

## Executive Summary

This document sets realistic expectations for a retail crypto trading bot project. The primary goal is **learning and skill development**, not guaranteed profit. Most retail trading bots underperform a simple buy-and-hold strategy after accounting for fees, slippage, and market regime changes. This project should be approached as a technical education investment with a small chance of generating modest returns.

---

## 1. Realistic Return Expectations

### What the data says

- **70–90% of retail algorithmic traders lose money** over a 12-month horizon (various academic studies and broker disclosures).
- Simple momentum/mean-reversion strategies on crypto typically yield **0–15% annualized returns before fees** during favorable regimes — and **negative returns during unfavorable regimes**.
- After transaction fees, slippage, and infrastructure costs, the **break-even bar is significantly higher** than most beginners expect.

### Honest projections for this bot

| Scenario | Probability | Annual Return (after fees) |
|---|---|---|
| Strategy loses money | ~50–60% | -5% to -30% |
| Strategy breaks even (±2%) | ~15–20% | -2% to +2% |
| Strategy modestly profitable | ~15–20% | +2% to +15% |
| Strategy significantly profitable | ~5–10% | +15%+ |

> **Bottom line:** Expect to lose money in the first 6–12 months. Budget accordingly.

---

## 2. Fee & Slippage Impact

### Exchange fees

| Exchange | Maker Fee | Taker Fee | Notes |
|---|---|---|---|
| Binance | 0.10% | 0.10% | Discounts with BNB; tiered by volume |
| Kraken | 0.16% | 0.26% | Tiered by 30-day volume |

### Fee drag on high-frequency strategies

- A strategy executing **10 trades/day** at 0.10% per trade accumulates **~1% fee drag per day**, or **~365% annualized**.
- Even **2 trades/day** at 0.10% = ~73% annualized fee drag.
- **Conclusion:** High-frequency approaches are unviable for retail. Strategies must trade infrequently (1–5 trades/week) or have very high win rates to overcome fees.

### Slippage

- On liquid pairs (BTC/USDT, ETH/USDT), slippage is typically **0.01–0.05%** for small orders (<$10k).
- On illiquid pairs or during volatility spikes, slippage can exceed **0.5–2%**.
- **Rule:** Only trade top-10 market cap pairs on high-volume exchanges. Avoid illiquid markets entirely.

### Infrastructure costs

| Item | Monthly Cost |
|---|---|
| VPS/cloud server | $5–20 |
| Market data (if premium) | $0–50 |
| Exchange API access | Free |
| **Total baseline** | **$5–70/month** |

A portfolio under **$5,000** will struggle to generate returns that cover even minimal infrastructure costs.

---

## 3. Market Regime Risks

### The core problem

Crypto markets cycle through distinct regimes, and strategies that work in one regime fail in another:

| Regime | Characteristics | Typical strategy impact |
|---|---|---|
| **Bull trend** | Sustained upward movement, high momentum | Trend-following wins; mean-reversion loses |
| **Bear trend** | Sustained downward movement | Short strategies win (if available); most long-only bots lose |
| **Sideways/range** | Low volatility, mean-reverting | Mean-reversion wins; trend-following gets whipsawed |
| **High volatility/crash** | Sharp moves, liquidation cascades | Most strategies lose; stop-losses get gapped |

### Key risks

1. **Regime change is unpredictable.** A strategy backtested on 2024 bull market data will likely fail in a 2025 bear market.
2. **Overfitting to historical data.** The #1 mistake — a strategy that looks amazing on past data but captures noise, not signal.
3. **Black swan events.** Exchange hacks, regulatory bans, stablecoin depegs, and flash crashes can wipe out months of gains in minutes.
4. **Liquidity crises.** During market stress, order books thin out, spreads widen, and your bot executes at terrible prices.

---

## 4. Technical & Operational Risks

| Risk | Impact | Mitigation |
|---|---|---|
| API rate limiting/downtime | Missed trades, stale data | Exponential backoff, health checks, fallback logic |
| Exchange API changes | Bot breaks silently | Version pinning, integration tests, monitoring |
| Network latency | Stale prices, failed orders | Colocated servers or accept latency as a constraint |
| Bug in order logic | Double orders, wrong sizing | Paper trading phase, position limit kill switches |
| Database corruption | Lost trade history | WAL mode, regular backups, checksums |
| Key/credential leak | Funds stolen | API keys with withdrawal disabled, IP whitelisting |

---

## 5. Position Limits & Risk Controls (Mandatory)

These are **non-negotiable** before any live trading:

1. **Maximum position size:** No single trade >2% of portfolio.
2. **Maximum daily loss:** Bot halts if daily P&L drops below -3%.
3. **Maximum drawdown:** Bot halts permanently if portfolio drops >10% from peak.
4. **Kill switch:** Manual and automated emergency stop that cancels all open orders and closes positions.
5. **No leverage:** Leverage amplifies losses and liquidation risk. Start with spot only.
6. **Withdrawal-disabled API keys:** Exchange API keys must have withdrawal permissions disabled.
7. **IP whitelisting:** API keys restricted to known server IPs only.

---

## 6. Minimum Viable Budget

| Category | Minimum | Recommended |
|---|---|---|
| Trading capital (paper phase) | $0 | $0 |
| Trading capital (live phase) | $500 | $2,000–5,000 |
| Infrastructure (monthly) | $5 | $20 |
| Risk capital (money you can lose 100%) | = trading capital | = trading capital |

> **Rule:** Never trade with money you cannot afford to lose entirely. Treat the entire trading capital as a sunk cost for education.

---

## 7. Success Criteria & Go/No-Go Gates

### Phase 1: Backtesting (Weeks 1–2)

- **Go:** Strategy shows positive returns across ≥2 distinct market regimes with Sharpe ratio >1.0
- **No-go:** Strategy only works in one regime, or Sharpe <0.5 after fees

### Phase 2: Paper Trading (Weeks 3–6)

- **Go:** Paper results within 80% of backtest performance; no critical bugs; fills match expectations
- **No-go:** Paper results significantly worse than backtest (indicates overfitting)

### Phase 3: Live Trading (Week 7+)

- **Go:** Passed paper trading gate; all risk controls implemented and tested; capital allocated from risk budget only
- **No-go:** Any unresolved bugs; risk controls not verified; capital sourced from non-risk funds

---

## 8. The Honest Bottom Line

| Claim | Reality |
|---|---|
| "Trading bots print money" | Most lose money after fees |
| "Backtests prove the strategy works" | Backtests prove it worked on past data — not future data |
| "I'll start small and scale up" | Good instinct, but "small" must truly mean expendable |
| "Crypto is easy alpha" | Institutional market makers with sub-millisecond latency and PhD quant teams are your competition |
| "This time is different" | It never is |

### What you will gain regardless of P&L

- Deep understanding of exchange APIs, websockets, and real-time data
- Experience with event-driven architecture and async programming
- Practical knowledge of financial risk management
- Backtesting methodology and statistical thinking
- A portfolio project demonstrating systems engineering skills

**The education is the guaranteed return. The trading profits are not.**

---

## Appendix: Recommended Reading

- *Advances in Financial Machine Learning* — Marcos López de Prado (on why most backtests are lies)
- *Algorithmic Trading* — Ernest Chan (practical retail quant strategies)
- Exchange API documentation: Binance API docs, Kraken API docs
- OWASP API Security guidelines (for key management)
