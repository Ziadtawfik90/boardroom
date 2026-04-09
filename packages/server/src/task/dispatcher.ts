import type { Task } from '../../../shared/src/types.js';
import { createEnvelope } from '../../../shared/src/protocol.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { Queries } from '../db/queries.js';
import type { DiscussionManager } from '../discussion/manager.js';
import { executeTaskViaSsh } from './ssh-runner.js';
import type { WorkspaceManager } from '../workspace/manager.js';

type BroadcastFn = (envelope: import('../../../shared/src/protocol.js').WsEnvelope) => void;

export class TaskDispatcher {
  private broadcast: BroadcastFn | null = null;
  private discussionManager: DiscussionManager | null = null;
  private workspaceManager: WorkspaceManager | null = null;

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

  dispatch(task: Task): boolean {
    // Try WebSocket first (executor connected)
    const ws = this.registry.getConnection(task.assignee);
    if (ws && ws.readyState === 1) {
      const envelope = createEnvelope('task.created', { task }, 'system');
      ws.send(JSON.stringify(envelope));
      console.log(`[dispatcher] Sent task ${task.id} to ${task.assignee} via WebSocket`);
      this.queries.audit('system', 'dispatch-ws', 'task', task.id, { assignee: task.assignee });
      return true;
    }

    // Verify the agent's PC is reachable before SSH fallback
    // Refuse to dispatch if agent is offline — prevents all tasks running on asus
    const agent = this.queries.getAgent(task.assignee);
    if (agent && agent.status === 'offline') {
      const error = `Agent ${task.assignee} is offline — refusing to dispatch. Each agent must run on its own PC.`;
      console.log(`[dispatcher] ${error}`);
      this.queries.failTask(task.id, error);
      if (this.broadcast) {
        this.broadcast(createEnvelope('task.failed', { taskId: task.id, error }, 'system'));
      }
      return false;
    }

    // Fallback: execute via SSH on the agent's own PC
    console.log(`[dispatcher] Agent ${task.assignee} not connected via WebSocket, using SSH fallback`);
    this.dispatchViaSsh(task);
    return true;
  }

  /** Execute task via SSH — runs async, reports result when done */
  private async dispatchViaSsh(task: Task): Promise<void> {
    // Mark task as running
    this.queries.startTask(task.id);
    this.queries.updateAgentStatus(task.assignee, 'busy');
    this.queries.audit('system', 'dispatch-ssh', 'task', task.id, { assignee: task.assignee });

    // Broadcast that task is running
    if (this.broadcast) {
      this.broadcast(createEnvelope('task.accepted', { taskId: task.id }, task.assignee));
    }

    try {
      const result = await executeTaskViaSsh(task, this.queries, this.workspaceManager ?? undefined);

      if (result.success) {
        // Mark done
        this.queries.completeTask(task.id, { output: result.output, exitCode: result.exitCode });
        this.queries.insertTaskLog(task.id, 'info', 'Task completed via SSH');
        this.queries.updateAgentStatus(task.assignee, 'online');

        console.log(`[dispatcher] SSH task ${task.id} completed on ${task.assignee}`);

        // Broadcast completion
        if (this.broadcast) {
          this.broadcast(createEnvelope('task.completed', { taskId: task.id, result: { output: result.output } }, task.assignee));
        }

        // Post result to discussion
        if (task.discussionId && this.discussionManager) {
          const msg = this.discussionManager.addMessage(
            task.discussionId,
            task.assignee,
            `Task "${task.title}" completed.\n\n${result.output.substring(0, 500)}`,
            'action',
            null,
            { taskId: task.id, result: { output: result.output.substring(0, 1000) } },
          );
          if (this.broadcast) {
            this.broadcast(createEnvelope('message.new', { discussionId: task.discussionId, message: msg }, 'system'));
          }
        }
      } else {
        // Mark failed
        const error = result.output || `SSH execution failed (exit code ${result.exitCode})`;
        this.queries.failTask(task.id, error);
        this.queries.insertTaskLog(task.id, 'error', error);
        this.queries.updateAgentStatus(task.assignee, 'online');

        console.log(`[dispatcher] SSH task ${task.id} failed on ${task.assignee}: ${error.substring(0, 100)}`);

        if (this.broadcast) {
          this.broadcast(createEnvelope('task.failed', { taskId: task.id, error }, task.assignee));
        }

        if (task.discussionId && this.discussionManager) {
          const msg = this.discussionManager.addMessage(
            task.discussionId,
            task.assignee,
            `Task "${task.title}" failed: ${error.substring(0, 300)}`,
            'system',
            null,
            { taskId: task.id, error },
          );
          if (this.broadcast) {
            this.broadcast(createEnvelope('message.new', { discussionId: task.discussionId, message: msg }, 'system'));
          }
        }
      }
    } catch (err) {
      const error = (err as Error).message;
      this.queries.failTask(task.id, error);
      this.queries.updateAgentStatus(task.assignee, 'online');
      console.error(`[dispatcher] SSH task ${task.id} error:`, error);
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
}
