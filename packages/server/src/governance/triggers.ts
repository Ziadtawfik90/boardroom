import type { Task } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import type { BoardSecretary } from './secretary.js';
import { config } from '../config.js';

export type TriggerDecision = 'none' | 'emergency' | 'review';

export class MeetingTriggers {
  private recentFailures: Array<{ taskId: string; timestamp: number }> = [];
  private reportedStuck = new Set<string>();

  constructor(
    private queries: Queries,
    private secretary: BoardSecretary,
  ) {}

  /** Evaluate whether a task failure should trigger an emergency meeting */
  evaluateTaskFailure(task: Task): TriggerDecision {
    const now = Date.now();

    // Track recent failures (sliding 1-hour window)
    this.recentFailures.push({ taskId: task.id, timestamp: now });
    this.recentFailures = this.recentFailures.filter(
      f => now - f.timestamp < 3_600_000,
    );

    // Critical task (high priority) fails → immediate emergency
    if (task.priority >= 8) {
      console.log(`[triggers] Critical task failed (priority=${task.priority}): ${task.title}`);
      this.secretary.callEmergencyMeeting(
        `Critical task failed: ${task.title}`,
        { taskId: task.id, error: task.error, priority: task.priority, assignee: task.assignee },
      );
      return 'emergency';
    }

    // Threshold failures in last hour → emergency meeting
    if (this.recentFailures.length >= config.emergencyFailureThreshold) {
      console.log(`[triggers] ${this.recentFailures.length} failures in last hour (threshold=${config.emergencyFailureThreshold})`);
      this.secretary.callEmergencyMeeting(
        `${this.recentFailures.length} task failures in the last hour`,
        {
          failedTasks: this.recentFailures.map(f => f.taskId),
          threshold: config.emergencyFailureThreshold,
        },
      );
      // Reset counter after triggering
      this.recentFailures = [];
      return 'emergency';
    }

    return 'none';
  }

  /** Evaluate agent health degradation */
  evaluateHealthDegradation(
    agentId: string,
    health: { cpu: number; memory: { total: number; used: number }; taskCount: number },
  ): TriggerDecision {
    // Agent has high CPU and active tasks — potential issue
    if (health.cpu > 95 && health.taskCount > 0) {
      console.log(`[triggers] Agent ${agentId} CPU critical (${health.cpu}%) with ${health.taskCount} active tasks`);
      return 'review';
    }

    // Memory critical (>95% used)
    if (health.memory.total > 0) {
      const memPercent = (health.memory.used / health.memory.total) * 100;
      if (memPercent > 95 && health.taskCount > 0) {
        console.log(`[triggers] Agent ${agentId} memory critical (${memPercent.toFixed(0)}%)`);
        return 'review';
      }
    }

    return 'none';
  }

  /** Check for stuck tasks (running too long with no progress) */
  evaluateStuckTasks(): TriggerDecision {
    const runningTasks = this.queries.listTasks({ status: 'running' });
    const now = Date.now();

    for (const task of runningTasks) {
      if (!task.startedAt) continue;
      const elapsed = now - new Date(task.startedAt).getTime();

      if (elapsed > config.emergencyTaskTimeoutMs && task.progress < 10) {
        // Don't trigger repeatedly for the same task — mark it as failed
        if (this.reportedStuck.has(task.id)) continue;
        this.reportedStuck.add(task.id);

        console.log(`[triggers] Task ${task.id} stuck: running ${Math.round(elapsed / 60_000)}min — marking as failed`);

        // Mark the stuck task as failed instead of creating infinite emergency meetings
        this.queries.failTask(task.id, `Task timed out after ${Math.round(elapsed / 60_000)} minutes with ${task.progress}% progress`);

        return 'review';
      }
    }

    return 'none';
  }
}
