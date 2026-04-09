import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import type { AgentHealth, HeartbeatPongPayload } from '@boardroom/shared';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const startTime = Date.now();

interface GpuInfo {
  name: string;
  memoryTotal: number;
  memoryUsed: number;
  temperature: number;
}

async function getGpuInfo(): Promise<GpuInfo | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 5000, shell: true });

    const line = stdout.trim().split('\n')[0];
    if (!line) return null;

    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 4) return null;

    return {
      name: parts[0]!,
      memoryTotal: parseInt(parts[1]!, 10),
      memoryUsed: parseInt(parts[2]!, 10),
      temperature: parseInt(parts[3]!, 10),
    };
  } catch {
    // nvidia-smi not available or failed
    return null;
  }
}

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    totalIdle += cpu.times.idle;
    totalTick += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

export async function collectHealth(taskCount: number): Promise<AgentHealth> {
  const gpu = await getGpuInfo();
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const usedMem = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
  const cpu = getCpuUsage();

  return {
    status: cpu > 90 || usedMem / totalMem > 0.95 ? 'degraded' : 'ok',
    uptime: Math.round((Date.now() - startTime) / 1000),
    gpu,
    cpu,
    memory: { total: totalMem, used: usedMem },
    taskCount,
  };
}

export async function collectPongPayload(taskCount: number): Promise<HeartbeatPongPayload> {
  const health = await collectHealth(taskCount);
  return {
    load: {
      cpu: health.cpu,
      mem: Math.round((health.memory.used / health.memory.total) * 100),
      gpu: health.gpu ? Math.round((health.gpu.memoryUsed / health.gpu.memoryTotal) * 100) : null,
    },
    taskCount,
  };
}

logger.debug('Health module initialized');
