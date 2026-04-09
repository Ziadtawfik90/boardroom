import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireAdmin } from '../auth/middleware.js';
import { createTaskSchema, updateTaskSchema } from '../../../shared/src/validation.js';
import type { Queries } from '../db/queries.js';
import type { TaskDispatcher } from '../task/dispatcher.js';

export function createTaskRouter(queries: Queries, dispatcher: TaskDispatcher): Router {
  const router = Router();

  router.use(authMiddleware);

  // Create task for a discussion
  router.post('/discussions/:id/tasks', (req, res) => {
    const discussion = queries.getDiscussion(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const id = uuidv4();
    const task = queries.insertTask(
      id,
      req.params.id,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.assignee,
      parsed.data.type,
      0,
      parsed.data.dependencies,
    );

    queries.audit(req.auth!.sender, 'create', 'task', id);

    // Dispatch to agent if they are connected
    dispatcher.dispatch(task);

    res.status(201).json({ id: task.id, status: task.status });
  });

  // Approve all pending tasks for a discussion and dispatch them
  router.post('/discussions/:id/tasks/approve-all', requireAdmin, (req, res) => {
    const discussionId = req.params.id as string;
    const discussion = queries.getDiscussion(discussionId);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const tasks = queries.listTasksByDiscussion(discussionId);
    const pending = tasks.filter(t => t.status === 'pending');
    const sender = req.auth!.sender as string;
    for (const task of pending) {
      queries.approveTask(task.id, sender);
      queries.audit(sender, 'approve', 'task', task.id);
      const updated = queries.getTask(task.id)!;
      dispatcher.dispatch(updated);
    }
    res.json({ approved: pending.length });
  });

  // List tasks with filters
  router.get('/tasks', (req, res) => {
    const status = req.query.status as string | undefined;
    const assignee = req.query.assignee as string | undefined;
    const tasks = queries.listTasks({ status, assignee });
    res.json({ tasks });
  });

  // Get task with logs
  router.get('/tasks/:id', (req, res) => {
    const task = queries.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const logs = queries.getTaskLogs(task.id);
    res.json({ ...task, logs });
  });

  // Pull a task from consent agenda (revert auto-approved → pending)
  router.post('/tasks/:id/pull', authMiddleware, (req, res) => {
    const task = queries.getTask(req.params.id as string);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'approved' || task.approvedBy !== 'consent-agenda') {
      res.status(409).json({ error: 'Only auto-approved tasks can be pulled for review' });
      return;
    }

    queries.updateTaskStatus('pending', task.id);
    queries.audit(req.auth!.sender, 'pull', 'task', task.id);

    const updated = queries.getTask(task.id)!;
    res.json(updated);
  });

  // Approve or cancel task (admin/user only)
  router.patch('/tasks/:id', requireAdmin, (req, res) => {
    const taskId = req.params.id as string;
    const task = queries.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    if (parsed.data.status === 'approved') {
      if (task.status !== 'pending') {
        res.status(409).json({ error: 'Only pending tasks can be approved' });
        return;
      }
      queries.approveTask(task.id, req.auth!.sender);
      queries.audit(req.auth!.sender, 'approve', 'task', task.id);

      // Re-dispatch after approval
      const updated = queries.getTask(task.id)!;
      dispatcher.dispatch(updated);
    } else {
      if (task.status === 'done' || task.status === 'failed') {
        res.status(409).json({ error: 'Cannot cancel a completed task' });
        return;
      }
      queries.cancelTask(task.id);
      queries.audit(req.auth!.sender, 'cancel', 'task', task.id);
    }

    const updated = queries.getTask(task.id)!;
    res.json(updated);
  });

  return router;
}
