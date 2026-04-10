import type { Task } from '../../../shared/src/types.js';

export interface ChairmanConfig {
  model: string;
  maxInterventions: number;
  evaluateEveryCycle: boolean;
  autoApproveEnabled: boolean;
  maxTokens: number;
}

export type ChairmanActionType =
  | 'no_action'
  | 'intervene'
  | 'redirect'
  | 'call_vote'
  | 'end_discussion'
  | 'approve_tasks'
  | 'table_topic';

export interface TaskDecision {
  taskId: string;
  decision: 'approve' | 'reject' | 'modify';
  reason: string;
  modifiedTitle?: string;
  modifiedAssignee?: string;
}

export interface ChairmanDecision {
  action: ChairmanActionType;
  message: string | null;
  addressAgent: string | null;
  taskDecisions: TaskDecision[];
  reasoning: string;
}

export interface ChairmanState {
  discussionId: string;
  interventionCount: number;
  conversationHistory: ChatMessage[];
  lastEvaluation: number;
  started: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
