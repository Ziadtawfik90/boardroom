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
} as const;
