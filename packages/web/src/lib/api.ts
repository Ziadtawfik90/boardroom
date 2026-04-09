import { getToken } from './auth';
import type { Agent, AgentHealth, Discussion, Message, Task } from '../types';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...opts, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  return res.json();
}

// --- Discussions ---

export async function fetchDiscussions(
  status: string = 'active',
  limit: number = 50,
  offset: number = 0,
): Promise<{ discussions: Discussion[]; total: number }> {
  return request(`/api/v1/discussions?status=${status}&limit=${limit}&offset=${offset}`);
}

export async function fetchDiscussion(
  id: string,
): Promise<Discussion & { messages: Message[]; tasks: Task[] }> {
  return request(`/api/v1/discussions/${id}`);
}

export async function createDiscussion(
  title: string,
  topic?: string,
  extra?: {
    objective?: string;
    background?: string;
    keyQuestion?: string;
    constraints?: string;
    workspacePath?: string;
  },
): Promise<{ id: string; title: string; createdAt: string }> {
  return request('/api/v1/discussions', {
    method: 'POST',
    body: JSON.stringify({ title, topic, ...extra }),
  });
}

export async function approveAllTasks(
  discussionId: string,
): Promise<{ approved: number }> {
  return request(`/api/v1/discussions/${discussionId}/tasks/approve-all`, {
    method: 'POST',
  });
}

export async function deleteDiscussion(id: string): Promise<{ ok: boolean }> {
  return request(`/api/v1/discussions/${id}`, { method: 'DELETE' });
}

export async function fetchMessages(
  discussionId: string,
  limit: number = 50,
  before?: string,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return request(`/api/v1/discussions/${discussionId}/messages?${params}`);
}

// --- Tasks ---

export async function fetchTasks(
  params?: { status?: string; assignee?: string },
): Promise<{ tasks: Task[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.assignee) qs.set('assignee', params.assignee);
  return request(`/api/v1/tasks?${qs}`);
}

export async function fetchTask(
  id: string,
): Promise<Task & { logs: Array<{ level: string; message: string; createdAt: string }> }> {
  return request(`/api/v1/tasks/${id}`);
}

export async function createTask(
  discussionId: string,
  data: {
    title: string;
    description?: string;
    assignee: string;
    type?: string;
    dependencies?: string[];
  },
): Promise<{ id: string; status: string }> {
  return request(`/api/v1/discussions/${discussionId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTask(
  id: string,
  data: { status: 'approved' | 'cancelled'; notes?: string },
): Promise<Task> {
  return request(`/api/v1/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// --- Agents ---

export async function fetchAgents(): Promise<{ agents: Agent[] }> {
  return request('/api/v1/agents');
}

export async function fetchAgentHealth(id: string): Promise<AgentHealth> {
  return request(`/api/v1/agents/${id}/health`);
}

// --- System ---

export async function fetchHealth(): Promise<{ status: string; version: string; uptime: number }> {
  return request('/api/v1/health');
}
