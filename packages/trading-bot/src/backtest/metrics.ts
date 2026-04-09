/**
 * Performance Metrics Calculator
 *
 * Computes trading performance metrics from equity curves and trade lists.
 * All annualization assumes 365-day crypto markets with configurable
 * bars-per-year based on timeframe.
 */

import type {
  BacktestTrade,
  EquityPoint,
  PerformanceMetrics,
} from "./types.js";
import type { TimeFrame } from "../exchange/types.js";

// Bars per year for annualization (crypto = 365 days)
const BARS_PER_YEAR: Record<TimeFrame, number> = {
  "1m": 365 * 24 * 60,
  "5m": 365 * 24 * 12,
  "15m": 365 * 24 * 4,
  "1h": 365 * 24,
  "4h": 365 * 6,
  "1d": 365,
};

/** Risk-free rate as daily fraction (default ~4% annual) */
const RISK_FREE_DAILY = 0.04 / 365;

export function calculateMetrics(
  equityCurve: EquityPoint[],
  trades: BacktestTrade[],
  timeframe: TimeFrame,
  initialCapital: number,
): PerformanceMetrics {
  const barsPerYear = BARS_PER_YEAR[timeframe];
  const totalBars = equityCurve.length;

  if (totalBars < 2) {
    return emptyMetrics(equityCurve, initialCapital, totalBars);
  }

  const finalEquity = equityCurve[totalBars - 1].equity;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  const years = totalBars / barsPerYear;

  // Annualized return (CAGR)
  const annualizedReturn = years > 0
    ? Math.sign(1 + totalReturn) * (Math.abs(1 + totalReturn) ** (1 / years) - 1)
    : 0;

  // Per-bar returns
  const barReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    barReturns.push(prev > 0 ? (equityCurve[i].equity - prev) / prev : 0);
  }

  // Volatility (annualized)
  const avgReturn = barReturns.reduce((a, b) => a + b, 0) / barReturns.length;
  const variance = barReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / barReturns.length;
  const volatility = Math.sqrt(variance * barsPerYear);

  // Downside deviation (only negative returns)
  const riskFreePerBar = RISK_FREE_DAILY * (365 / barsPerYear);
  const downsideSquares = barReturns
    .map(r => Math.min(r - riskFreePerBar, 0) ** 2)
    .reduce((a, b) => a + b, 0);
  const downsideDeviation = Math.sqrt((downsideSquares / barReturns.length) * barsPerYear);

  // Max drawdown
  let peak = equityCurve[0].equity;
  let maxDd = 0;
  let maxDdDuration = 0;
  let currentDdStart = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i].equity;
    if (eq > peak) {
      peak = eq;
      currentDdStart = i;
    }
    const dd = (eq - peak) / peak;
    if (dd < maxDd) {
      maxDd = dd;
      maxDdDuration = i - currentDdStart;
    }
  }

  // Sharpe ratio
  const excessReturn = annualizedReturn - 0.04; // 4% risk-free
  const sharpeRatio = volatility > 0 ? excessReturn / volatility : 0;

  // Sortino ratio
  const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

  // Calmar ratio
  const calmarRatio = maxDd !== 0 ? annualizedReturn / Math.abs(maxDd) : 0;

  // Trade statistics
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl < 0);

  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const avgLoss = losers.length > 0 ? -grossLoss / losers.length : 0;
  const avgWinPct = winners.length > 0
    ? winners.reduce((s, t) => s + t.pnlPct, 0) / winners.length
    : 0;
  const avgLossPct = losers.length > 0
    ? losers.reduce((s, t) => s + t.pnlPct, 0) / losers.length
    : 0;

  const totalFees = trades.reduce((s, t) => s + t.fees, 0);

  // Exposure time (fraction of bars where we had a position)
  const barsInMarket = equityCurve.filter(e => e.positionValue > 0).length;
  const exposureTime = totalBars > 0 ? barsInMarket / totalBars : 0;

  return {
    totalReturn,
    totalReturnPct: totalReturn * 100,
    annualizedReturn,
    annualizedReturnPct: annualizedReturn * 100,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDd * 100,
    maxDrawdownDuration: maxDdDuration,
    volatility,
    downsideDeviation,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: trades.length > 0 ? winners.length / trades.length : 0,
    profitFactor,
    avgWin,
    avgLoss,
    avgWinPct: avgWinPct * 100,
    avgLossPct: avgLossPct * 100,
    largestWin: winners.length > 0 ? Math.max(...winners.map(t => t.pnl)) : 0,
    largestLoss: losers.length > 0 ? Math.min(...losers.map(t => t.pnl)) : 0,
    avgHoldingPeriod: trades.length > 0
      ? trades.reduce((s, t) => s + t.holdingPeriodBars, 0) / trades.length
      : 0,
    expectancy: trades.length > 0
      ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length
      : 0,
    totalFees,
    startTime: equityCurve[0]?.timestamp ?? 0,
    endTime: equityCurve[totalBars - 1]?.timestamp ?? 0,
    totalBars,
    exposureTime,
  };
}

