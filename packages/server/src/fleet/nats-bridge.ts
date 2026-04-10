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
import { createFleetLogger } from './logger.js';

const log = createFleetLogger('nats-bridge');

type BroadcastFn = (envelope: WsEnvelope) => void;

/** Tracks output sequence per task for ordered reassembly */
interface OutputTracker {
  nextSeq: number;
  buffer: Map<number, FleetTaskOutput>; // out-of-order chunks waiting
  lastActivity: number;
}

export class NatsBridge {
  private outputTrackers = new Map<string, OutputTracker>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private onAllTasksDone: ((discussionId: string) => void) | null = null;

  constructor(
    private nc: NatsConnection,
    private queries: Queries,
    private registry: AgentRegistry,
    private broadcast: BroadcastFn,
  ) {}

  /** Register callback for when all tasks in a discussion complete */
  setOnAllTasksDone(cb: (discussionId: string) => void): void {
    this.onAllTasksDone = cb;
  }

  async start(): Promise<void> {
    this.subscribeTaskAccepted();
    this.subscribeTaskResults();
    this.subscribeTaskOutput();

    // Clean up stale output trackers every 60s
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [taskId, tracker] of this.outputTrackers) {
        if (now - tracker.lastActivity > 300_000) { // 5 min stale
          this.outputTrackers.delete(taskId);
        }
      }
    }, 60_000);

    log.info('Listening for fleet events');
  }

  stop(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
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
              log.error(`Error in ${label} handler:`, (err as Error).message);
            }
          }
        }
      } catch (err) {
        log.error(`Subscription loop died for ${label}:`, (err as Error).message);
        // Re-subscribe after a brief delay
        setTimeout(() => {
          log.info(`Re-subscribing to ${subject}`);
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
    log.info(`Task ${data.taskId} accepted by ${data.nodeId}`);
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

      this.clearOutputTracker(data.taskId);
      log.info(`Task ${data.taskId} completed on ${data.nodeId}`);

      // Check if all tasks for this discussion are done → trigger debrief
      if (this.onAllTasksDone && task.discussionId) {
        const remaining = this.queries.listTasks({ status: 'running' })
          .concat(this.queries.listTasks({ status: 'approved' }))
          .filter(t => t.discussionId === task.discussionId);
        if (remaining.length === 0) {
          log.info(`All tasks done for discussion ${task.discussionId} — triggering debrief`);
          this.onAllTasksDone(task.discussionId);
        }
      }
    } else {
      const error = data.error ?? `Task failed (exit ${data.exitCode})`;
      this.queries.failTask(data.taskId, error);
      this.queries.insertTaskLog(data.taskId, 'error', error);
      this.queries.updateAgentStatus(data.nodeId, 'online');

      this.broadcast(createEnvelope('task.failed', {
        taskId: data.taskId,
        error,
      }, data.nodeId));

      this.clearOutputTracker(data.taskId);
      log.info(`Task ${data.taskId} failed on ${data.nodeId}: ${error.slice(0, 100)}`);
    }
  }

  private handleTaskOutput(data: FleetTaskOutput): void {
    let tracker = this.outputTrackers.get(data.taskId);
    if (!tracker) {
      tracker = { nextSeq: 0, buffer: new Map(), lastActivity: Date.now() };
      this.outputTrackers.set(data.taskId, tracker);
    }
    tracker.lastActivity = Date.now();

    if (data.seq === tracker.nextSeq) {
      // In-order: process immediately, then flush any buffered
      this.emitOutput(data);
      tracker.nextSeq++;

      // Flush consecutive buffered chunks
      while (tracker.buffer.has(tracker.nextSeq)) {
        const buffered = tracker.buffer.get(tracker.nextSeq)!;
        tracker.buffer.delete(tracker.nextSeq);
        this.emitOutput(buffered);
        tracker.nextSeq++;
      }
    } else if (data.seq > tracker.nextSeq) {
      // Out-of-order: buffer for later (cap at 100 to prevent memory leak)
      if (tracker.buffer.size < 100) {
        tracker.buffer.set(data.seq, data);
      }
    }
    // data.seq < tracker.nextSeq → duplicate, ignore
  }

  private emitOutput(data: FleetTaskOutput): void {
    const text = Buffer.from(data.chunk, 'base64').toString('utf-8');

    this.queries.insertTaskLog(data.taskId, 'info', text.slice(0, 500));

    this.broadcast(createEnvelope('task.progress', {
      taskId: data.taskId,
      progress: 0,
      log: text.slice(0, 500),
      seq: data.seq,
      stream: data.stream,
    }, data.nodeId));
  }

  /** Clean up tracker when task finishes */
  clearOutputTracker(taskId: string): void {
    this.outputTrackers.delete(taskId);
  }
}
