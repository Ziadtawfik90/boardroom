import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../auth/middleware.js';
import type { CommitteeManager } from '../governance/committees.js';
import type { AgentId } from '../../../shared/src/types.js';

const VALID_AGENTS: AgentId[] = ['asus', 'water', 'steam'];

export function createCommitteeRouter(committeeManager: CommitteeManager): Router {
  const router = Router();

  router.use(authMiddleware);

  // List all committees
  router.get('/committees', (_req, res) => {
    const committees = committeeManager.list();
    res.json({ committees });
  });

  // Get committee by ID
  router.get('/committees/:id', (req, res) => {
    const committee = committeeManager.get(req.params.id as string);
    if (!committee) {
      res.status(404).json({ error: 'Committee not found' });
      return;
    }
    res.json(committee);
  });

  // Create committee (admin only)
  router.post('/committees', requireAdmin, (req, res) => {
    const { name, charter, members } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!charter || typeof charter !== 'string') {
      res.status(400).json({ error: 'charter is required' });
      return;
    }
    if (!Array.isArray(members) || members.length === 0) {
      res.status(400).json({ error: 'members must be a non-empty array of agent IDs' });
      return;
    }

    const invalidMembers = members.filter((m: string) => !VALID_AGENTS.includes(m as AgentId));
    if (invalidMembers.length > 0) {
      res.status(400).json({ error: `Invalid agent IDs: ${invalidMembers.join(', ')}` });
      return;
    }

    const committee = committeeManager.create(name, charter, members as AgentId[]);
    res.status(201).json(committee);
  });

  // Update committee (admin only)
  router.patch('/committees/:id', requireAdmin, (req, res) => {
    const existing = committeeManager.get(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: 'Committee not found' });
      return;
    }

    const name = req.body.name ?? existing.name;
    const charter = req.body.charter ?? existing.charter;
    const members = req.body.members ?? existing.members;

    const updated = committeeManager.update(req.params.id as string, name, charter, members);
    res.json(updated);
  });

  // Delete committee (admin only)
  router.delete('/committees/:id', requireAdmin, (req, res) => {
    const deleted = committeeManager.delete(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Committee not found' });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
