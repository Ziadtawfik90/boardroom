/**
 * ChairmanSession — a persistent AI moderator for boardroom discussions.
 *
 * Spawned when a discussion starts, stays alive for the entire meeting.
 * Maintains full conversation context via direct Anthropic API calls.
 * Decides when to intervene, approves tasks, and controls flow.
 */

import { callChairmanCLI } from '../ai/anthropic.js';
import { createEnvelope } from '../../../shared/src/protocol.js';
import type { WsEnvelope } from '../../../shared/src/protocol.js';
import type { Message, Task } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import type { DiscussionManager } from '../discussion/manager.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type { ChairmanConfig, ChairmanDecision, ChairmanState, ChatMessage } from './types.js';
import {
  CHAIRMAN_SYSTEM_PROMPT,
  CYCLE_EVALUATION_PROMPT,
  PHASE_TRANSITION_PROMPT,
  TASK_APPROVAL_PROMPT,
  ESCALATION_PROMPT,
  INITIAL_BRIEF_PROMPT,
} from './prompts.js';

type BroadcastFn = (envelope: WsEnvelope) => void;

const DEFAULT_DECISION: ChairmanDecision = {
  action: 'no_action',
  message: null,
  addressAgent: null,
  taskDecisions: [],
  reasoning: 'default',
};

export class ChairmanSession {
  private state: ChairmanState;
  private config: ChairmanConfig;
  private pendingMessages: Message[] = [];
  private evaluating = false;

  constructor(
    private discussionId: string,
    config: ChairmanConfig,
    private queries: Queries,
    private discussionManager: DiscussionManager,
    private dispatcher: TaskDispatcher,
    private broadcast: BroadcastFn,
  ) {
    this.config = config;
    this.state = {
      discussionId,
      interventionCount: 0,
      conversationHistory: [{ role: 'system', content: CHAIRMAN_SYSTEM_PROMPT }],
      lastEvaluation: Date.now(),
      started: false,
    };
  }

  get interventionCount(): number {
    return this.state.interventionCount;
  }

  get isStarted(): boolean {
    return this.state.started;
  }

  /** Start the chairman session — called when discussion begins */
  async start(title: string, topic: string, brief?: { objective: string; background: string; keyQuestion: string; constraints: string }): Promise<void> {
    if (this.state.started) return;
    this.state.started = true;

    console.log(`[chairman] Session started for discussion ${this.discussionId}`);

    const briefPrompt = INITIAL_BRIEF_PROMPT(title, topic, brief);
    const decision = await this.evaluate(briefPrompt);

    if (decision.action === 'intervene' && decision.message) {
      this.postMessage(decision.message);
    }
  }

  /** Feed a discussion message into the chairman's context */
  onMessage(message: Message): void {
    // Don't process chairman's own messages or system metadata
    if (message.sender === 'chairman') return;

    this.pendingMessages.push(message);

    // Append to conversation history as context
    const label = message.sender.toUpperCase();
    const content = message.type === 'system'
      ? `[SYSTEM]: ${message.content}`
      : `[${label}]: ${message.content}`;

    this.state.conversationHistory.push({ role: 'user', content });

    // Trim history if it gets too long (keep system prompt + last 60 messages)
    if (this.state.conversationHistory.length > 62) {
      const system = this.state.conversationHistory[0]!;
      const recent = this.state.conversationHistory.slice(-60);
      this.state.conversationHistory = [system, ...recent];
    }
  }

  /** Called when all agents have spoken once in the current phase */
  async onCycleComplete(phase: string, agreementScore: number, turnCount: number): Promise<void> {
    if (!this.config.evaluateEveryCycle) return;
    if (this.state.interventionCount >= this.config.maxInterventions) {
      console.log(`[chairman] At intervention limit (${this.config.maxInterventions}), skipping cycle evaluation`);
      return;
    }

    const contextNote = `[Current state: phase=${phase}, agreement=${(agreementScore * 100).toFixed(0)}%, turn=${turnCount}]`;

    const prompt = `${contextNote}\n\n${CYCLE_EVALUATION_PROMPT}`;
    const decision = await this.evaluate(prompt);
    await this.executeDecision(decision);
  }

  /** Called when discussion phase transitions */
  async onPhaseChange(fromPhase: string, toPhase: string): Promise<void> {
    if (this.state.interventionCount >= this.config.maxInterventions) return;

    const prompt = PHASE_TRANSITION_PROMPT(fromPhase, toPhase);
    const decision = await this.evaluate(prompt);
    await this.executeDecision(decision);
  }

