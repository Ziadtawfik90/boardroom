export type AgentId = 'asus' | 'water' | 'steam';
export type Sender = AgentId | 'user' | 'system' | 'oracle' | 'sage' | 'chairman';
export type AgentStatus = 'online' | 'offline' | 'busy';
export type DiscussionStatus = 'active' | 'closed' | 'archived';
export type TaskStatus = 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'cancelled';
export type TaskType = 'simple' | 'complex';
export type TaskRiskLevel = 'low' | 'medium' | 'high';
export type MessageType = 'message' | 'decision' | 'action' | 'system';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  host: string;
  sshAlias: string | null;
  status: AgentStatus;
  capabilities: string[];
  lastHeartbeat: string | null;
  currentTask: { id: string; title: string } | null;
}

export interface Discussion {
  id: string;
  title: string;
  topic: string | null;
  status: DiscussionStatus;
  createdBy: Sender;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface Message {
  id: string;
  discussionId: string;
  sender: Sender;
  content: string;
  type: MessageType;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Task {
  id: string;
  discussionId: string | null;
  title: string;
  description: string | null;
  assignee: AgentId;
  status: TaskStatus;
  type: TaskType;
  priority: number;
  dependencies: string[];
  risk: TaskRiskLevel;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  approvedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskLog {
  id: number;
  taskId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface AgentHealth {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  gpu: { name: string; memoryTotal: number; memoryUsed: number; temperature: number } | null;
  cpu: number;
  memory: { total: number; used: number };
  taskCount: number;
}
