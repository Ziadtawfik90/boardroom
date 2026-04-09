import type { Sender, Message, Task, Agent, AgentHealth } from './types.js';

// WebSocket message envelope
export interface WsEnvelope<T = unknown> {
  type: string;
  payload: T;
  sender: Sender;
  timestamp: string;
  id: string;
}

// --- Discussion messages ---

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

// --- Task messages ---

export interface TaskCreatedPayload {
  task: Task;
}

export interface TaskAcceptedPayload {
  taskId: string;
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

// --- System messages ---

export interface AgentJoinPayload {
  agent: Pick<Agent, 'id' | 'name' | 'role'>;
}

export interface AgentLeavePayload {
  agentId: string;
}

export interface HeartbeatPongPayload {
  load: { cpu: number; mem: number; gpu: number | null };
  taskCount: number;
}

// --- Dynamic discussion turn ---

export interface DiscussionYourTurnPayload {
  discussionId: string;
  turnPrompt: string;
  turnCount: number;
}

export interface DiscussionSoloAnalyzePayload {
  discussionId: string;
  topic: string;
}

// All WS message types
export type WsMessageType =
  | 'message.send'
  | 'message.new'
  | 'message.typing'
  | 'message.typing.indicator'
  | 'discussion.created'
  | 'discussion.closed'
  | 'discussion.your_turn'
  | 'discussion.solo_analyze'
  | 'task.created'
  | 'task.accepted'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'agent.join'
  | 'agent.leave'
  | 'heartbeat.ping'
  | 'heartbeat.pong';

export function createEnvelope<T>(type: WsMessageType, payload: T, sender: Sender): WsEnvelope<T> {
  return {
    type,
    payload,
    sender,
    timestamp: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
}