  /** Called when tasks are extracted and need approval */
  async onTasksProposed(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return;

    const taskSummary = tasks.map(t =>
      `- [${t.id}] "${t.title}" assigned to ${t.assignee} (risk: ${t.risk}, type: ${t.type})`,
    ).join('\n');

    const prompt = `${TASK_APPROVAL_PROMPT}\n\nProposed tasks:\n${taskSummary}`;
    const decision = await this.evaluate(prompt);

    // Process task decisions
    for (const td of decision.taskDecisions) {
      const task = tasks.find(t => t.id === td.taskId);
      if (!task) continue;

      if (td.decision === 'approve') {
        this.queries.approveTask(td.taskId, 'chairman');
        console.log(`[chairman] Approved task ${td.taskId}: ${td.reason}`);
      } else if (td.decision === 'reject') {
        this.queries.failTask(td.taskId, `Chairman rejected: ${td.reason}`);
        console.log(`[chairman] Rejected task ${td.taskId}: ${td.reason}`);
      } else if (td.decision === 'modify') {
        if (td.modifiedAssignee) {
          this.queries.reassignTask(td.taskId, td.modifiedAssignee);
        }
        this.queries.approveTask(td.taskId, 'chairman');
        console.log(`[chairman] Modified and approved task ${td.taskId}: ${td.reason}`);
      }
    }

    // Post approval summary if there were decisions
    if (decision.taskDecisions.length > 0) {
      const approved = decision.taskDecisions.filter(d => d.decision === 'approve' || d.decision === 'modify');
      const rejected = decision.taskDecisions.filter(d => d.decision === 'reject');

      let summary = '';
      if (approved.length > 0) {
        summary += `Chairman approved ${approved.length} task(s).`;
      }
      if (rejected.length > 0) {
        if (summary) summary += ' ';
        summary += `Rejected ${rejected.length}: ${rejected.map(r => r.reason).join('; ')}`;
      }

      if (summary) {
        this.postMessage(summary);
      }

      // Dispatch approved tasks
      for (const td of decision.taskDecisions) {
        if (td.decision === 'approve' || td.decision === 'modify') {
          const updated = this.queries.getTask(td.taskId);
          if (updated?.status === 'approved') {
            this.dispatcher.dispatchIfReady(updated);
          }
        }
      }
    }
  }

  /** Called when the secretary escalates to the chairman */
  async onEscalation(reason: string): Promise<void> {
    const prompt = ESCALATION_PROMPT(reason);
    const decision = await this.evaluate(prompt);
    await this.executeDecision(decision);
  }

  /** Cleanup */
  close(): void {
    console.log(`[chairman] Session closed for ${this.discussionId} (${this.state.interventionCount} interventions)`);
    this.state.conversationHistory = [];
    this.pendingMessages = [];
  }

  // --- Internal ---

  private async evaluate(prompt: string): Promise<ChairmanDecision> {
    if (this.evaluating) {
      console.log(`[chairman] Already evaluating, skipping`);
      return DEFAULT_DECISION;
    }

    this.evaluating = true;
    this.state.lastEvaluation = Date.now();

    try {
      // Add the evaluation prompt to history
      this.state.conversationHistory.push({ role: 'user', content: prompt });

      // Call the LLM
      const messages = this.state.conversationHistory.slice(1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const decision = await callChairmanCLI<ChairmanDecision>(
        this.config.model,
        CHAIRMAN_SYSTEM_PROMPT,
        messages,
        this.config.maxTokens,
      );

      // Validate the decision
      const validated = this.validateDecision(decision);

      // Record the assistant's response in history
      this.state.conversationHistory.push({
        role: 'assistant',
        content: JSON.stringify(validated),
      });

      console.log(`[chairman] Decision: ${validated.action} — ${validated.reasoning}`);
      return validated;
    } catch (err) {
      console.error(`[chairman] Evaluation failed:`, (err as Error).message);
      return DEFAULT_DECISION;
    } finally {
      this.evaluating = false;
    }
  }

  private validateDecision(raw: Partial<ChairmanDecision>): ChairmanDecision {
    const validActions = ['no_action', 'intervene', 'redirect', 'call_vote', 'end_discussion', 'approve_tasks', 'table_topic'];
    const action = validActions.includes(raw.action ?? '') ? raw.action! : 'no_action';

    return {
      action: action as ChairmanDecision['action'],
      message: typeof raw.message === 'string' ? raw.message : null,
      addressAgent: typeof raw.addressAgent === 'string' ? raw.addressAgent : null,
      taskDecisions: Array.isArray(raw.taskDecisions) ? raw.taskDecisions : [],
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : 'no reasoning provided',
    };
  }

  private async executeDecision(decision: ChairmanDecision): Promise<void> {
    switch (decision.action) {
      case 'no_action':
        break;

      case 'intervene':
      case 'redirect':
        if (decision.message) {
          this.state.interventionCount++;
          const prefix = decision.addressAgent
            ? `${decision.addressAgent.toUpperCase()}, `
            : '';
          this.postMessage(`${prefix}${decision.message}`);
        }
        break;

      case 'call_vote':
        this.state.interventionCount++;
        this.postMessage(decision.message ?? 'I am calling a vote on the current proposal. State your position: [FOR], [AGAINST], or [ABSTAIN].');
        break;

      case 'end_discussion':
        this.state.interventionCount++;
        this.postMessage(decision.message ?? 'This discussion has reached its conclusion. Thank you all.');
        this.discussionManager.close(this.discussionId);
        break;

      case 'table_topic':
        this.state.interventionCount++;
        this.postMessage(decision.message ?? 'We are tabling this topic for a future meeting.');
        this.discussionManager.close(this.discussionId);
        break;

      case 'approve_tasks':
        // Task decisions are handled in onTasksProposed
        break;
    }
  }

  private postMessage(content: string): void {
    const msg = this.discussionManager.addMessage(
      this.discussionId,
      'chairman' as any,
      content,
      'message',
    );
    this.broadcast(createEnvelope('message.new', { discussionId: this.discussionId, message: msg }, 'system'));
    console.log(`[chairman] Posted: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`);
  }
}
