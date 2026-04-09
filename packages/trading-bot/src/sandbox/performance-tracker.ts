/**
 * Performance Tracker
 *
 * Tracks and reports trading performance metrics across a sandbox run.
 * Computes equity curve, drawdown, Sharpe ratio, win rate, and per-symbol P&L.
 */

import type { Balance, Position } from "../exchange/types.js";
import type { FillEvent } from "../paper/position-tracker.js";

export interface PerformanceSnapshot {
  tick: number;
  timestamp: number;
  equity: number;
  drawdownPct: number;
  regime: string;
  prices: Record<string, number>;
}

export interface PerformanceReport {
  name: string;
  startTime: number;
  endTime: number;
  totalTicks: number;
  /** Starting equity in USDT */
  startEquity: number;
  /** Final equity in USDT */
  endEquity: number;
  /** Absolute return */
  totalReturn: number;
  /** Return as a percentage */
  totalReturnPct: number;
  /** Max drawdown from peak as a percentage */
  maxDrawdownPct: number;
  /** Annualized Sharpe ratio (assumes risk-free rate = 0) */
  sharpeRatio: number;
  /** Total number of trades */
  totalTrades: number;
  /** Win rate as a fraction */
  winRate: number;
  /** Average win / average loss */
  profitFactor: number;
  /** Per-symbol stats */
  symbolStats: Record<string, {
    trades: number;
    realizedPnl: number;
    winRate: number;
  }>;
  /** Equity snapshots for charting */
  equityCurve: PerformanceSnapshot[];
}

export class PerformanceTracker {
  private readonly name: string;
  private readonly startEquity: number;
  private readonly startTime: number;

  private peakEquity: number;
  private maxDrawdownPct = 0;
  private equityCurve: PerformanceSnapshot[] = [];
  private returns: number[] = [];
  private lastEquity: number;

  constructor(name: string, startEquity: number) {
    this.name = name;
    this.startEquity = startEquity;
    this.peakEquity = startEquity;
    this.lastEquity = startEquity;
    this.startTime = Date.now();
  }

  /** Record a performance snapshot at a given tick */
  recordSnapshot(
    tick: number,
    balances: Balance[],
    positions: Position[],
    regime: string,
    prices: Record<string, number>,
  ): void {
    const equity = this.calculateEquity(balances, positions);

    // Track returns for Sharpe calculation
    if (this.lastEquity > 0) {
      this.returns.push((equity - this.lastEquity) / this.lastEquity);
    }
    this.lastEquity = equity;

    // Track peak and drawdown
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    const drawdownPct = this.peakEquity > 0
      ? ((this.peakEquity - equity) / this.peakEquity) * 100
      : 0;
    if (drawdownPct > this.maxDrawdownPct) {
      this.maxDrawdownPct = drawdownPct;
    }

    this.equityCurve.push({
      tick,
      timestamp: Date.now(),
      equity,
      drawdownPct,
      regime,
      prices,
    });
  }

  /** Generate the full performance report */
  generateReport(fills: readonly FillEvent[]): PerformanceReport {
    const lastSnapshot = this.equityCurve[this.equityCurve.length - 1];
    const endEquity = lastSnapshot?.equity ?? this.startEquity;
    const totalReturn = endEquity - this.startEquity;
    const totalReturnPct = this.startEquity > 0
      ? (totalReturn / this.startEquity) * 100
      : 0;

    // Compute per-symbol stats from fills
    const symbolStats = this.computeSymbolStats(fills);

    // Compute overall win rate
    const roundTrips = this.computeRoundTrips(fills);
    const wins = roundTrips.filter((r) => r > 0).length;
    const losses = roundTrips.filter((r) => r < 0).length;
    const winRate = roundTrips.length > 0 ? wins / roundTrips.length : 0;

    const avgWin = wins > 0
      ? roundTrips.filter((r) => r > 0).reduce((a, b) => a + b, 0) / wins
      : 0;
    const avgLoss = losses > 0
      ? Math.abs(roundTrips.filter((r) => r < 0).reduce((a, b) => a + b, 0) / losses)
      : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    return {
      name: this.name,
      startTime: this.startTime,
      endTime: Date.now(),
      totalTicks: lastSnapshot?.tick ?? 0,
      startEquity: this.startEquity,
      endEquity,
      totalReturn,
      totalReturnPct,
      maxDrawdownPct: this.maxDrawdownPct,
      sharpeRatio: this.computeSharpe(),
      totalTrades: fills.length,
      winRate,
      profitFactor,
      symbolStats,
      equityCurve: this.equityCurve,
    };
  }

