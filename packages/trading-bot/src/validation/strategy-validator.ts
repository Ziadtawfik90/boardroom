/**
 * Strategy Validator
 *
 * Runs baseline strategies through the paper trading engine with simulated
 * market data across varied conditions. Calculates key performance metrics:
 *   - Total return, annualized return
 *   - Sharpe ratio
 *   - Max drawdown
 *   - Win rate, profit factor
 *   - Trade count, avg trade duration
 *
 * Outputs a structured validation report for each strategy × scenario pair.
 */

import type { Ticker } from "../exchange/types.js";
import type { Signal } from "../strategies/types.js";
import { PaperExchange } from "../paper/paper-exchange.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ValidationConfig {
  /** Starting capital in quote asset */
  startCapital: number;
  /** Trade size in base asset per signal */
  tradeQuantity: number;
  /** Max portfolio fraction per trade */
  maxPositionPct: number;
  /** Symbol to trade */
  symbol: string;
}

export interface TradeRecord {
  entryTick: number;
  exitTick: number;
  entryPrice: number;
  exitPrice: number;
  side: "buy" | "sell";
  quantity: number;
  pnl: number;
  holdingPeriod: number; // in ticks
}

export interface ValidationResult {
  strategyName: string;
  scenarioName: string;
  /** Core metrics */
  totalReturn: number;          // fractional (0.05 = 5%)
  annualizedReturn: number;     // fractional
  sharpeRatio: number;
  maxDrawdown: number;          // fractional (0.15 = 15% drawdown)
  maxDrawdownDuration: number;  // ticks
  /** Trade metrics */
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;         // gross profit / gross loss
  avgWin: number;
  avgLoss: number;
  avgHoldingPeriod: number;
  /** Equity curve (sampled) */
  equityCurve: number[];
  /** Final portfolio value */
  finalEquity: number;
  startEquity: number;
  /** Price series stats */
  priceStart: number;
  priceEnd: number;
  buyAndHoldReturn: number;
  /** All trades */
  trades: TradeRecord[];
}

// ─── Signal-based Strategy Adapter ──────────────────────────────────────

export type SignalFn = (ticker: Ticker) => Signal;

/**
 * Run a strategy (as a signal function) through a simulated market scenario.
 */
export function validateStrategy(
  strategyName: string,
  scenarioName: string,
  signalFn: SignalFn,
  tickers: Ticker[],
  config: ValidationConfig,
): ValidationResult {
  const { startCapital, tradeQuantity, maxPositionPct, symbol } = config;

  // Track state
  let cashBalance = startCapital;
  let baseHolding = 0;
  const trades: TradeRecord[] = [];
  const equityCurve: number[] = [];
  let pendingEntry: { tick: number; price: number; quantity: number } | null = null;

  // Drawdown tracking
  let peakEquity = startCapital;
  let maxDrawdown = 0;
  let drawdownStart = 0;
  let maxDrawdownDuration = 0;
  let currentDrawdownStart = 0;
  let inDrawdown = false;

  // Per-tick returns for Sharpe
  const tickReturns: number[] = [];
  let prevEquity = startCapital;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const signal = signalFn(ticker);

    // Execute trades
    if (signal === "buy" && baseHolding === 0) {
      const maxSpend = cashBalance * maxPositionPct;
      const qty = Math.min(tradeQuantity, maxSpend / ticker.ask);
      if (qty > 0 && cashBalance >= qty * ticker.ask) {
        const cost = qty * ticker.ask * 1.001; // Include slippage+fee estimate
        cashBalance -= cost;
        baseHolding = qty;
        pendingEntry = { tick: i, price: ticker.ask, quantity: qty };
      }
    } else if (signal === "sell" && baseHolding > 0 && pendingEntry) {
      const revenue = baseHolding * ticker.bid * 0.999; // Include slippage+fee estimate
      cashBalance += revenue;
      const pnl = revenue - pendingEntry.quantity * pendingEntry.price * 1.001;
      trades.push({
        entryTick: pendingEntry.tick,
        exitTick: i,
        entryPrice: pendingEntry.price,
        exitPrice: ticker.bid,
        side: "buy",
        quantity: baseHolding,
        pnl,
        holdingPeriod: i - pendingEntry.tick,
      });
      baseHolding = 0;
      pendingEntry = null;
    }

    // Calculate equity
    const equity = cashBalance + baseHolding * ticker.price;
    equityCurve.push(equity);

    // Per-tick return
    if (prevEquity > 0) {
      tickReturns.push((equity - prevEquity) / prevEquity);
    }
    prevEquity = equity;

    // Drawdown
    if (equity > peakEquity) {
      peakEquity = equity;
      if (inDrawdown) {
        const duration = i - currentDrawdownStart;
        if (duration > maxDrawdownDuration) maxDrawdownDuration = duration;
        inDrawdown = false;
      }
    } else {
      const dd = (peakEquity - equity) / peakEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (!inDrawdown) {
        currentDrawdownStart = i;
        inDrawdown = true;
      }
    }
  }

  // Close any open position at end
  if (baseHolding > 0 && pendingEntry && tickers.length > 0) {
    const lastTicker = tickers[tickers.length - 1];
    const revenue = baseHolding * lastTicker.bid * 0.999;
    cashBalance += revenue;
    trades.push({
      entryTick: pendingEntry.tick,
      exitTick: tickers.length - 1,
      entryPrice: pendingEntry.price,
      exitPrice: lastTicker.bid,
      side: "buy",
      quantity: baseHolding,
      pnl: revenue - pendingEntry.quantity * pendingEntry.price * 1.001,
      holdingPeriod: tickers.length - 1 - pendingEntry.tick,
    });
    baseHolding = 0;
  }

  const finalEquity = cashBalance;
  const totalReturn = (finalEquity - startCapital) / startCapital;

  // Annualize: assume hourly ticks, ~8760 hours/year
  const hoursSimulated = tickers.length;
  const yearsSimulated = hoursSimulated / 8760;
  const annualizedReturn = yearsSimulated > 0
    ? Math.sign(1 + totalReturn) * (Math.abs(1 + totalReturn) ** (1 / yearsSimulated) - 1)
    : 0;

  // Sharpe ratio (annualized, hourly returns)
  const meanReturn = tickReturns.length > 0
    ? tickReturns.reduce((a, b) => a + b, 0) / tickReturns.length
    : 0;
  const returnVariance = tickReturns.length > 1
    ? tickReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (tickReturns.length - 1)
    : 0;
  const returnStdDev = Math.sqrt(returnVariance);
  const sharpeRatio = returnStdDev > 0
    ? (meanReturn / returnStdDev) * Math.sqrt(8760) // Annualize
    : 0;

  // Trade stats
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Buy and hold
  const priceStart = tickers[0]?.price ?? 0;
  const priceEnd = tickers[tickers.length - 1]?.price ?? 0;
  const buyAndHoldReturn = priceStart > 0 ? (priceEnd - priceStart) / priceStart : 0;

  // Sample equity curve to ~200 points for compact output
  const sampleRate = Math.max(1, Math.floor(equityCurve.length / 200));
  const sampledCurve = equityCurve.filter((_, i) => i % sampleRate === 0);

  return {
    strategyName,
    scenarioName,
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    maxDrawdown,
    maxDrawdownDuration,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    profitFactor,
    avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
    avgHoldingPeriod: trades.length > 0
      ? trades.reduce((s, t) => s + t.holdingPeriod, 0) / trades.length
      : 0,
    equityCurve: sampledCurve,
    finalEquity,
    startEquity: startCapital,
    priceStart,
    priceEnd,
    buyAndHoldReturn,
    trades,
  };
}

