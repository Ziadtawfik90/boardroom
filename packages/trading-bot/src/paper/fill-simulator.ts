/**
 * Fill Simulator
 *
 * Simulates order fills against market data with realistic slippage modeling.
 * Market orders fill immediately at current price + slippage.
 * Limit orders fill when the market price crosses the limit price.
 */

import type { Order, OrderRequest, OrderBookSnapshot, Ticker } from "../exchange/types.js";

export interface SlippageModel {
  /** Base slippage as a fraction (e.g., 0.001 = 0.1%) */
  baseSlippagePct: number;
  /** Additional slippage per unit of quantity (models market impact) */
  impactPerUnit: number;
  /** Maximum slippage cap as a fraction */
  maxSlippagePct: number;
}

export interface FeeModel {
  /** Maker fee as a fraction (e.g., 0.001 = 0.1%) */
  makerFeePct: number;
  /** Taker fee as a fraction */
  takerFeePct: number;
}

export interface FillResult {
  filled: boolean;
  fillPrice: number;
  fillQuantity: number;
  fee: number;
  slippage: number;
}

const DEFAULT_SLIPPAGE: SlippageModel = {
  baseSlippagePct: 0.0005,  // 0.05%
  impactPerUnit: 0.00001,
  maxSlippagePct: 0.01,     // 1% max
};

const DEFAULT_FEES: FeeModel = {
  makerFeePct: 0.001,   // 0.1%
  takerFeePct: 0.001,   // 0.1%
};

export class FillSimulator {
  private readonly slippage: SlippageModel;
  private readonly fees: FeeModel;

  constructor(slippage?: Partial<SlippageModel>, fees?: Partial<FeeModel>) {
    this.slippage = { ...DEFAULT_SLIPPAGE, ...slippage };
    this.fees = { ...DEFAULT_FEES, ...fees };
  }

  /**
   * Attempt to fill a market order against current ticker data.
   * Always fills immediately with slippage applied.
   */
  fillMarketOrder(request: OrderRequest, ticker: Ticker): FillResult {
    const basePrice = request.side === "buy" ? ticker.ask : ticker.bid;
    const slippagePct = this.calculateSlippage(request.quantity);
    const direction = request.side === "buy" ? 1 : -1;
    const fillPrice = basePrice * (1 + direction * slippagePct);
    const fee = fillPrice * request.quantity * this.fees.takerFeePct;

    return {
      filled: true,
      fillPrice,
      fillQuantity: request.quantity,
      fee,
      slippage: Math.abs(fillPrice - basePrice) / basePrice,
    };
  }

  /**
   * Attempt to fill a market order against an order book snapshot.
   * Walks the book to simulate realistic fills at multiple price levels.
   */
  fillMarketOrderFromBook(
    request: OrderRequest,
    book: OrderBookSnapshot,
  ): FillResult {
    const levels = request.side === "buy" ? book.asks : book.bids;
    if (levels.length === 0) {
      return { filled: false, fillPrice: 0, fillQuantity: 0, fee: 0, slippage: 0 };
    }

    let remaining = request.quantity;
    let totalCost = 0;
    let totalFilled = 0;

    for (const level of levels) {
      if (remaining <= 0) break;
      const fillQty = Math.min(remaining, level.quantity);
      totalCost += fillQty * level.price;
      totalFilled += fillQty;
      remaining -= fillQty;
    }

    if (totalFilled === 0) {
      return { filled: false, fillPrice: 0, fillQuantity: 0, fee: 0, slippage: 0 };
    }

    const avgPrice = totalCost / totalFilled;
    const slippagePct = this.calculateSlippage(totalFilled);
    const direction = request.side === "buy" ? 1 : -1;
    const fillPrice = avgPrice * (1 + direction * slippagePct);
    const fee = fillPrice * totalFilled * this.fees.takerFeePct;

    return {
      filled: totalFilled > 0,
      fillPrice,
      fillQuantity: totalFilled,
      fee,
      slippage: Math.abs(fillPrice - levels[0].price) / levels[0].price,
    };
  }

  /**
   * Check if a limit order should fill given the current ticker.
   * Buy limits fill when ask <= limit price.
   * Sell limits fill when bid >= limit price.
   */
  checkLimitFill(order: Order, ticker: Ticker): FillResult {
    if (order.price == null) {
      return { filled: false, fillPrice: 0, fillQuantity: 0, fee: 0, slippage: 0 };
    }

    const remainingQty = order.quantity - order.filledQuantity;
    const shouldFill =
      (order.side === "buy" && ticker.ask <= order.price) ||
      (order.side === "sell" && ticker.bid >= order.price);

    if (!shouldFill) {
      return { filled: false, fillPrice: 0, fillQuantity: 0, fee: 0, slippage: 0 };
    }

    // Limit orders fill at the limit price (maker)
    const fee = order.price * remainingQty * this.fees.makerFeePct;
    return {
      filled: true,
      fillPrice: order.price,
      fillQuantity: remainingQty,
      fee,
      slippage: 0,
    };
  }

  private calculateSlippage(quantity: number): number {
    const raw = this.slippage.baseSlippagePct + quantity * this.slippage.impactPerUnit;
    return Math.min(raw, this.slippage.maxSlippagePct);
  }
}
