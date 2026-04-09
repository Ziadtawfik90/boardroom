import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../auth/middleware.js';
import { createDiscussionSchema } from '../../../shared/src/validation.js';
import { createEnvelope } from '../../../shared/src/protocol.js';
import type { Queries } from '../db/queries.js';
import type { BroadcastFn } from './router.js';

export function createDiscussionRouter(queries: Queries, broadcast?: BroadcastFn): Router {
  const router = Router();

  router.use(authMiddleware);

  // List discussions
  router.get('/discussions', (req, res) => {
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = queries.listDiscussions(status, limit, offset);
    res.json(result);
  });

  // Create discussion
  router.post('/discussions', (req, res) => {
    const parsed = createDiscussionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const id = uuidv4();
    const sender = req.auth!.sender;
    const topicData = JSON.stringify({
      text: parsed.data.topic || '',
      objective: parsed.data.objective || 'brainstorm',
      background: parsed.data.background || '',
      keyQuestion: parsed.data.keyQuestion || '',
      constraints: parsed.data.constraints || '',
      workspacePath: parsed.data.workspacePath || '',
    });
    const discussion = queries.insertDiscussion(id, parsed.data.title, topicData, sender);

    queries.audit(sender, 'create', 'discussion', id);

    // Broadcast to all WS clients so the UI updates
    if (broadcast) {
      broadcast(createEnvelope('discussion.created', {
        discussion: { id, title: parsed.data.title, topic: topicData, createdBy: sender },
      }, sender));
    }

    res.status(201).json(discussion);
  });

  // Get discussion with messages and tasks
  router.get('/discussions/:id', (req, res) => {
    const discussion = queries.getDiscussion(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const messages = queries.getMessages(discussion.id);
    const tasks = queries.listTasksByDiscussion(discussion.id);

    res.json({ ...discussion, messages, tasks });
  });

  // Delete discussion
  router.delete('/discussions/:id', (req, res) => {
    const discussion = queries.getDiscussion(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    queries.deleteDiscussion(req.params.id);
    queries.audit(req.auth!.sender, 'delete', 'discussion', req.params.id);
    res.json({ ok: true });
  });

  return router;
}
