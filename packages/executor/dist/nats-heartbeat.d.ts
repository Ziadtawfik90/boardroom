/**
 * NATS Heartbeat — publishes system metrics to fleet.heartbeat.{nodeId} every 5s.
 *
 * Adapted from fleet-command/daemon/src/heartbeat.ts
 */
import type { NatsConnection } from 'nats';
import type { NodeId } from '@boardroom/shared';
export declare function startNatsHeartbeat(nc: NatsConnection, nodeId: NodeId, getActiveTasks: () => number, version?: string): NodeJS.Timeout;
//# sourceMappingURL=nats-heartbeat.d.ts.map