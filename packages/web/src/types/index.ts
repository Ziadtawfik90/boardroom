// Types mirrored from @boardroom/shared
// Once shared package is built, replace with: export * from '@boardroom/shared';

export type AgentId = 'asus' | 'water' | 'steam';
export type AdvisorId = 'oracle' | 'sage';
export type Sender = AgentId | AdvisorId | 'user' | 'system';
export type AgentStatus = 'online' | 'offline' | 'busy';
export type DiscussionStatus = 'active' | 'closed' | 'archived';
export type TaskStatus = 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'cancelled';
export type TaskType = 'simple' | 'complex';
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

export interface MeetingBrief {
  title: string;
  objective: 'brainstorm' | 'evaluate' | 'decide' | 'inform';
  background: string;
  keyQuestion: string;
  constraints: string;
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

// WebSocket envelope
export interface WsEnvelope<T = unknown> {
  type: string;
  payload: T;
  sender: Sender;
  timestamp: string;
  id: string;
}

// WS payload types
export interface MessageSendPayload {
  discussionId: string;
  content: string;
}

export interface MessageNewPayload {
  discussionId: string;
  message: Message;
}

export interface TypingPayload {
  discussionId: string;
}

export interface TypingIndicatorPayload {
  discussionId: string;
  sender: Sender;
}

export interface DiscussionCreatedPayload {
  discussion: { id: string; title: string; topic: string | null; createdBy: Sender };
}

export interface DiscussionClosedPayload {
  discussionId: string;
}

export interface TaskCreatedPayload {
  task: Task;
}

export interface TaskProgressPayload {
  taskId: string;
  progress: number;
  log: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  result: Record<string, unknown>;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
}

export interface AgentJoinPayload {
  agent: Pick<Agent, 'id' | 'name' | 'role'>;
}

export interface AgentLeavePayload {
  agentId: string;
}

export type WsMessageType =
  | 'message.send'
  | 'message.new'
  | 'message.typing'
  | 'message.typing.indicator'
  | 'discussion.created'
  | 'discussion.closed'
  | 'task.created'
  | 'task.accepted'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'agent.join'
  | 'agent.leave'
  | 'heartbeat.ping'
  | 'heartbeat.pong';
