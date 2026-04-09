import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { Queries } from '../db/queries.js';
import type { AgentRegistry } from '../agent/registry.js';

export function createAgentRouter(queries: Queries, registry: AgentRegistry): Router {
  const router = Router();

  router.use(authMiddleware);

  // List all agents with status
  router.get('/agents', (_req, res) => {
    const agents = queries.getAllAgents();
    res.json({ agents });
  });

  // Get agent health (last heartbeat data)
  router.get('/agents/:id/health', (req, res) => {
    const agent = queries.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const health = registry.getHealth(req.params.id);
    if (!health) {
      res.json({
        status: 'error',
        uptime: 0,
        gpu: null,
        cpu: 0,
        memory: { total: 0, used: 0 },
        taskCount: 0,
      });
      return;
    }

    res.json(health);
  });

  return router;
}
