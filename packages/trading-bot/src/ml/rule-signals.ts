/**
 * Rule-Based Signal Generators — The fallback brain.
 *
 * These are deterministic, well-understood strategies that the system
 * degrades to when ML confidence is low. They are also ensemble members
 * that vote alongside the ML signal.
 *
 * Each rule returns a RuleSignal with direction and strength.
 */

import type { Candle } from "../exchange/types.js";
import type { RuleSignal, SignalDirection } from "./types.js";

/**
 * Momentum rule: buy when price is trending up over N periods,
 * sell when trending down. Simple but effective as a baseline.
 */
export function momentumSignal(candles: Candle[], period: number = 10): RuleSignal {
  if (candles.length < period + 1) {
    return { name: "momentum", direction: "neutral", strength: 0 };
  }

  const recent = candles.slice(-period);
  const returns = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
  const absReturn = Math.abs(returns);

  let direction: SignalDirection;
  if (returns > 0.005) direction = "long";
  else if (returns < -0.005) direction = "short";
  else direction = "neutral";

  // Strength scales with magnitude, capped at 1
  const strength = Math.min(absReturn / 0.05, 1);

  return { name: "momentum", direction, strength };
}

/**
 * Mean reversion rule: buy when price is significantly below its
 * moving average, sell when significantly above. Assumes prices
 * tend to revert to the mean.
 */
export function meanReversionSignal(candles: Candle[], period: number = 20): RuleSignal {
  if (candles.length < period) {
    return { name: "mean_reversion", direction: "neutral", strength: 0 };
  }

  const recent = candles.slice(-period);
  const closes = recent.map((c) => c.close);
  const sma = closes.reduce((s, c) => s + c, 0) / closes.length;
  const currentPrice = candles[candles.length - 1].close;
  const deviation = (currentPrice - sma) / sma;

  // Mean reversion: buy when below, sell when above
  let direction: SignalDirection;
  if (deviation < -0.02) direction = "long";      // price below average → expect reversion up
  else if (deviation > 0.02) direction = "short";  // price above average → expect reversion down
  else direction = "neutral";

  const strength = Math.min(Math.abs(deviation) / 0.05, 1);

  return { name: "mean_reversion", direction, strength };
}

/**
 * RSI rule: oversold (RSI < 30) → buy, overbought (RSI > 70) → sell.
 */
export function rsiSignal(candles: Candle[], period: number = 14): RuleSignal {
  if (candles.length < period + 1) {
    return { name: "rsi", direction: "neutral", strength: 0 };
  }

  const closes = candles.slice(-(period + 1)).map((c) => c.close);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  let direction: SignalDirection;
  if (rsi < 30) direction = "long";
  else if (rsi > 70) direction = "short";
  else direction = "neutral";

  // Strength: how far into oversold/overbought territory
  let strength = 0;
  if (rsi < 30) strength = (30 - rsi) / 30;
  else if (rsi > 70) strength = (rsi - 70) / 30;

  return { name: "rsi", direction, strength: Math.min(strength, 1) };
}

/**
 * Volume spike rule: unusual volume suggests a move is more significant.
 * Not directional on its own — amplifies other signals.
 */
export function volumeSpikeSignal(candles: Candle[], period: number = 20): RuleSignal {
  if (candles.length < period) {
    return { name: "volume_spike", direction: "neutral", strength: 0 };
  }

  const volumes = candles.slice(-period).map((c) => c.volume);
  const avgVolume = volumes.slice(0, -1).reduce((s, v) => s + v, 0) / (volumes.length - 1);
  const currentVolume = volumes[volumes.length - 1];
  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // Direction follows the candle body direction
  const lastCandle = candles[candles.length - 1];
  const bullish = lastCandle.close > lastCandle.open;

  let direction: SignalDirection = "neutral";
  if (ratio > 1.5) {
    direction = bullish ? "long" : "short";
  }

  const strength = Math.min((ratio - 1) / 2, 1);

  return { name: "volume_spike", direction, strength: Math.max(strength, 0) };
}

/** Run all rule-based signals and return them */
export function allRuleSignals(candles: Candle[]): RuleSignal[] {
  return [
    momentumSignal(candles),
    meanReversionSignal(candles),
    rsiSignal(candles),
    volumeSpikeSignal(candles),
  ];
}
