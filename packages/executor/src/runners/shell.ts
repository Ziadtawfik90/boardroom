import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

export interface ShellResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

// Strict allowlist of commands that can be executed from the network.
// No arbitrary shell strings -- only known-safe binaries.
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'npm',
  'npx',
  'node',
  'python',
  'python3',
  'pip',
  'pip3',
  'git',
  'ls',
  'cat',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'find',
  'grep',
  'wc',
  'head',
  'tail',
  'curl',
  'wget',
  'docker',
  'docker-compose',
]);

export interface ShellCommand {
  binary: string;
  args: string[];
  cwd?: string;
}

export function parseShellCommand(raw: string): ShellCommand | null {
  const parts = raw.trim().split(/\s+/);
  const binary = parts[0];
  if (!binary) return null;

  return {
    binary,
    args: parts.slice(1),
  };
}

export async function runShell(command: ShellCommand): Promise<ShellResult> {
  if (!ALLOWED_COMMANDS.has(command.binary)) {
    logger.warn(`Blocked disallowed command: ${command.binary}`);
    return {
      success: false,
      output: `Command "${command.binary}" is not in the allowlist. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
      exitCode: null,
    };
  }

  logger.info(`Running: ${command.binary} ${command.args.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync(command.binary, command.args, {
      cwd: command.cwd,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
    return { success: true, output, exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr, execErr.message]
      .filter(Boolean)
      .join('\n')
      .trim();

    logger.error(`Shell command failed: ${command.binary}`, output);
    return {
      success: false,
      output: output || 'Unknown error',
      exitCode: execErr.code ?? null,
    };
  }
}
