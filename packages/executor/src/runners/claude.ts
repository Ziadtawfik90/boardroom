import { spawn } from 'node:child_process';
import { logger } from '../logger.js';
import { config } from '../config.js';

export interface ClaudeResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

interface TaskContext {
  title: string;
  description: string;
  discussionMessages?: Array<{ sender: string; content: string }>;
}

async function fetchDiscussionContext(discussionId: string): Promise<Array<{ sender: string; content: string }>> {
  try {
    const httpUrl = config.serverUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace(/\/ws\/?$/, '');

    // Login to get token
    const loginRes = await fetch(`${httpUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: config.agentKey }),
    });
    const { token } = await loginRes.json() as { token: string };

    // Fetch discussion with messages
    const discRes = await fetch(`${httpUrl}/api/v1/discussions/${discussionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await discRes.json() as { messages?: Array<{ sender: string; content: string }> };
    return data.messages ?? [];
  } catch (err) {
    logger.warn('Failed to fetch discussion context', (err as Error).message);
    return [];
  }
}

function buildPrompt(ctx: TaskContext): string {
  const lines: string[] = [
    `You are ${config.agentName} (${config.agentRole}), a Boardroom agent executing a task autonomously.`,
    '',
  ];

  // Include discussion context if available
  if (ctx.discussionMessages && ctx.discussionMessages.length > 0) {
    lines.push('DISCUSSION CONTEXT (what the board discussed before assigning this task):');
    for (const msg of ctx.discussionMessages.slice(-10)) { // last 10 messages
      lines.push(`  [${msg.sender.toUpperCase()}]: ${msg.content}`);
    }
    lines.push('');
  }

  lines.push(
    `TASK: ${ctx.title}`,
    `DETAILS: ${ctx.description}`,
    '',
    'RULES:',
    '- Execute this task immediately. Do NOT ask for clarification.',
    '- If the task involves creating files, create them in the current working directory.',
    '- If the task involves running commands, run them.',
    '- Be concise. Report what you did and the results.',
    '- If you encounter an error, report it clearly.',
  );

  return lines.join('\n');
}

export async function runClaude(
  taskDescription: string,
  onProgress: (chunk: string) => void,
  taskTitle?: string,
  discussionId?: string,
  overrideWorkDir?: string,
): Promise<ClaudeResult> {
  // Fetch discussion context if available
  let discussionMessages: Array<{ sender: string; content: string }> | undefined;
  if (discussionId) {
    discussionMessages = await fetchDiscussionContext(discussionId);
    logger.info(`Fetched ${discussionMessages.length} discussion messages for context`);
  }

  const prompt = buildPrompt({
    title: taskTitle ?? taskDescription,
    description: taskDescription,
    discussionMessages,
  });

  const workDir = overrideWorkDir || process.env['WORK_DIR'] || process.cwd();
  logger.info(`Spawning Claude Code CLI (cwd: ${workDir})`);

  return new Promise((resolve) => {
    // Pipe prompt via stdin — no escaping issues
    const child = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: workDir,
      env: {
        ...process.env,
        PATH: `${process.env['HOME']}/.local/bin:${process.env['HOME']}/.npm-global/bin:/usr/local/bin:${process.env['PATH']}`,
      },
    });

    // Write prompt to stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();

    const chunks: string[] = [];

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      chunks.push(text);
      onProgress(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      chunks.push(`[stderr] ${text}`);
      logger.warn('Claude stderr', text);
    });

    child.on('error', (err: Error) => {
      logger.error('Failed to spawn Claude CLI', err.message);
      resolve({
        success: false,
        output: `Failed to spawn Claude CLI: ${err.message}`,
        exitCode: null,
      });
    });

    child.on('close', (code: number | null) => {
      const output = chunks.join('');
      logger.info(`Claude CLI exited with code ${code}`);
      resolve({
        success: code === 0,
        output,
        exitCode: code,
      });
    });
  });
}
