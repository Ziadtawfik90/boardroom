/**
 * Fleet Health Monitor — tracks alive/suspect/dead state per agent via NATS heartbeats.
 *
 * Adapted from fleet-command/dispatcher/src/health-monitor.ts
 */

import type { NatsConnection } from 'nats';
import type { AgentRegistry } from '../agent/registry.js';
import type { Queries } from '../db/queries.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type {
  NodeId,
  NodeState,
  FleetHeartbeat,
  FleetNodeStateChange,
} from '../../../shared/src/fleet-types.js';
import { FLEET_SUBJECTS, FLEET_HEARTBEAT_THRESHOLDS } from '../../../shared/src/fleet-types.js';

interface NodeHealth {
  nodeId: NodeId;
  state: NodeState;
  lastHeartbeat: number;
  lastData: FleetHeartbeat | null;
}

export class FleetHealthMonitor {
  private nodes = new Map<NodeId, NodeHealth>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private nc: NatsConnection,
    private registry: AgentRegistry,
    private queries: Queries,
    private dispatcher: TaskDispatcher,
  ) {
    // Initialize all known agents
    for (const nodeId of ['asus', 'water', 'steam'] as NodeId[]) {
      this.nodes.set(nodeId, {
        nodeId,
        state: 'dead',
        lastHeartbeat: 0,
        lastData: null,
      });
    }
  }

  async start(): Promise<void> {
    const sub = this.nc.subscribe('fleet.heartbeat.*');

    (async () => {
      for await (const msg of sub) {
        try {
          const hb = JSON.parse(new TextDecoder().decode(msg.data)) as FleetHeartbeat;
          this.processHeartbeat(hb);
        } catch (err) {
          console.error('[fleet-health] Failed to parse heartbeat:', err);
        }
      }
    })();

    this.checkInterval = setInterval(() => this.checkStale(), 1_000);
    console.log('[fleet-health] Monitoring heartbeats from all nodes');
  }

  private processHeartbeat(hb: FleetHeartbeat): void {
    const node = this.nodes.get(hb.nodeId);
    if (!node) return;

    const previousState = node.state;
    node.lastHeartbeat = Date.now();
    node.lastData = hb;
    node.state = 'alive';

    if (previousState !== 'alive') {
      this.onStateChange(hb.nodeId, previousState, 'alive', 'heartbeat_received');
    }

    // Update agent health in registry
    this.registry.recordPong(hb.nodeId, {
      cpu: hb.cpuPercent,
      memory: { total: 100, used: hb.memPercent },
      taskCount: hb.activeTasks,
    });
  }

  private checkStale(): void {
    const now = Date.now();

    for (const [nodeId, node] of this.nodes) {
      if (node.lastHeartbeat === 0) continue;

      const thresholds = FLEET_HEARTBEAT_THRESHOLDS[nodeId];
      const elapsed = now - node.lastHeartbeat;

      let newState: NodeState = node.state;
      if (elapsed > thresholds.deadMs) {
        newState = 'dead';
      } else if (elapsed > thresholds.suspectMs) {
        newState = 'suspect';
      } else {
        newState = 'alive';
      }

      if (newState !== node.state) {
        const prev = node.state;
        node.state = newState;
        const reason = newState === 'dead'
          ? `no heartbeat for ${Math.round(elapsed / 1000)}s`
          : `heartbeat delayed ${Math.round(elapsed / 1000)}s`;
        this.onStateChange(nodeId, prev, newState, reason);
      }
    }
  }

  private onStateChange(nodeId: NodeId, previous: NodeState, current: NodeState, reason: string): void {
    // Publish state change to NATS
    const change: FleetNodeStateChange = {
      type: 'node.state',
      nodeId,
      previous,
      current,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.nc.publish(
      FLEET_SUBJECTS.nodeState(nodeId),
      new TextEncoder().encode(JSON.stringify(change)),
    );

    console.log(`[fleet-health] ${nodeId}: ${previous} → ${current} (${reason})`);

    // Update boardroom agent registry
    if (current === 'alive') {
      this.queries.updateAgentStatus(nodeId, 'online');
    } else if (current === 'dead') {
      this.queries.updateAgentStatus(nodeId, 'offline');
      this.registry.unregister(nodeId);

      // Requeue tasks from the dead agent
      this.dispatcher.requeueDeadNodeTasks(nodeId);
    }
  }

  getState(nodeId: NodeId): NodeState {
    return this.nodes.get(nodeId)?.state ?? 'dead';
  }

  getAliveNodes(): NodeId[] {
    return [...this.nodes.values()].filter((n) => n.state === 'alive').map((n) => n.nodeId);
  }

  getNodeHealth(nodeId: NodeId): NodeHealth | undefined {
    return this.nodes.get(nodeId);
  }

  getAllHealth(): NodeHealth[] {
    return [...this.nodes.values()];
  }

  stop(): void {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }
}
