import { useState, useEffect, useCallback } from 'react';
import { ws } from '../lib/ws';
import * as api from '../lib/api';
import type { Agent, AgentJoinPayload, AgentLeavePayload } from '../types';

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchAgents();
      setAgents(data.agents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    const offJoin = ws.on('agent.join', (env) => {
      const { agent } = env.payload as AgentJoinPayload;
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, status: 'online' as const } : a)),
      );
    });

    const offLeave = ws.on('agent.leave', (env) => {
      const { agentId } = env.payload as AgentLeavePayload;
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, status: 'offline' as const, currentTask: null } : a)),
      );
    });

    return () => {
      offJoin();
      offLeave();
    };
  }, [load]);

  return { agents, loading, refresh: load };
}
