import type { NatsConnection } from 'nats';
import type { Task } from '../../../shared/src/types.js';
import { createEnvelope } from '../../../shared/src/protocol.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { Queries } from '../db/queries.js';
import type { DiscussionManager } from '../discussion/manager.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { FLEET_SUBJECTS, type FleetTaskDispatch, type FleetTaskCancel, type NodeId } from '../../../shared/src/fleet-types.js';

type BroadcastFn = (envelope: import('../../../shared/src/protocol.js').WsEnvelope) => void;

export class TaskDispatcher {
  private broadcast: BroadcastFn | null = null;
  private discussionManager: DiscussionManager | null = null;
  private workspaceManager: WorkspaceManager | null = null;
  private nc: NatsConnection | null = null;

  constructor(
    private registry: AgentRegistry,
    private queries: Queries,
  ) {}

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  setDiscussionManager(dm: DiscussionManager): void {
    this.discussionManager = dm;
  }

  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm;
  }

  setNats(nc: NatsConnection): void {
    this.nc = nc;
  }

  dispatch(task: Task): boolean {
    // Auto-route if assignee is 'auto' or empty
    if (!task.assignee || task.assignee === ('auto' as any)) {
      const selectedAgent = this.autoRoute(task);
      if (!selectedAgent) {
        console.log(`[dispatcher] No agents available for auto-routing task ${task.id}`);
        this.queries.insertTaskLog(task.id, 'warn', 'No agents available for auto-routing');
        return false;
      }
      this.queries.reassignTask(task.id, selectedAgent);
      task = { ...task, assignee: selectedAgent as any };
      console.log(`[dispatcher] Auto-routed task ${task.id} → ${selectedAgent}`);
    }

    // NATS primary — try it first. Only fall back to WS if NATS is unavailable.
    const natsDispatched = this.dispatchViaNats(task);
    if (natsDispatched) {
      this.queries.audit('system', 'dispatch-nats', 'task', task.id, { assignee: task.assignee });
      return true;
    }

    // Fallback: WebSocket direct send (only if NATS failed)
    const ws = this.registry.getConnection(task.assignee);
    if (ws && ws.readyState === 1) {
      const envelope = createEnvelope('task.created', { task }, 'system');
      ws.send(JSON.stringify(envelope));
      console.log(`[dispatcher] Sent task ${task.id} to ${task.assignee} via WebSocket (NATS unavailable)`);
      this.queries.audit('system', 'dispatch-ws-fallback', 'task', task.id, { assignee: task.assignee });
      return true;
    }

    // Neither NATS nor WS available — check if agent is offline
    const agent = this.queries.getAgent(task.assignee);
    if (agent && agent.status === 'offline') {
      const error = `Agent ${task.assignee} is offline and unreachable via NATS — task remains pending.`;
      console.log(`[dispatcher] ${error}`);
      this.queries.insertTaskLog(task.id, 'warn', error);
      return false;
    }

    // Agent exists but neither transport worked
    console.log(`[dispatcher] No transport available for ${task.assignee}, task ${task.id} remains pending`);
    return false;
  }

  /** Auto-route: pick best agent based on workDir, capabilities, and load */
  private autoRoute(task: Task): string | null {
    // File-partition rules: route based on workDir
    const FILE_PARTITIONS: { prefix: string; preferred: NodeId }[] = [
      { prefix: '/mnt/d/AI/projects/marketingai', preferred: 'water' },
      { prefix: '/mnt/d/AI/brain', preferred: 'steam' },
    ];

    const workDir = this.workspaceManager?.get(task.discussionId ?? '')?.path ?? '';

    // Check file-partition preferences
    const onlineAgents = this.queries.getAllAgents().filter((a) => a.status !== 'offline');
    if (onlineAgents.length === 0) return null;

    const onlineIds = new Set(onlineAgents.map((a) => a.id));

    for (const partition of FILE_PARTITIONS) {
      if (workDir.startsWith(partition.prefix) && onlineIds.has(partition.preferred)) {
        return partition.preferred;
      }
    }

    // Fallback: pick least-loaded online agent
    let bestAgent = onlineAgents[0].id;
    let bestLoad = Infinity;

    for (const agent of onlineAgents) {
      const health = this.registry.getHealth(agent.id);
      const load = health?.taskCount ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestAgent = agent.id;
      }
    }

    return bestAgent;
  }

  /** Dispatch task via NATS pub/sub */
  private dispatchViaNats(task: Task): boolean {
    if (!this.nc) return false;

    const nodeId = task.assignee as NodeId;
    const fleetTask: FleetTaskDispatch = {
      type: 'task.dispatch',
      taskId: task.id,
      nodeId,
      prompt: task.description ?? task.title,
      workDir: this.workspaceManager?.get(task.discussionId ?? '')?.path ?? process.cwd(),
      files: [],
      timeout: 300_000,
      priority: task.priority,
      metadata: {
        discussionId: task.discussionId ?? '',
        title: task.title,
        type: task.type,
      },
      dispatchedAt: new Date().toISOString(),
    };

    try {
      this.nc.publish(
        FLEET_SUBJECTS.taskDispatch(nodeId),
        new TextEncoder().encode(JSON.stringify(fleetTask)),
      );
      console.log(`[dispatcher] Published task ${task.id} to NATS → ${nodeId}`);
      return true;
    } catch (err) {
      console.error(`[dispatcher] NATS publish failed for task ${task.id}:`, (err as Error).message);
      return false;
    }
  }

  /** Dispatch only if all dependencies are met */
  dispatchIfReady(task: Task): boolean {
    if (task.status !== 'approved') return false;

    if (task.dependencies.length > 0) {
      for (const depId of task.dependencies) {
        const dep = this.queries.getTask(depId);
        if (!dep || dep.status !== 'done') {
          console.log(`[dispatcher] Task ${task.id} blocked by dependency ${depId}`);
          return false;
        }
      }
    }

    return this.dispatch(task);
  }

  /** After a task completes, check if any dependent tasks can now be dispatched */
  checkAndDispatchDependents(completedTaskId: string): number {
    const allTasks = this.queries.listTasks({ status: 'approved' });
    let dispatched = 0;

    for (const task of allTasks) {
      if (task.dependencies.includes(completedTaskId)) {
        if (this.dispatchIfReady(task)) {
          dispatched++;
        }
      }
    }

    if (dispatched > 0) {
      console.log(`[dispatcher] ${dispatched} dependent task(s) dispatched after ${completedTaskId} completed`);
    }
    return dispatched;
  }

  dispatchPending(agentId: string): void {
    const tasks = this.queries.listTasks({ status: 'approved', assignee: agentId });
    for (const task of tasks) {
      this.dispatchIfReady(task);
    }
  }

  /** Cancel a running task — sends cancel signal via NATS and updates DB */
  cancelTask(taskId: string, reason = 'user_cancelled'): boolean {
    const task = this.queries.getTask(taskId);
    if (!task) return false;
    if (task.status !== 'running' && task.status !== 'approved' && task.status !== 'pending') return false;

    // Send cancel via NATS
    if (this.nc) {
      const cancel: FleetTaskCancel = {
        type: 'task.cancel',
        taskId,
        nodeId: task.assignee as NodeId,
        reason,
        cancelledAt: new Date().toISOString(),
      };
      this.nc.publish(
        FLEET_SUBJECTS.taskCancel(task.assignee as NodeId),
        new TextEncoder().encode(JSON.stringify(cancel)),
      );
      console.log(`[dispatcher] Published cancel for task ${taskId} → ${task.assignee}`);
    }

    // Also send via WS if connected
    const ws = this.registry.getConnection(task.assignee);
    if (ws && ws.readyState === 1) {
      const envelope = createEnvelope('task.failed', { taskId, error: `Cancelled: ${reason}` }, 'system');
      ws.send(JSON.stringify(envelope));
    }

    // Update DB
    this.queries.failTask(taskId, `Cancelled: ${reason}`);
    this.queries.insertTaskLog(taskId, 'warn', `Task cancelled: ${reason}`);
    this.queries.updateAgentStatus(task.assignee, 'online');

    if (this.broadcast) {
      this.broadcast(createEnvelope('task.failed', { taskId, error: `Cancelled: ${reason}` }, 'system'));
    }

    return true;
  }

  /** Requeue running tasks from a dead agent to another online agent */
  requeueDeadNodeTasks(deadAgentId: string): void {
    const runningTasks = this.queries.listTasks({ status: 'running', assignee: deadAgentId });
    const approvedTasks = this.queries.listTasks({ status: 'approved', assignee: deadAgentId });
    const tasksToRequeue = [...runningTasks, ...approvedTasks];

    if (tasksToRequeue.length === 0) return;

    // Find another online agent
    const onlineAgents = this.registry.getConnectedIds().filter((id) => id !== deadAgentId);

    for (const task of tasksToRequeue) {
      if (onlineAgents.length === 0) {
        const error = `Agent ${deadAgentId} died and no other agents online — task ${task.id} failed`;
        this.queries.failTask(task.id, error);
        this.queries.insertTaskLog(task.id, 'error', error);
        console.log(`[dispatcher] ${error}`);

        if (this.broadcast) {
          this.broadcast(createEnvelope('task.failed', { taskId: task.id, error }, 'system'));
        }
        continue;
      }

      // Pick least-loaded online agent
      const newAssignee = onlineAgents[0]; // Simple: first available
      console.log(`[dispatcher] Requeuing task ${task.id}: ${deadAgentId} → ${newAssignee}`);

      this.queries.insertTaskLog(task.id, 'warn', `Requeued from dead agent ${deadAgentId} to ${newAssignee}`);

      // Update task assignee in DB and re-dispatch
      this.queries.reassignTask(task.id, newAssignee);

      const updatedTask = this.queries.getTask(task.id);
      if (updatedTask) {
        this.dispatch(updatedTask);
      }

      // Publish requeue event to NATS
      if (this.nc) {
        const requeue = {
          type: 'task.requeue',
          taskId: task.id,
          originalNode: deadAgentId,
          reason: 'node_dead',
          requeuedAt: new Date().toISOString(),
        };
        this.nc.publish(
          FLEET_SUBJECTS.taskRequeue,
          new TextEncoder().encode(JSON.stringify(requeue)),
        );
      }
    }
  }
}
