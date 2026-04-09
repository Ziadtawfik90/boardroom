import { spawn } from 'node:child_process';
import type { AgentId, Task, Message } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import type { WorkspaceManager, WorkspaceStatus } from '../workspace/manager.js';
import { pushWorkspaceToRemote, pullWorkspaceFromRemote, remoteWorkspacePath } from './workspace-sync.js';

interface SshResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

/** Resolve SSH alias from agent seed data */
function getAgentSsh(queries: Queries, agentId: AgentId): { sshAlias: string | null; host: string } {
  const agent = queries.getAgent(agentId);
  return { sshAlias: agent?.sshAlias ?? null, host: agent?.host ?? 'localhost' };
}

/** Build a rich prompt with full discussion context and workspace state */
function buildPrompt(
  task: Task,
  agent: { name: string; role: string },
  messages: Message[],
  workspaceStatus?: WorkspaceStatus | null,
  workspacePath?: string,
): string {
  const lines: string[] = [
    `You are ${agent.name} (${agent.role}), a Boardroom agent executing a task autonomously.`,
    '',
  ];

  // Workspace state — what other agents have already built
  if (workspaceStatus && workspaceStatus.files.length > 0) {
    lines.push('WORKSPACE STATE (what has been built so far):');
    lines.push(workspaceStatus.summary);
    lines.push('');
  }

  if (messages.length > 0) {
    lines.push('DISCUSSION CONTEXT:');
    for (const msg of messages.slice(-15)) {
      lines.push(`  [${msg.sender.toUpperCase()}]: ${msg.content}`);
    }
    lines.push('');
  }

  lines.push(
    `TASK: ${task.title}`,
    `DETAILS: ${task.description ?? task.title}`,
    '',
    'RULES:',
    '- Execute this task immediately. Do NOT ask for clarification.',
    '- If the task involves creating files, create them in the current working directory.',
    '- Build on what other agents have already created — check existing files first.',
    '- Be concise. Report what you did and the results.',
  );

  if (workspacePath) {
    lines.push(`- Working directory: ${workspacePath}`);
  }

  return lines.join('\n');
}

