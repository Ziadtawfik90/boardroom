import 'dotenv/config';
import type { AgentId } from '@boardroom/shared';

const VALID_AGENT_IDS: ReadonlySet<string> = new Set(['asus', 'water', 'steam']);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAgentId(raw: string): AgentId {
  if (!VALID_AGENT_IDS.has(raw)) {
    throw new Error(`Invalid AGENT_ID "${raw}". Must be one of: asus, water, steam`);
  }
  return raw as AgentId;
}

export const config = {
  agentId: parseAgentId(requireEnv('AGENT_ID')),
  agentKey: requireEnv('AGENT_KEY'),
  serverUrl: requireEnv('SERVER_URL'),
  agentName: process.env['AGENT_NAME'] || requireEnv('AGENT_ID').toUpperCase(),
  agentRole: process.env['AGENT_ROLE'] || 'Executor Agent',

  // NATS — fleet task distribution
  natsUrl: process.env['FLEET_NATS_URL'] ?? 'nats://localhost:4222',
  natsToken: process.env['FLEET_NATS_TOKEN'] ?? '',
  natsEnabled: process.env['FLEET_NATS_ENABLED'] !== 'false',

  // FileSync — rsync between hub (ASUS) and workers
  syncRoot: process.env['FLEET_SYNC_ROOT'] ?? '/mnt/c/fleet-work',
  hubSsh: process.env['FLEET_HUB_SSH'] ?? 'pc1',
  hubPathPrefix: process.env['FLEET_HUB_PATH_PREFIX'] ?? '/mnt/d/AI/',
  isHub: process.env['FLEET_IS_HUB'] === 'true',
  syncRetries: parseInt(process.env['FLEET_SYNC_RETRIES'] ?? '3', 10),
  syncTimeoutSec: parseInt(process.env['FLEET_SYNC_TIMEOUT'] ?? '30', 10),
  syncExtraFlags: (process.env['FLEET_SYNC_FLAGS'] ?? '').split(',').filter(Boolean),
  maxConcurrentTasks: parseInt(process.env['FLEET_MAX_TASKS'] ?? '3', 10),
} as const;
