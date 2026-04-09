import type { Task, WsMessageType, TaskProgressPayload, TaskCompletedPayload, TaskFailedPayload, TaskAcceptedPayload } from '@boardroom/shared';
import type { Connection } from './connection.js';
import { runClaude } from './runners/claude.js';
import { runGit, parseGitCommand } from './runners/git.js';
import { runShell, parseShellCommand } from './runners/shell.js';
import { logger } from './logger.js';

type RunnerType = 'claude' | 'shell' | 'git';

const activeTasks = new Map<string, boolean>();

export function getActiveTaskCount(): number {
  return activeTasks.size;
}

function detectRunner(task: Task): RunnerType {
  const desc = (task.description ?? task.title).toLowerCase();

  // Git operations
  if (desc.startsWith('git ') || /\b(clone|checkout|pull|push)\b.*\brepo\b/i.test(desc)) {
    return 'git';
  }

  // Explicit shell commands (starts with a known binary)
  const shellMatch = parseShellCommand(desc);
  if (shellMatch && ['npm', 'npx', 'node', 'python', 'python3', 'docker'].includes(shellMatch.binary)) {
    return 'shell';
  }

  // Default to Claude for complex/natural-language tasks
  return 'claude';
}

export async function executeTask(task: Task, conn: Connection): Promise<void> {
  if (activeTasks.has(task.id)) {
    logger.warn(`Task ${task.id} is already running, skipping`);
    return;
  }

  activeTasks.set(task.id, true);
  const runner = detectRunner(task);
  logger.info(`Executing task ${task.id} (${task.title}) with runner: ${runner}`);

  // Accept the task
  conn.send<TaskAcceptedPayload>('task.accepted' as WsMessageType, { taskId: task.id });

  try {
    let result: Record<string, unknown>;

    switch (runner) {
      case 'claude': {
        const description = task.description ?? task.title;
        let progressPct = 0;
        const claudeResult = await runClaude(description, (chunk) => {
          progressPct = Math.min(progressPct + 5, 95);
          conn.send<TaskProgressPayload>('task.progress' as WsMessageType, {
            taskId: task.id,
            progress: progressPct,
            log: chunk.slice(0, 500),
          });
        }, task.title, task.discussionId ?? undefined);

        if (!claudeResult.success) {
          throw new Error(claudeResult.output || `Claude exited with code ${claudeResult.exitCode}`);
        }
        result = { output: claudeResult.output, exitCode: claudeResult.exitCode };
        break;
      }

      case 'git': {
        const gitCmd = parseGitCommand(task.description ?? task.title);
        if (!gitCmd) {
          throw new Error(`Could not parse git command from: ${task.description ?? task.title}`);
        }
        conn.send<TaskProgressPayload>('task.progress' as WsMessageType, {
          taskId: task.id,
          progress: 50,
          log: `Running git ${gitCmd.operation}...`,
        });
        const gitResult = await runGit(gitCmd);
        if (!gitResult.success) {
          throw new Error(gitResult.output);
        }
        result = { output: gitResult.output };
        break;
      }

      case 'shell': {
        const shellCmd = parseShellCommand(task.description ?? task.title);
        if (!shellCmd) {
          throw new Error(`Could not parse shell command from: ${task.description ?? task.title}`);
        }
        conn.send<TaskProgressPayload>('task.progress' as WsMessageType, {
          taskId: task.id,
          progress: 50,
          log: `Running ${shellCmd.binary}...`,
        });
        const shellResult = await runShell(shellCmd);
        if (!shellResult.success) {
          throw new Error(shellResult.output);
        }
        result = { output: shellResult.output, exitCode: shellResult.exitCode };
        break;
      }
    }

    conn.send<TaskCompletedPayload>('task.completed' as WsMessageType, {
      taskId: task.id,
      result,
    });
    logger.info(`Task ${task.id} completed successfully`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Task ${task.id} failed`, errorMessage);
    conn.send<TaskFailedPayload>('task.failed' as WsMessageType, {
      taskId: task.id,
      error: errorMessage,
    });
  } finally {
    activeTasks.delete(task.id);
  }
}
