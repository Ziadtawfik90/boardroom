import { v4 as uuidv4 } from 'uuid';
import { createEnvelope } from '../../../shared/src/protocol.js';
import type { WsEnvelope } from '../../../shared/src/protocol.js';
import type { Task } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import type { DiscussionManager } from '../discussion/manager.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { config } from '../config.js';

type BroadcastFn = (envelope: WsEnvelope) => void;

export type ReconveneDecision = 'yes' | 'no' | 'emergency';

interface ReconveneState {
  discussionId: string;
  timer: ReturnType<typeof setTimeout>;
}

// Forward reference — set after orchestrator is created to avoid circular deps
type ReconveneFn = (discussionId: string, trigger: string, actionLog: string) => void;

export class BoardSecretary {
  private pendingReconvenes = new Map<string, ReconveneState>();
  private reconveneCounts = new Map<string, number>();
  private onReconvene: ReconveneFn | null = null;
  private workspaceManager: WorkspaceManager | null = null;

  constructor(
    private queries: Queries,
    private discussionManager: DiscussionManager,
    private dispatcher: TaskDispatcher,
    private broadcast: BroadcastFn,
  ) {}

  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm;
  }

  setReconveneHandler(fn: ReconveneFn): void {
    this.onReconvene = fn;
  }

  /** Evaluate whether a discussion should reconvene based on task states */
  evaluateReconvene(discussionId: string): ReconveneDecision {
    const tasks = this.queries.listTasksByDiscussion(discussionId);
    if (tasks.length === 0) return 'no';

    const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'approved');
    const hasFailed = tasks.some(t => t.status === 'failed');
    const allDone = tasks.every(t => t.status === 'done' || t.status === 'cancelled' || t.status === 'failed');

    if (hasFailed) return 'emergency';
    if (allDone) return 'yes';
    if (hasRunning) return 'no'; // still in progress

    return 'no';
  }

  /** Build a structured action log summary for the board */
  buildActionLogSummary(discussionId: string): string {
    const tasks = this.queries.listTasksByDiscussion(discussionId);
    if (tasks.length === 0) return 'No tasks to report.';

    const completed = tasks.filter(t => t.status === 'done');
    const failed = tasks.filter(t => t.status === 'failed');
    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'approved');
    const running = tasks.filter(t => t.status === 'running');

    const lines: string[] = ['ACTION LOG REVIEW'];
    lines.push('─'.repeat(40));

    if (completed.length > 0) {
      lines.push(`\nCOMPLETED (${completed.length}):`);
      for (const t of completed) {
        const result = t.result ? ` → ${JSON.stringify(t.result).slice(0, 100)}` : '';
        lines.push(`  ✓ ${t.assignee.toUpperCase()}: ${t.title}${result}`);
      }
    }

    if (failed.length > 0) {
      lines.push(`\nFAILED (${failed.length}):`);
      for (const t of failed) {
        lines.push(`  ✗ ${t.assignee.toUpperCase()}: ${t.title} — ${t.error ?? 'unknown error'}`);
      }
    }

    if (running.length > 0) {
      lines.push(`\nSTILL RUNNING (${running.length}):`);
      for (const t of running) {
        lines.push(`  ⟳ ${t.assignee.toUpperCase()}: ${t.title} (${t.progress}%)`);
      }
    }

    if (pending.length > 0) {
      lines.push(`\nPENDING (${pending.length}):`);
      for (const t of pending) {
        lines.push(`  ○ ${t.assignee.toUpperCase()}: ${t.title}`);
      }
    }

    // Include workspace state if available
    if (this.workspaceManager) {
      const wsStatus = this.workspaceManager.getStatus(discussionId);
      if (wsStatus && wsStatus.files.length > 0) {
        lines.push('');
        lines.push('WORKSPACE STATE:');
        lines.push(wsStatus.summary);
      }
    }

    lines.push('─'.repeat(40));
    return lines.join('\n');
  }

  /** Trigger reconvene for a discussion (with batching delay for success, immediate for failure) */
  triggerReconvene(discussionId: string, trigger: 'results' | 'failure'): void {
    // Check reconvene cap
    const count = this.reconveneCounts.get(discussionId) ?? 0;
    if (count >= config.maxReconvenes) {
      console.log(`[secretary] Discussion ${discussionId} hit reconvene cap (${count}/${config.maxReconvenes}), escalating to chairman`);
      const sysMsg = this.discussionManager.addMessage(
        discussionId,
        'system',
        `Reconvene limit reached (${count} reconvenes). Chairman intervention required.`,
        'system',
      );
      this.broadcast(createEnvelope('message.new', { discussionId, message: sysMsg }, 'system'));
      return;
    }

    // Cancel any pending reconvene timer for this discussion
    const existing = this.pendingReconvenes.get(discussionId);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingReconvenes.delete(discussionId);
    }

    const delay = trigger === 'failure' ? 0 : config.reconveneBatchDelayMs;

    const timer = setTimeout(() => {
      this.pendingReconvenes.delete(discussionId);
      this.executeReconvene(discussionId, trigger);
    }, delay);

    this.pendingReconvenes.set(discussionId, { discussionId, timer });
  }

  private executeReconvene(discussionId: string, trigger: string): void {
    const count = (this.reconveneCounts.get(discussionId) ?? 0) + 1;
    this.reconveneCounts.set(discussionId, count);

    const actionLog = this.buildActionLogSummary(discussionId);

    console.log(`[secretary] Reconvening discussion ${discussionId} (trigger=${trigger}, reconvene #${count})`);

    if (this.onReconvene) {
      this.onReconvene(discussionId, trigger, actionLog);
    }
  }

  /** Create an emergency meeting for critical issues */
  callEmergencyMeeting(reason: string, context: Record<string, unknown>): string {
    const discussion = this.discussionManager.create(
      `EMERGENCY: ${reason}`,
      JSON.stringify({
        text: reason,
        objective: 'decide',
        background: JSON.stringify(context),
        keyQuestion: `How do we resolve: ${reason}?`,
        constraints: 'This is an emergency. Prioritize immediate action.',
      }),
      'system',
    );

    console.log(`[secretary] Emergency meeting created: ${discussion.id} — ${reason}`);
    this.queries.audit('system', 'emergency-meeting', 'discussion', discussion.id, { reason, context });

    return discussion.id;
  }

  /** Handle task completion — check deps and evaluate reconvene */
  onTaskCompleted(task: Task): void {
    // Dispatch dependent tasks
    this.dispatcher.checkAndDispatchDependents(task.id);

    // Evaluate reconvene
    if (task.discussionId) {
      const decision = this.evaluateReconvene(task.discussionId);
      if (decision === 'yes') {
        this.triggerReconvene(task.discussionId, 'results');
      }
    }
  }

  /** Handle task failure — evaluate reconvene with emergency bias */
  onTaskFailed(task: Task): void {
    if (task.discussionId) {
      const decision = this.evaluateReconvene(task.discussionId);
      if (decision === 'emergency') {
        this.triggerReconvene(task.discussionId, 'failure');
      }
    }
  }
}