/** Strip shell noise from output */
function cleanOutput(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (l.startsWith('Microsoft Windows')) return false;
      if (l.startsWith('(c) Microsoft Corporation')) return false;
      if (/^[a-zA-Z@\-_]+>/.test(l)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/** Run Claude Code on a PC — locally or via SSH */
export function runClaudeOnPC(
  sshAlias: string | null,
  prompt: string,
  timeoutMs: number = 300_000,
  cwd?: string,
): Promise<SshResult> {
  return new Promise((resolve) => {
    let child;

    if (!sshAlias) {
      // Local execution
      child = spawn('claude', ['--dangerously-skip-permissions'], {
        timeout: timeoutMs,
        shell: true,
        cwd: cwd || undefined,
        env: { ...process.env, TERM: 'dumb' },
      });
    } else {
      // Remote via SSH — pipe prompt to stdin
      // If cwd is provided, prepend cd so claude runs in the right directory
      const remoteCmd = cwd
        ? `cd /d "${cwd}" && claude --dangerously-skip-permissions`
        : 'claude --dangerously-skip-permissions';
      child = spawn('ssh', [sshAlias, remoteCmd], {
        timeout: timeoutMs,
        env: { ...process.env, TERM: 'dumb' },
      });
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => {
      const line = d.toString();
      if (!line.includes('WARNING') && !line.includes('post-quantum') && !line.includes('vulnerable')) {
        stderr += line;
      }
    });

    child.on('close', (code) => {
      const output = cleanOutput(stdout) || stdout.trim();
      resolve({
        success: code === 0,
        output: output || stderr,
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: `Failed: ${err.message}`,
        exitCode: null,
      });
    });

    // Pipe prompt via stdin — avoids all escaping issues
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Run a shell command on a PC — locally or via SSH */
export function runCommandOnPC(
  sshAlias: string | null,
  command: string,
  timeoutMs: number = 120_000,
): Promise<SshResult> {
  return new Promise((resolve) => {
    let child;

    if (!sshAlias) {
      child = spawn('bash', ['-c', command], {
        timeout: timeoutMs,
        env: { ...process.env, TERM: 'dumb' },
      });
    } else {
      child = spawn('ssh', [sshAlias, command], {
        timeout: timeoutMs,
        env: { ...process.env, TERM: 'dumb' },
      });
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim() || stderr.trim(),
        exitCode: code,
      });
    });
    child.on('error', (err) => {
      resolve({ success: false, output: err.message, exitCode: null });
    });
  });
}

/** Execute a Boardroom task on the assigned agent's PC via SSH */
export async function executeTaskViaSsh(
  task: Task,
  queries: Queries,
  workspaceManager?: WorkspaceManager,
): Promise<SshResult> {
  const { sshAlias } = getAgentSsh(queries, task.assignee);

  // SAFETY: Remote agents (water, steam) MUST execute on their own PCs via SSH.
  // Never fall back to local execution — that would overload the asus PC.
  if (!sshAlias && task.assignee !== 'asus') {
    return {
      success: false,
      output: `Refused: agent ${task.assignee} has no SSH alias — cannot run locally. Each agent must execute on its own PC.`,
      exitCode: null,
    };
  }

  const agent = queries.getAgent(task.assignee);
  const agentInfo = { name: agent?.name ?? task.assignee.toUpperCase(), role: agent?.role ?? 'Agent' };

  // Get discussion context
  let messages: Message[] = [];
  if (task.discussionId) {
    messages = queries.getMessages(task.discussionId, 15);
  }

  // Get workspace info
  let workspaceStatus: WorkspaceStatus | null = null;
  let workspacePath: string | undefined;
  if (task.discussionId && workspaceManager) {
    const ws = workspaceManager.get(task.discussionId);
    if (ws) {
      workspacePath = ws.path;
      workspaceStatus = workspaceManager.getStatus(task.discussionId);
    }
  }

  // Detect if this is a simple shell command or needs Claude
  const desc = (task.description ?? task.title).toLowerCase();
  const isShellCommand = /^(df |ls |cat |docker |nvidia-smi|systemctl|tailscale|ping |free |top |iostat|ps |uptime|hostname|whoami|pwd|echo )/.test(desc);

  if (isShellCommand && task.type === 'simple') {
    console.log(`[ssh-runner] Running shell command on ${task.assignee} (ssh: ${sshAlias ?? 'local'})`);
    // For shell commands on remote PCs, run remotely. For local, use workspace cwd if available.
    return runCommandOnPC(sshAlias, task.description ?? task.title);
  }

  // Complex task — run Claude on the agent's actual PC with full context

  // For remote agents: sync workspace to their PC before running
  let effectiveCwd = workspacePath;
  if (sshAlias && workspacePath && task.discussionId) {
    await pushWorkspaceToRemote(sshAlias, workspacePath, task.discussionId);
    // Remote agent works in their local copy
    effectiveCwd = remoteWorkspacePath(task.discussionId);
  }

  const prompt = buildPrompt(task, agentInfo, messages, workspaceStatus, effectiveCwd);
  console.log(`[ssh-runner] Running Claude on ${task.assignee} (ssh: ${sshAlias ?? 'local'}, context: ${messages.length} msgs, cwd: ${effectiveCwd ?? 'none'})`);

  // Execute on the agent's PC via SSH (or locally for ASUS)
  const result = await runClaudeOnPC(sshAlias, prompt, 300_000, effectiveCwd);

  // For remote agents: pull results back after successful execution
  if (sshAlias && workspacePath && task.discussionId && result.success) {
    await pullWorkspaceFromRemote(sshAlias, task.discussionId, workspacePath);
  }

  // Auto-commit changes to workspace
  if (result.success && workspacePath && workspaceManager && task.discussionId) {
    const committed = workspaceManager.commitChanges(
      task.discussionId,
      agentInfo.name,
      task.title,
    );
    if (committed) {
      console.log(`[ssh-runner] Auto-committed changes by ${agentInfo.name}`);
    }
  }

  return result;
}
