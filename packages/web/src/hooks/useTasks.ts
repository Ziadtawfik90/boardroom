import { useState, useEffect, useCallback } from 'react';
import { ws } from '../lib/ws';
import * as api from '../lib/api';
import type {
  Task,
  TaskCreatedPayload,
  TaskProgressPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
} from '../types';

export function useTasks(discussionId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // Load tasks for discussion
  useEffect(() => {
    if (!discussionId) {
      setTasks([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api.fetchTasks().then((data) => {
      if (!cancelled) {
        setTasks(data.tasks.filter((t) => t.discussionId === discussionId));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [discussionId]);

  // Listen for task updates
  useEffect(() => {
    const offCreated = ws.on('task.created', (env) => {
      const { task } = env.payload as TaskCreatedPayload;
      if (task.discussionId === discussionId) {
        setTasks((prev) => [...prev, task]);
      }
    });

    const offProgress = ws.on('task.progress', (env) => {
      const { taskId, progress } = env.payload as TaskProgressPayload;
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress, status: 'running' } : t)),
      );
    });

    const offCompleted = ws.on('task.completed', (env) => {
      const { taskId, result } = env.payload as TaskCompletedPayload;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'done', progress: 100, result, completedAt: env.timestamp }
            : t,
        ),
      );
    });

    const offFailed = ws.on('task.failed', (env) => {
      const { taskId, error } = env.payload as TaskFailedPayload;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'failed', error, completedAt: env.timestamp }
            : t,
        ),
      );
    });

    return () => {
      offCreated();
      offProgress();
      offCompleted();
      offFailed();
    };
  }, [discussionId]);

  const approve = useCallback(async (taskId: string) => {
    const updated = await api.updateTask(taskId, { status: 'approved' });
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
  }, []);

  const cancel = useCallback(async (taskId: string) => {
    const updated = await api.updateTask(taskId, { status: 'cancelled' });
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
  }, []);

  const create = useCallback(
    async (data: { title: string; description?: string; assignee: string; type?: string }) => {
      if (!discussionId) return;
      await api.createTask(discussionId, data);
    },
    [discussionId],
  );

  return { tasks, loading, approve, cancel, create };
}
