/**
 * NATS Bridge — translates fleet NATS events into boardroom's WS broadcast + DB updates.
 *
 * Subscribes to:
 *   fleet.task.accepted.*  → marks task running in DB, broadcasts to WS
 *   fleet.task.result.*    → completes/fails task in DB, broadcasts to WS
 *   fleet.task.output.*.*  → forwards progress to WS dashboard
 *   fleet.heartbeat.*      → updates agent health (handled by FleetHealthMonitor)
 */

import type { NatsConnection } from 'nats';
import type { Queries } from '../db/queries.js';
import type { AgentRegistry } from '../agent/registry.js';
import { createEnvelope, type WsEnvelope } from '../../../shared/src/protocol.js';
import type {
  FleetTaskAccepted,
  FleetTaskResult,
  FleetTaskOutput,
} from '../../../shared/src/fleet-types.js';

type BroadcastFn = (envelope: WsEnvelope) => void;

export class NatsBridge {
  constructor(
    private nc: NatsConnection,
    private queries: Queries,
    private registry: AgentRegistry,
    private broadcast: BroadcastFn,
  ) {}

  async start(): Promise<void> {
    this.subscribeTaskAccepted();
    this.subscribeTaskResults();
    this.subscribeTaskOutput();
    console.log('[nats-bridge] Listening for fleet events');
  }

  private subscribeTaskAccepted(): void {
    this.resilientSubscribe('fleet.task.accepted.*', 'task-accepted', (msg) => {
      const data = JSON.parse(new TextDecoder().decode(msg.data)) as FleetTaskAccepted;
      this.handleTaskAccepted(data);
    });
  }

  private subscribeTaskResults(): void {
    this.resilientSubscribe('fleet.task.result.*', 'task-result', (msg) => {
      const data = JSON.parse(new TextDecoder().decode(msg.data)) as FleetTaskResult;
      this.handleTaskResult(data);
    });
  }

  private subscribeTaskOutput(): void {
    this.resilientSubscribe('fleet.task.output.*.*', 'task-output', (msg) => {
      const data = JSON.parse(new TextDecoder().decode(msg.data)) as FleetTaskOutput;
      this.handleTaskOutput(data);
    }, true); // silent = true for high-frequency output
  }

  /** Wraps NATS subscription in error boundary that logs and continues */
  private resilientSubscribe(
    subject: string,
    label: string,
    handler: (msg: import('nats').Msg) => void,
    silent = false,
  ): void {
    const sub = this.nc.subscribe(subject);
    (async () => {
      try {
        for await (const msg of sub) {
          try {
            handler(msg);
          } catch (err) {
            if (!silent) {
              console.error(`[nats-bridge] Error in ${label} handler:`, (err as Error).message);
            }
          }
        }
      } catch (err) {
        console.error(`[nats-bridge] Subscription loop died for ${label}:`, (err as Error).message);
        // Re-subscribe after a brief delay
        setTimeout(() => {
          console.log(`[nats-bridge] Re-subscribing to ${subject}`);
          this.resilientSubscribe(subject, label, handler, silent);
        }, 2_000);
      }
    })();
  }

  private handleTaskAccepted(data: FleetTaskAccepted): void {
    const task = this.queries.getTask(data.taskId);
    if (!task) return;

    // Skip if already handled via WS
    if (task.status === 'running') return;

    this.queries.startTask(data.taskId);
    this.queries.insertTaskLog(data.taskId, 'info', `Task accepted by ${data.nodeId} via NATS (PID ${data.pid})`);
    this.queries.updateAgentStatus(data.nodeId, 'busy');

    this.broadcast(createEnvelope('task.accepted', { taskId: data.taskId }, data.nodeId));
    console.log(`[nats-bridge] Task ${data.taskId} accepted by ${data.nodeId}`);
  }

  private handleTaskResult(data: FleetTaskResult): void {
    const task = this.queries.getTask(data.taskId);
    if (!task) return;

    // Skip if already completed via WS
    if (task.status === 'done' || task.status === 'failed') return;

    if (data.status === 'completed') {
      this.queries.completeTask(data.taskId, {
        output: '',
        exitCode: data.exitCode,
        filesChanged: data.filesChanged,
        durationMs: data.durationMs,
      });
      this.queries.insertTaskLog(data.taskId, 'info', `Task completed via NATS (${data.durationMs}ms, ${data.filesChanged.length} files changed)`);
      this.queries.updateAgentStatus(data.nodeId, 'online');

      this.broadcast(createEnvelope('task.completed', {
        taskId: data.taskId,
        result: { exitCode: data.exitCode, filesChanged: data.filesChanged },
      }, data.nodeId));

      console.log(`[nats-bridge] Task ${data.taskId} completed on ${data.nodeId}`);
    } else {
      const error = data.error ?? `Task failed (exit ${data.exitCode})`;
      this.queries.failTask(data.taskId, error);
      this.queries.insertTaskLog(data.taskId, 'error', error);
      this.queries.updateAgentStatus(data.nodeId, 'online');

      this.broadcast(createEnvelope('task.failed', {
        taskId: data.taskId,
        error,
      }, data.nodeId));

      console.log(`[nats-bridge] Task ${data.taskId} failed on ${data.nodeId}: ${error.slice(0, 100)}`);
    }
  }

  private handleTaskOutput(data: FleetTaskOutput): void {
    // Decode base64 chunk and forward as task progress to WS
    const text = Buffer.from(data.chunk, 'base64').toString('utf-8');

    // Update progress in DB
    this.queries.insertTaskLog(data.taskId, 'info', text.slice(0, 500));

    // Broadcast to WS as task.progress
    this.broadcast(createEnvelope('task.progress', {
      taskId: data.taskId,
      progress: 0, // We don't know exact progress from NATS output
      log: text.slice(0, 500),
    }, data.nodeId));
  }
}
