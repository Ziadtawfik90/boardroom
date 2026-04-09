import { execSync } from 'node:child_process';
import type { Queries } from '../db/queries.js';
import type { AgentId } from '../../../shared/src/types.js';

const LOCAL_AGENTS: Array<{ id: AgentId; sshAlias: string | null }> = [
  { id: 'asus', sshAlias: null },
  { id: 'water', sshAlias: 'pc2' },
  { id: 'steam', sshAlias: 'pc3' },
];

/** Check if an agent's PC is reachable via SSH (or locally) */
function isReachable(sshAlias: string | null): boolean {
  try {
    if (!sshAlias) {
      return true; // local is always reachable
    }
    execSync(`ssh -o ConnectTimeout=5 -o BatchMode=yes ${sshAlias} "echo ok"`, {
      stdio: 'pipe',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Periodically check SSH reachability and update agent status */
export class SshHealthService {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private queries: Queries) {}

  start(intervalMs: number = 30_000): void {
    // Run immediately
    this.check();
    // Then periodically
    this.interval = setInterval(() => this.check(), intervalMs);
    console.log(`[ssh-health] Started (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private check(): void {
    for (const agent of LOCAL_AGENTS) {
      const reachable = isReachable(agent.sshAlias);
      const current = this.queries.getAgent(agent.id);
      // Only update if agent is not already connected via WebSocket (don't override WS status)
      if (current && current.status === 'offline') {
        if (reachable) {
          this.queries.updateAgentStatus(agent.id, 'online');
          this.queries.updateAgentHeartbeat(agent.id);
        }
      } else if (current && current.status === 'online' && !reachable) {
        // Only mark offline if not connected via WebSocket
        // (WebSocket registry handles its own status)
        this.queries.updateAgentStatus(agent.id, 'offline');
      }
    }
  }
}
