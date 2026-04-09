import { createEnvelope } from '../../../shared/src/protocol.js';
import { config } from '../config.js';
import type { AgentRegistry } from '../agent/registry.js';

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private registry: AgentRegistry) {}

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.ping();
    }, config.heartbeatIntervalMs);

    console.log(`[heartbeat] Started (interval: ${config.heartbeatIntervalMs}ms, max misses: ${config.heartbeatMaxMisses})`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private ping(): void {
    const connected = this.registry.getAllConnected();

    for (const agent of connected) {
      if (agent.ws.readyState !== 1) {
        this.registry.unregister(agent.agentId);
        console.log(`[heartbeat] Agent ${agent.agentId} connection stale, unregistered`);
        continue;
      }

      // Send ping first, then check misses on the NEXT cycle
      const envelope = createEnvelope('heartbeat.ping', {}, 'system');
      try {
        agent.ws.send(JSON.stringify(envelope));
      } catch {
        this.registry.unregister(agent.agentId);
        continue;
      }

      const misses = this.registry.recordMissedPong(agent.agentId);

      if (misses > config.heartbeatMaxMisses) {
        console.log(`[heartbeat] Agent ${agent.agentId} missed ${misses} pongs, marking offline`);
        this.registry.unregister(agent.agentId);
        try { agent.ws.close(); } catch { /* ignore */ }
      }
    }
  }
}