  /** Format a report as a human-readable string */
  static formatReport(report: PerformanceReport): string {
    const lines: string[] = [
      `\n${"═".repeat(60)}`,
      `  SANDBOX PERFORMANCE REPORT: ${report.name}`,
      `${"═".repeat(60)}`,
      `  Duration:        ${report.totalTicks} ticks`,
      `  Start Equity:    $${report.startEquity.toFixed(2)}`,
      `  End Equity:      $${report.endEquity.toFixed(2)}`,
      `  Total Return:    $${report.totalReturn.toFixed(2)} (${report.totalReturnPct.toFixed(2)}%)`,
      `  Max Drawdown:    ${report.maxDrawdownPct.toFixed(2)}%`,
      `  Sharpe Ratio:    ${report.sharpeRatio.toFixed(3)}`,
      `  Total Trades:    ${report.totalTrades}`,
      `  Win Rate:        ${(report.winRate * 100).toFixed(1)}%`,
      `  Profit Factor:   ${report.profitFactor === Infinity ? "∞" : report.profitFactor.toFixed(2)}`,
      `${"─".repeat(60)}`,
      `  PER-SYMBOL BREAKDOWN:`,
    ];

    for (const [symbol, stats] of Object.entries(report.symbolStats)) {
      lines.push(
        `    ${symbol}: ${stats.trades} trades, PnL $${stats.realizedPnl.toFixed(2)}, WR ${(stats.winRate * 100).toFixed(1)}%`,
      );
    }

    lines.push(`${"═".repeat(60)}\n`);
    return lines.join("\n");
  }

  private calculateEquity(balances: Balance[], positions: Position[]): number {
    // Sum all USDT-equivalent value
    let equity = 0;

    for (const b of balances) {
      if (b.asset === "USDT") {
        equity += b.total;
      }
      // Non-USDT balances are valued through positions
    }

    for (const p of positions) {
      equity += p.quantity * p.currentPrice + p.unrealizedPnl;
    }

    return equity;
  }

  private computeSharpe(): number {
    if (this.returns.length < 2) return 0;

    const mean = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    const variance = this.returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (this.returns.length - 1);
    const std = Math.sqrt(variance);

    if (std === 0) return 0;

    // Annualize: assume ~252 trading days, ~86400 ticks per day at 1s intervals
    // Rough approximation — the actual annualization depends on tick frequency
    const periodsPerYear = Math.min(this.returns.length * 365, 365 * 86400);
    const annualizationFactor = Math.sqrt(periodsPerYear / this.returns.length);

    return (mean / std) * annualizationFactor;
  }

  private computeRoundTrips(fills: readonly FillEvent[]): number[] {
    // Group fills by symbol, compute PnL for each buy-sell round trip
    const pnls: number[] = [];
    const openBySymbol = new Map<string, { qty: number; cost: number }>();

    for (const fill of fills) {
      let open = openBySymbol.get(fill.symbol);
      if (!open) {
        open = { qty: 0, cost: 0 };
        openBySymbol.set(fill.symbol, open);
      }

      if (fill.side === "buy") {
        open.qty += fill.quantity;
        open.cost += fill.quantity * fill.price + fill.fee;
      } else if (fill.side === "sell" && open.qty > 0) {
        const closeQty = Math.min(fill.quantity, open.qty);
        const avgEntry = open.cost / open.qty;
        const pnl = closeQty * (fill.price - avgEntry) - fill.fee;
        pnls.push(pnl);

        const ratio = 1 - closeQty / open.qty;
        open.qty *= ratio;
        open.cost *= ratio;
      }
    }

    return pnls;
  }

  private computeSymbolStats(fills: readonly FillEvent[]): Record<string, { trades: number; realizedPnl: number; winRate: number }> {
    const bySymbol = new Map<string, FillEvent[]>();
    for (const fill of fills) {
      const arr = bySymbol.get(fill.symbol) ?? [];
      arr.push(fill);
      bySymbol.set(fill.symbol, arr);
    }

    const stats: Record<string, { trades: number; realizedPnl: number; winRate: number }> = {};
    for (const [symbol, symbolFills] of bySymbol) {
      const roundTrips = this.computeRoundTrips(symbolFills);
      const wins = roundTrips.filter((r) => r > 0).length;
      stats[symbol] = {
        trades: symbolFills.length,
        realizedPnl: roundTrips.reduce((a, b) => a + b, 0),
        winRate: roundTrips.length > 0 ? wins / roundTrips.length : 0,
      };
    }

    return stats;
  }
}