// ─── Report Formatting ──────────────────────────────────────────────────

export function formatValidationReport(results: ValidationResult[]): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════════════════╗");
  lines.push("║           BASELINE STRATEGY VALIDATION REPORT                  ║");
  lines.push("╚══════════════════════════════════════════════════════════════════╝");
  lines.push("");

  for (const r of results) {
    lines.push(`━━━ ${r.strategyName.toUpperCase()} × ${r.scenarioName} ━━━`);
    lines.push("");
    lines.push(`  Capital: $${r.startEquity.toLocaleString()} → $${r.finalEquity.toFixed(2)}`);
    lines.push(`  Total Return:      ${(r.totalReturn * 100).toFixed(2)}%`);
    lines.push(`  Annualized Return: ${(r.annualizedReturn * 100).toFixed(2)}%`);
    lines.push(`  Buy & Hold Return: ${(r.buyAndHoldReturn * 100).toFixed(2)}%`);
    lines.push(`  Sharpe Ratio:      ${r.sharpeRatio.toFixed(3)}`);
    lines.push(`  Max Drawdown:      ${(r.maxDrawdown * 100).toFixed(2)}%`);
    lines.push(`  Max DD Duration:   ${r.maxDrawdownDuration} ticks (~${(r.maxDrawdownDuration / 24).toFixed(0)} days)`);
    lines.push("");
    lines.push(`  Trades: ${r.totalTrades} total | ${r.winningTrades} wins | ${r.losingTrades} losses`);
    lines.push(`  Win Rate:          ${(r.winRate * 100).toFixed(1)}%`);
    lines.push(`  Profit Factor:     ${r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(3)}`);
    lines.push(`  Avg Win:           $${r.avgWin.toFixed(2)}`);
    lines.push(`  Avg Loss:          $${r.avgLoss.toFixed(2)}`);
    lines.push(`  Avg Holding:       ${r.avgHoldingPeriod.toFixed(0)} ticks (~${(r.avgHoldingPeriod / 24).toFixed(1)} days)`);
    lines.push(`  Price:             $${r.priceStart.toFixed(2)} → $${r.priceEnd.toFixed(2)}`);

    // Verdict
    const verdict = r.totalReturn > 0 && r.sharpeRatio > 0.5 && r.maxDrawdown < 0.25
      ? "✅ PASS — profitable with acceptable risk"
      : r.totalReturn > 0 && r.maxDrawdown < 0.35
        ? "⚠️  MARGINAL — profitable but risk metrics concerning"
        : "❌ FAIL — not ready for live trading";
    lines.push(`  Verdict:           ${verdict}`);
    lines.push("");
  }

  // Summary table
  lines.push("┌─────────────────────────┬────────┬─────────┬──────────┬──────────┐");
  lines.push("│ Strategy × Scenario     │ Return │ Sharpe  │ MaxDD    │ WinRate  │");
  lines.push("├─────────────────────────┼────────┼─────────┼──────────┼──────────┤");
  for (const r of results) {
    const name = `${r.strategyName} × ${r.scenarioName}`.slice(0, 23).padEnd(23);
    const ret = `${(r.totalReturn * 100).toFixed(1)}%`.padStart(6);
    const sharpe = r.sharpeRatio.toFixed(2).padStart(7);
    const dd = `${(r.maxDrawdown * 100).toFixed(1)}%`.padStart(8);
    const wr = `${(r.winRate * 100).toFixed(0)}%`.padStart(8);
    lines.push(`│ ${name} │ ${ret} │ ${sharpe} │ ${dd} │ ${wr} │`);
  }
  lines.push("└─────────────────────────┴────────┴─────────┴──────────┴──────────┘");

  return lines.join("\n");
}
