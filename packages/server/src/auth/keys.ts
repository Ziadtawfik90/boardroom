import { config } from '../config.js';
import type { AgentId, Sender } from '../../../shared/src/types.js';

export interface ApiKeyIdentity {
  type: 'admin' | 'agent';
  sender: Sender;
  agentId: AgentId | null;
}

export function validateApiKey(apiKey: string): ApiKeyIdentity | null {
  if (apiKey === config.adminApiKey) {
    return { type: 'admin', sender: 'user', agentId: null };
  }

  for (const [agentId, key] of Object.entries(config.agentKeys)) {
    if (apiKey === key) {
      return { type: 'agent', sender: agentId as Sender, agentId: agentId as AgentId };
    }
  }

  return null;
}