function emptyMetrics(
  equityCurve: EquityPoint[],
  initialCapital: number,
  totalBars: number,
): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0,
    annualizedReturn: 0, annualizedReturnPct: 0,
    maxDrawdown: 0, maxDrawdownPct: 0, maxDrawdownDuration: 0,
    volatility: 0, downsideDeviation: 0,
    sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    totalTrades: 0, winningTrades: 0, losingTrades: 0,
    winRate: 0, profitFactor: 0,
    avgWin: 0, avgLoss: 0, avgWinPct: 0, avgLossPct: 0,
    largestWin: 0, largestLoss: 0,
    avgHoldingPeriod: 0, expectancy: 0, totalFees: 0,
    startTime: equityCurve[0]?.timestamp ?? 0,
    endTime: equityCurve[totalBars - 1]?.timestamp ?? 0,
    totalBars,
    exposureTime: 0,
  };
}

/** Format metrics as a readable report string */
export function formatMetricsReport(m: PerformanceMetrics, name: string): string {
  const lines = [
    `═══ ${name} ═══`,
    ``,
    `Returns`,
    `  Total Return:      ${m.totalReturnPct.toFixed(2)}%`,
    `  Annualized Return: ${m.annualizedReturnPct.toFixed(2)}%`,
    `  Max Drawdown:      ${m.maxDrawdownPct.toFixed(2)}%`,
    `  DD Duration:       ${m.maxDrawdownDuration} bars`,
    ``,
    `Risk-Adjusted`,
    `  Sharpe Ratio:      ${m.sharpeRatio.toFixed(3)}`,
    `  Sortino Ratio:     ${m.sortinoRatio.toFixed(3)}`,
    `  Calmar Ratio:      ${m.calmarRatio.toFixed(3)}`,
    `  Volatility:        ${(m.volatility * 100).toFixed(2)}%`,
    ``,
    `Trades (${m.totalTrades})`,
    `  Win Rate:          ${(m.winRate * 100).toFixed(1)}%`,
    `  Profit Factor:     ${m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(3)}`,
    `  Avg Win:           $${m.avgWin.toFixed(2)} (${m.avgWinPct.toFixed(2)}%)`,
    `  Avg Loss:          $${m.avgLoss.toFixed(2)} (${m.avgLossPct.toFixed(2)}%)`,
    `  Largest Win:       $${m.largestWin.toFixed(2)}`,
    `  Largest Loss:      $${m.largestLoss.toFixed(2)}`,
    `  Expectancy:        $${m.expectancy.toFixed(2)}/trade`,
    `  Avg Hold:          ${m.avgHoldingPeriod.toFixed(1)} bars`,
    ``,
    `Exposure & Costs`,
    `  Time in Market:    ${(m.exposureTime * 100).toFixed(1)}%`,
    `  Total Fees:        $${m.totalFees.toFixed(2)}`,
    `  Period:            ${m.totalBars} bars`,
  ];
  return lines.join("\n");
}
