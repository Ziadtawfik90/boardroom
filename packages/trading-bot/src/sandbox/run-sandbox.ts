#!/usr/bin/env node
/**
 * Paper Trading Sandbox — Runnable Demo
 *
 * Runs a complete paper trading simulation with:
 * - Simulated price feeds across BTC/USDT, ETH/USDT, SOL/USDT
 * - Configurable market regime shifts (bull, bear, sideways, volatile, crash)
 * - Momentum strategy with 2% position sizing
 * - Full performance reporting (Sharpe, drawdown, win rate, per-symbol P&L)
 *
 * Usage:
 *   npx tsx src/sandbox/run-sandbox.ts [preset]
 *
 * Presets: conservative, multi-pair, stress-test (default: multi-pair)
 */

import { SandboxRunner, createSimpleMomentumStrategy } from "./sandbox-runner.js";
import { PerformanceTracker } from "./performance-tracker.js";
import { PRESETS } from "./sandbox-config.js";

async function main() {
  const presetName = (process.argv[2] ?? "multi-pair") as keyof typeof PRESETS;
  const config = PRESETS[presetName];

  if (!config) {
    console.error(`Unknown preset: ${presetName}`);
    console.error(`Available: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n🏗️  Starting paper trading sandbox: "${config.name}"`);
  console.log(`   Initial capital: $${Object.values(config.initialBalances).reduce((a, b) => a + b, 0).toLocaleString()}`);
  console.log(`   Pairs: ${config.feeds.map((f) => f.symbol).join(", ")}`);
  console.log(`   Max ticks: ${config.maxTicks}`);
  console.log(`   Tick interval: ${config.tickIntervalMs}ms`);
  console.log("");

  const sandbox = new SandboxRunner(config);

  // Plug in the built-in momentum strategy
  sandbox.setStrategy(createSimpleMomentumStrategy({
    lookback: 5,
    positionSizePct: 0.02,
  }));

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nStopping sandbox...");
    sandbox.stop();
  });

  // Run in fast-forward mode (no waiting between ticks)
  const startTime = Date.now();
  await sandbox.runSync();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nSimulation completed in ${elapsed}s`);

  // Print performance report
  const report = sandbox.getReport();
  console.log(PerformanceTracker.formatReport(report));

  // Summary verdict
  if (report.totalReturnPct > 0) {
    console.log(`✅ Strategy was profitable: +${report.totalReturnPct.toFixed(2)}%`);
  } else {
    console.log(`❌ Strategy lost money: ${report.totalReturnPct.toFixed(2)}%`);
  }

  if (report.maxDrawdownPct > 20) {
    console.log(`⚠️  Max drawdown exceeded 20% — risk management needs tightening`);
  }

  if (report.sharpeRatio < 0.5) {
    console.log(`⚠️  Sharpe ratio below 0.5 — strategy not generating risk-adjusted returns`);
  }
}

main().catch((err) => {
  console.error("Sandbox crashed:", err);
  process.exit(1);
});
