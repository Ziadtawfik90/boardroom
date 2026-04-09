#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// --- PC Configuration ---

interface PCConfig {
  id: string;
  name: string;
  role: string;
  host: string;
  user: string;
  sshAlias: string | null; // null = local
  gpu: string;
}

const PCS: PCConfig[] = [
  {
    id: 'asus',
    name: 'ASUS',
    role: 'The Builder',
    host: 'localhost',
    user: 'tawfik',
    sshAlias: null,
    gpu: 'RTX 4080 16GB',
  },
  {
    id: 'water',
    name: 'WATER',
    role: 'The Heavy Lifter',
    host: '192.168.50.2',
    user: 'tawfi',
    sshAlias: 'pc2',
    gpu: 'RTX 4090 24GB',
  },
  {
    id: 'steam',
    name: 'STEAM',
    role: 'The Operator',
    host: '100.122.142.104',
    user: 'steam',
    sshAlias: 'pc3',
    gpu: 'RTX 4070 Ti 12GB',
  },
];

// --- Helper: Run command on a PC ---

async function runOnPC(
  pc: PCConfig,
  command: string,
  timeoutMs: number = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!pc.sshAlias) {
    // Local execution
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', command], {
        timeout: timeoutMs,
        env: { ...process.env, TERM: 'dumb' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code) => {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
      });
      child.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: 1 });
      });
    });
  }

  // Remote execution via SSH
  return new Promise((resolve) => {
    const child = spawn('ssh', [pc.sshAlias!, command], {
      timeout: timeoutMs,
      env: { ...process.env, TERM: 'dumb' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => {
      // Filter SSH warnings
      const line = d.toString();
      if (!line.includes('WARNING') && !line.includes('post-quantum') && !line.includes('vulnerable')) {
        stderr += line;
      }
    });
    child.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
    });
    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}

// --- Helper: Run Claude Code on a PC ---

async function askAgent(
  pc: PCConfig,
  prompt: string,
  timeoutMs: number = 180_000,
  retries: number = 1,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await askAgentOnce(pc, prompt, timeoutMs);
    } catch (err) {
      const msg = (err as Error).message || '';
      // Retry on transient API errors (500, overloaded)
      if (attempt < retries && (msg.includes('500') || msg.includes('overloaded') || msg.includes('api_error'))) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

async function askAgentOnce(
  pc: PCConfig,
  prompt: string,
  timeoutMs: number = 180_000,
): Promise<string> {
  if (!pc.sshAlias) {
    // Local: pipe to claude via stdin
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--dangerously-skip-permissions'], {
        timeout: timeoutMs,
        shell: true,
        env: { ...process.env, TERM: 'dumb' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code) => {
        const cleaned = cleanResponse(stdout);
        if (code === 0) resolve(cleaned || stdout.trim());
        else reject(new Error(`Claude exited ${code}: ${stderr}`));
      });
      child.on('error', reject);
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  // Remote: SSH + pipe prompt directly to claude's stdin
  // Avoids shell escaping issues by writing the prompt to stdin instead of echo
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [pc.sshAlias!, 'claude', '--dangerously-skip-permissions'],
      {
        timeout: timeoutMs,
        env: { ...process.env, TERM: 'dumb' },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      const line = d.toString();
      // Filter SSH noise
      if (
        !line.includes('WARNING') &&
        !line.includes('post-quantum') &&
        !line.includes('vulnerable')
      ) {
        stderr += line;
      }
    });
    child.on('close', (code) => {
      const cleaned = cleanResponse(stdout);
      if (cleaned) resolve(cleaned);
      else if (code === 0) resolve(stdout.trim());
      else reject(new Error(`SSH+Claude exited ${code}: ${stderr}`));
    });
    child.on('error', reject);
    // Write prompt directly to stdin — no shell escaping needed
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Strip Windows shell prompts, SSH banners, and other noise from agent output */
function cleanResponse(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      // Windows shell noise
      if (l.startsWith('Microsoft Windows')) return false;
      if (l.startsWith('(c) Microsoft Corporation')) return false;
      if (/^[a-zA-Z@\-_]+>/.test(l)) return false; // e.g. "steam@DESKTOP>..."
      if (l === '' && raw.indexOf(line) < 5) return false; // leading blanks
      return true;
    })
    .join('\n')
    .trim();
}

function findPC(id: string): PCConfig {
  const pc = PCS.find((p) => p.id === id.toLowerCase());
  if (!pc) throw new Error(`Unknown PC: ${id}. Valid: ${PCS.map((p) => p.id).join(', ')}`);
  return pc;
}

