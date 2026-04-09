/**
 * Position & Balance Tracker for Paper Trading
 *
 * Tracks simulated balances, open positions, and realized/unrealized PnL.
 * All mutations are synchronous — no I/O, no async.
 */

import type { Balance, Position, OrderSide } from "../exchange/types.js";

export interface FillEvent {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fee: number;       // denominated in quote asset
  timestamp: number;
}

/** Parse "BTC/USDT" → { base: "BTC", quote: "USDT" } */
function splitSymbol(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.split("/");
  if (!base || !quote) throw new Error(`Invalid symbol format: ${symbol} (expected BASE/QUOTE)`);
  return { base, quote };
}

export class PositionTracker {
  /** asset → { free, locked } */
  private balances = new Map<string, { free: number; locked: number }>();

  /** symbol → accumulated position */
  private positions = new Map<string, {
    quantity: number;      // positive = long, negative = short
    costBasis: number;     // total cost of current position
    realizedPnl: number;
  }>();

  /** Trade log for audit trail */
  private fills: FillEvent[] = [];

  constructor(initialBalances: Record<string, number>) {
    for (const [asset, amount] of Object.entries(initialBalances)) {
      this.balances.set(asset, { free: amount, locked: 0 });
    }
  }

  // ─── Balance Operations ─────────────────────────────────────────────

  getBalance(asset: string): Balance {
    const b = this.balances.get(asset) ?? { free: 0, locked: 0 };
    return { asset, free: b.free, locked: b.locked, total: b.free + b.locked };
  }

  getAllBalances(): Balance[] {
    const result: Balance[] = [];
    for (const [asset, b] of this.balances) {
      result.push({ asset, free: b.free, locked: b.locked, total: b.free + b.locked });
    }
    return result;
  }

  /** Lock funds when an order is placed (limit orders). */
  lockFunds(asset: string, amount: number): boolean {
    const b = this.balances.get(asset);
    if (!b || b.free < amount) return false;
    b.free -= amount;
    b.locked += amount;
    return true;
  }

  /** Unlock funds when an order is cancelled. */
  unlockFunds(asset: string, amount: number): void {
    const b = this.balances.get(asset);
    if (!b) return;
    const unlock = Math.min(amount, b.locked);
    b.locked -= unlock;
    b.free += unlock;
  }

  // ─── Fill Processing ────────────────────────────────────────────────

  /**
   * Process a simulated fill. Updates balances and position tracking.
   * Returns false if insufficient funds.
   */
  processFill(fill: FillEvent): boolean {
    const { base, quote } = splitSymbol(fill.symbol);
    const cost = fill.quantity * fill.price;

    if (fill.side === "buy") {
      // Deduct quote currency (+ fee)
      if (!this.deductBalance(quote, cost + fill.fee)) return false;
      this.creditBalance(base, fill.quantity);
    } else {
      // Deduct base currency
      if (!this.deductBalance(base, fill.quantity)) return false;
      this.creditBalance(quote, cost - fill.fee);
    }

    this.updatePosition(fill);
    this.fills.push(fill);
    return true;
  }

  // ─── Position Queries ───────────────────────────────────────────────

  getPosition(symbol: string, currentPrice: number): Position | null {
    const pos = this.positions.get(symbol);
    if (!pos || pos.quantity === 0) return null;

    const side: OrderSide = pos.quantity > 0 ? "buy" : "sell";
    const absQty = Math.abs(pos.quantity);
    const entryPrice = pos.costBasis / absQty;
    const unrealizedPnl = pos.quantity > 0
      ? (currentPrice - entryPrice) * absQty
      : (entryPrice - currentPrice) * absQty;

    return {
      symbol,
      side,
      quantity: absQty,
      entryPrice,
      currentPrice,
      unrealizedPnl,
      realizedPnl: pos.realizedPnl,
    };
  }

  getAllPositions(currentPrices: Map<string, number>): Position[] {
    const result: Position[] = [];
    for (const symbol of this.positions.keys()) {
      const price = currentPrices.get(symbol) ?? 0;
      const pos = this.getPosition(symbol, price);
      if (pos) result.push(pos);
    }
    return result;
  }

  getFills(): readonly FillEvent[] {
    return this.fills;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private deductBalance(asset: string, amount: number): boolean {
    const b = this.balances.get(asset);
    if (!b || b.free < amount) return false;
    b.free -= amount;
    return true;
  }

  private creditBalance(asset: string, amount: number): void {
    let b = this.balances.get(asset);
    if (!b) {
      b = { free: 0, locked: 0 };
      this.balances.set(asset, b);
    }
    b.free += amount;
  }

  private updatePosition(fill: FillEvent): void {
    let pos = this.positions.get(fill.symbol);
    if (!pos) {
      pos = { quantity: 0, costBasis: 0, realizedPnl: 0 };
      this.positions.set(fill.symbol, pos);
    }

    const signedQty = fill.side === "buy" ? fill.quantity : -fill.quantity;
    const fillCost = fill.quantity * fill.price;

    // Check if this fill reduces the position (realize PnL)
    if (pos.quantity !== 0 && Math.sign(signedQty) !== Math.sign(pos.quantity)) {
      const closedQty = Math.min(Math.abs(signedQty), Math.abs(pos.quantity));
      const avgEntry = pos.costBasis / Math.abs(pos.quantity);
      const pnl = pos.quantity > 0
        ? (fill.price - avgEntry) * closedQty
        : (avgEntry - fill.price) * closedQty;
      pos.realizedPnl += pnl - fill.fee;

      // Reduce cost basis proportionally
      const remainingRatio = 1 - closedQty / Math.abs(pos.quantity);
      pos.costBasis *= remainingRatio;
      pos.quantity += signedQty;

      // If we flipped sides, add new cost basis for the remainder
      if (Math.abs(signedQty) > closedQty) {
        const newQty = Math.abs(signedQty) - closedQty;
        pos.costBasis += newQty * fill.price;
      }
    } else {
      // Adding to position
      pos.quantity += signedQty;
      pos.costBasis += fillCost;
    }
  }
}
