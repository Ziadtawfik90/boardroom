/**
 * Strategy Factory Registry
 *
 * Central registry for pluggable strategy creation. Register strategy
 * factories by name, then instantiate them from configuration alone.
 * This is the extension point for adding new strategies (ML models,
 * custom signals, etc.) without modifying engine code.
 *
 * Usage:
 *   const registry = new StrategyRegistry();
 *   registry.register("momentum", createMomentumStrategy);
 *   registry.register("mean-reversion", createMeanReversionStrategy);
 *   const strategy = registry.create("momentum", config);
 */

import type { Strategy, StrategyConfig, StrategyFactory } from "./types.js";
import { createMomentumStrategy } from "./momentum-strategy.js";
import { createMeanReversionStrategy } from "./mean-reversion-strategy.js";

export class StrategyRegistry {
  private factories = new Map<string, StrategyFactory>();

  /** Register a strategy factory by name */
  register(name: string, factory: StrategyFactory): void {
    if (this.factories.has(name)) {
      throw new Error(`Strategy "${name}" is already registered`);
    }
    this.factories.set(name, factory);
  }

  /** Unregister a strategy factory */
  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  /** Create a strategy instance from a registered factory */
  create(name: string, config: StrategyConfig): Strategy {
    const factory = this.factories.get(name);
    if (!factory) {
      const available = [...this.factories.keys()].join(", ");
      throw new Error(`Unknown strategy "${name}". Available: ${available}`);
    }
    return factory(config);
  }

  /** Check if a strategy type is registered */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** List all registered strategy type names */
  list(): string[] {
    return [...this.factories.keys()];
  }
}

/**
 * Create a registry pre-loaded with the built-in baseline strategies.
 * External code can add more strategies to the returned registry.
 */
export function createDefaultRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register("momentum", createMomentumStrategy);
  registry.register("mean-reversion", createMeanReversionStrategy);
  return registry;
}