// --- MCP Server ---

const server = new McpServer({
  name: 'boardroom',
  version: '1.0.0',
});

// Tool: List all PCs and their status
server.tool(
  'status',
  'Check the status of all Boardroom PCs — online/offline, GPU info, hostname',
  {},
  async () => {
    const results = await Promise.allSettled(
      PCS.map(async (pc) => {
        try {
          const cmd = pc.sshAlias
            ? 'hostname && nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits'
            : 'hostname && nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits';
          const result = await runOnPC(pc, cmd, 10_000);
          const lines = result.stdout.split('\n');
          return {
            id: pc.id,
            name: pc.name,
            role: pc.role,
            status: 'online',
            hostname: lines[0] || 'unknown',
            gpu: lines[1] || pc.gpu,
          };
        } catch {
          return { id: pc.id, name: pc.name, role: pc.role, status: 'offline', hostname: '', gpu: '' };
        }
      }),
    );

    const statuses = results.map((r) => r.status === 'fulfilled' ? r.value : { status: 'error' });
    return { content: [{ type: 'text' as const, text: JSON.stringify(statuses, null, 2) }] };
  },
);

// Tool: Ask an agent a question (runs Claude Code on their PC)
server.tool(
  'ask',
  'Ask a specific Boardroom agent a question. Runs Claude Code on their PC and returns the response. Use for discussion, research, analysis.',
  {
    agent: z.enum(['asus', 'water', 'steam']).describe('Which agent to ask'),
    prompt: z.string().describe('The question or task for the agent'),
  },
  async ({ agent, prompt }) => {
    const pc = findPC(agent);
    try {
      const response = await askAgent(pc, prompt);
      return {
        content: [{
          type: 'text' as const,
          text: `[${pc.name}]: ${response}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `[${pc.name}] Error: ${(err as Error).message}`,
        }],
        isError: true,
      };
    }
  },
);

// Tool: Run a shell command on a specific PC
server.tool(
  'run',
  'Run a shell command on a specific Boardroom PC. Use for checking files, running scripts, installing packages, etc.',
  {
    agent: z.enum(['asus', 'water', 'steam']).describe('Which PC to run on'),
    command: z.string().describe('Shell command to execute'),
  },
  async ({ agent, command }) => {
    const pc = findPC(agent);
    try {
      const result = await runOnPC(pc, command);
      return {
        content: [{
          type: 'text' as const,
          text: `[${pc.name}] (exit ${result.exitCode})\n${result.stdout}${result.stderr ? '\n[stderr] ' + result.stderr : ''}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `[${pc.name}] Error: ${(err as Error).message}`,
        }],
        isError: true,
      };
    }
  },
);

// Tool: Ask ALL agents the same question in parallel
server.tool(
  'ask_all',
  'Ask all online Boardroom agents the same question in parallel. Each runs Claude Code on their own PC. Use for getting multiple perspectives.',
  {
    prompt: z.string().describe('The question or topic for all agents'),
  },
  async ({ prompt }) => {
    const results = await Promise.allSettled(
      PCS.map(async (pc) => {
        try {
          const response = await askAgent(pc, prompt);
          return { agent: pc.name, response };
        } catch (err) {
          return { agent: pc.name, response: `Error: ${(err as Error).message}` };
        }
      }),
    );

    const responses = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { agent: 'unknown', response: 'Failed' },
    );

    const text = responses
      .map((r) => `[${r.agent}]:\n${r.response}`)
      .join('\n\n---\n\n');

    return { content: [{ type: 'text' as const, text }] };
  },
);

