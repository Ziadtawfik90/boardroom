import type { WebSocket } from 'ws';
import type { AgentId, AgentHealth } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';

interface ConnectedAgent {
  ws: WebSocket;
  agentId: AgentId;
  connectedAt: number;
  missedPongs: number;
  lastHealth: AgentHealth | null;
}

export class AgentRegistry {
  private agents = new Map<string, ConnectedAgent>();

  constructor(private queries: Queries) {}

  register(agentId: AgentId, ws: WebSocket): void {
    // Close existing connection if any
    const existing = this.agents.get(agentId);
    if (existing) {
      try { existing.ws.close(); } catch { /* ignore */ }
    }

    this.agents.set(agentId, {
      ws,
      agentId,
      connectedAt: Date.now(),
      missedPongs: 0,
      lastHealth: null,
    });

    this.queries.updateAgentStatus(agentId, 'online');
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    this.queries.updateAgentStatus(agentId, 'offline');
  }

  getConnection(agentId: string): WebSocket | null {
    return this.agents.get(agentId)?.ws ?? null;
  }

  isConnected(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    return agent !== undefined && agent.ws.readyState === 1; // WebSocket.OPEN
  }

  getAllConnected(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  getConnectedIds(): string[] {
    return Array.from(this.agents.keys());
  }

  recordPong(agentId: string, health: Partial<AgentHealth>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.missedPongs = 0;
    agent.lastHealth = {
      status: 'ok',
      uptime: Math.floor((Date.now() - agent.connectedAt) / 1000),
      gpu: health.gpu ?? null,
      cpu: health.cpu ?? 0,
      memory: health.memory ?? { total: 0, used: 0 },
      taskCount: health.taskCount ?? 0,
    };

    this.queries.updateAgentHeartbeat(agentId);
  }

  recordMissedPong(agentId: string): number {
    const agent = this.agents.get(agentId);
    if (!agent) return 0;

    agent.missedPongs += 1;
    return agent.missedPongs;
  }

  getHealth(agentId: string): AgentHealth | null {
    return this.agents.get(agentId)?.lastHealth ?? null;
  }
}
