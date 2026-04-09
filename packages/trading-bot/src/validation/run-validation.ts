/**
 * Baseline Strategy Validation Runner
 *
 * Runs momentum and mean-reversion strategies through 4 market scenarios
 * (mixed 6-month, bear stress, bull run, range-bound) and outputs a
 * comprehensive validation report.
 *
 * Usage: npx tsx src/validation/run-validation.ts
 */

import { MomentumStrategy } from "../strategies/momentum-strategy.js";
import { MeanReversionStrategy } from "../strategies/mean-reversion-strategy.js";
import { VALIDATION_SCENARIOS } from "./market-simulator.js";
import { validateStrategy, formatValidationReport, type ValidationResult } from "./strategy-validator.js";
import type { Ticker } from "../exchange/types.js";

// ─── Config ─────────────────────────────────────────────────────────────

const SYMBOL = "BTC/USDT";
const START_PRICE = 65_000;
const START_CAPITAL = 10_000;
const TRADE_QUANTITY = 0.01;  // 0.01 BTC per trade (~$650)
const MAX_POSITION_PCT = 0.25;

const validationConfig = {
  startCapital: START_CAPITAL,
  tradeQuantity: TRADE_QUANTITY,
  maxPositionPct: MAX_POSITION_PCT,
  symbol: SYMBOL,
};

// ─── Scenarios ──────────────────────────────────────────────────────────

const scenarios = [
  { name: "mixed-6mo", sim: VALIDATION_SCENARIOS.mixed6Month(SYMBOL, START_PRICE) },
  { name: "bear-stress", sim: VALIDATION_SCENARIOS.bearStress(SYMBOL, START_PRICE, 123) },
  { name: "bull-run", sim: VALIDATION_SCENARIOS.bullRun(SYMBOL, START_PRICE, 456) },
  { name: "rangebound", sim: VALIDATION_SCENARIOS.rangebound(SYMBOL, START_PRICE, 789) },
];

// ─── Strategies ─────────────────────────────────────────────────────────

function createMomentumSignalFn(): (ticker: Ticker) => "buy" | "sell" | "hold" {
  const strategy = new MomentumStrategy({
    symbol: SYMBOL,
    maxPositionPct: MAX_POSITION_PCT,
    tradeQuantity: TRADE_QUANTITY,
    shortWindow: 10,
    longWindow: 30,
    rocPeriod: 14,
    rocThreshold: 0.02,
  });
  return (ticker: Ticker) => strategy.onTick(ticker);
}

function createMeanReversionSignalFn(): (ticker: Ticker) => "buy" | "sell" | "hold" {
  const strategy = new MeanReversionStrategy({
    symbol: SYMBOL,
    maxPositionPct: MAX_POSITION_PCT,
    tradeQuantity: TRADE_QUANTITY,
    period: 20,
    bandWidth: 2,
    cooldownTicks: 10,
  });
  return (ticker: Ticker) => strategy.onTick(ticker);
}

// ─── Run ────────────────────────────────────────────────────────────────

console.log("Generating market scenarios and running validation...\n");

const results: ValidationResult[] = [];

for (const scenario of scenarios) {
  const tickers = scenario.sim.generate();
  console.log(`  Scenario: ${scenario.name} — ${tickers.length} ticks generated`);

  // Momentum
  const momSignal = createMomentumSignalFn();
  const momResult = validateStrategy(
    "momentum",
    scenario.name,
    momSignal,
    tickers,
    validationConfig,
  );
  results.push(momResult);
  console.log(`    momentum: ${(momResult.totalReturn * 100).toFixed(2)}% return, ${momResult.totalTrades} trades`);

  // Mean Reversion
  const mrSignal = createMeanReversionSignalFn();
  const mrResult = validateStrategy(
    "mean-reversion",
    scenario.name,
    mrSignal,
    tickers,
    validationConfig,
  );
  results.push(mrResult);
  console.log(`    mean-reversion: ${(mrResult.totalReturn * 100).toFixed(2)}% return, ${mrResult.totalTrades} trades`);
}

console.log("\n");
console.log(formatValidationReport(results));

// ─── Write JSON results for programmatic consumption ────────────────────

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "../../validation-results.json");

const jsonOutput = results.map(r => ({
  strategy: r.strategyName,
  scenario: r.scenarioName,
  totalReturn: r.totalReturn,
  annualizedReturn: r.annualizedReturn,
  sharpeRatio: r.sharpeRatio,
  maxDrawdown: r.maxDrawdown,
  totalTrades: r.totalTrades,
  winRate: r.winRate,
  profitFactor: r.profitFactor,
  avgHoldingPeriod: r.avgHoldingPeriod,
  finalEquity: r.finalEquity,
  buyAndHoldReturn: r.buyAndHoldReturn,
}));

writeFileSync(outputPath, JSON.stringify(jsonOutput, null, 2));
console.log(`\nResults written to ${outputPath}`);