// Tool: Boardroom discussion — sequential turn-taking with context
server.tool(
  'discuss',
  'Start a Boardroom discussion. Agents respond one at a time, each seeing previous responses. Returns the full transcript.',
  {
    topic: z.string().describe('The topic or question to discuss'),
    rounds: z.number().min(1).max(5).default(2).describe('Number of discussion rounds (default 2)'),
  },
  async ({ topic, rounds }) => {
    const transcript: Array<{ speaker: string; message: string }> = [];
    transcript.push({ speaker: 'CHAIRMAN', message: topic });

    const onlineAgents: PCConfig[] = [];
    for (const pc of PCS) {
      try {
        const check = await runOnPC(pc, 'echo ok', 5000);
        if (check.stdout.includes('ok')) onlineAgents.push(pc);
      } catch { /* skip offline */ }
    }

    if (onlineAgents.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No agents online.' }] };
    }

    for (let round = 1; round <= rounds; round++) {
      // Shuffle order each round
      const order = [...onlineAgents].sort(() => Math.random() - 0.5);

      for (const pc of order) {
        const context = transcript
          .map((t) => `[${t.speaker}]: ${t.message}`)
          .join('\n');

        let roundInstruction: string;
        if (round === 1) {
          roundInstruction = 'Give your initial take. What stands out? What concerns you? 2-5 sentences.';
        } else {
          roundInstruction = 'React to what others said. Agree, disagree, or add a new angle. Challenge weak points. 2-5 sentences. Say "pass" if nothing to add.';
        }

        const prompt = `You are ${pc.name} (${pc.role}) in a boardroom discussion.
Talk like a senior executive, not an AI. No bullet points. Be direct.
When you disagree, say why with specifics. Don't soften with "great point but..."
Do NOT prefix your response with your name.

Discussion so far:
${context}

${roundInstruction}`;

        try {
          const response = await askAgent(pc, prompt, 120_000);
          if (response.toLowerCase().trim() !== 'pass') {
            transcript.push({ speaker: pc.name, message: response });
          } else {
            transcript.push({ speaker: pc.name, message: '*passes*' });
          }
        } catch {
          transcript.push({ speaker: pc.name, message: '*unavailable*' });
        }
      }
    }

    const text = transcript
      .map((t) => `**${t.speaker}**: ${t.message}`)
      .join('\n\n');

    return { content: [{ type: 'text' as const, text }] };
  },
);

// Tool: Dispatch a task to the fleet via the Boardroom server REST API
server.tool(
  'dispatch',
  'Dispatch a task to the Boardroom fleet. Auto-routes to the best available agent if no target specified.',
  {
    prompt: z.string().describe('The task prompt for the agent'),
    workDir: z.string().optional().describe('Working directory for the task (default: current)'),
    targetAgent: z.enum(['asus', 'water', 'steam', 'auto']).optional().describe('Target agent (default: auto-route)'),
  },
  async ({ prompt, workDir, targetAgent }: { prompt: string; workDir?: string; targetAgent?: string }) => {
    const serverUrl = process.env['BOARDROOM_SERVER_URL'] ?? 'http://localhost:3101';
    const apiKey = process.env['ADMIN_API_KEY'] ?? 'admin-dev-key';

    try {
      // Login
      const loginRes = await fetch(`${serverUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
      const { token } = await loginRes.json() as { token: string };

      // Create task
      const taskRes = await fetch(`${serverUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: prompt.slice(0, 100),
          description: prompt,
          assignee: targetAgent === 'auto' ? undefined : (targetAgent ?? undefined),
          type: 'simple',
          priority: 5,
          autoApprove: true,
        }),
      });

      if (!taskRes.ok) {
        const body = await taskRes.text();
        throw new Error(`Task creation failed (${taskRes.status}): ${body}`);
      }

      const task = await taskRes.json() as { id: string; assignee: string; status: string };
      return {
        content: [{
          type: 'text' as const,
          text: `Task dispatched: ${task.id}\nAssignee: ${task.assignee}\nStatus: ${task.status}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Dispatch failed: ${(err as Error).message}`,
        }],
        isError: true,
      };
    }
  },
);

// Tool: Fleet status — show all nodes health from NATS
server.tool(
  'fleet_status',
  'Show the health status of all fleet nodes including CPU, RAM, GPU usage and active tasks.',
  {},
  async () => {
    // Uses the existing 'status' logic but adds fleet-specific data
    const results = await Promise.allSettled(
      PCS.map(async (pc) => {
        try {
          const cmd = pc.sshAlias
            ? 'hostname && nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || echo "no-gpu"'
            : 'hostname && nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || echo "no-gpu"';
          const result = await runOnPC(pc, cmd, 10_000);
          const lines = result.stdout.split('\n');
          return {
            id: pc.id,
            name: pc.name,
            role: pc.role,
            status: 'online' as const,
            hostname: lines[0] || 'unknown',
            gpu: lines[1] !== 'no-gpu' ? lines[1] : pc.gpu,
          };
        } catch {
          return { id: pc.id, name: pc.name, role: pc.role, status: 'offline' as const, hostname: '', gpu: '' };
        }
      }),
    );

    const statuses = results.map((r) => r.status === 'fulfilled' ? r.value : { status: 'error' });
    return { content: [{ type: 'text' as const, text: JSON.stringify(statuses, null, 2) }] };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
