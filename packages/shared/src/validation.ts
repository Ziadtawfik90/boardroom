import { z } from 'zod';

export const agentIdSchema = z.enum(['asus', 'water', 'steam']);
export const senderSchema = z.enum(['asus', 'water', 'steam', 'user', 'system', 'oracle', 'sage']);
export const taskStatusSchema = z.enum(['pending', 'approved', 'running', 'done', 'failed', 'cancelled']);
export const taskTypeSchema = z.enum(['simple', 'complex']);

export const loginSchema = z.object({
  apiKey: z.string().min(1),
});

export const createDiscussionSchema = z.object({
  title: z.string().min(1).max(200),
  topic: z.string().max(2000).optional(),
  objective: z.enum(['brainstorm', 'evaluate', 'decide', 'inform']).optional(),
  background: z.string().max(5000).optional(),
  keyQuestion: z.string().max(1000).optional(),
  constraints: z.string().max(2000).optional(),
  workspacePath: z.string().max(500).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  assignee: agentIdSchema,
  type: taskTypeSchema.default('simple'),
  dependencies: z.array(z.string().uuid()).default([]),
});

export const updateTaskSchema = z.object({
  status: z.enum(['approved', 'cancelled']),
  notes: z.string().max(2000).optional(),
});

export const messageSendSchema = z.object({
  discussionId: z.string().uuid(),
  content: z.string().min(1).max(10000),
});

export const wsEnvelopeSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()),
  sender: senderSchema,
  timestamp: z.string().datetime(),
  id: z.string().uuid(),
});
