import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { WsEnvelope, WsMessageType, HeartbeatPongPayload } from '../../../shared/src/protocol.js';
import { createEnvelope, type MessageSendPayload, type TaskAcceptedPayload, type TaskProgressPayload, type TaskCompletedPayload, type TaskFailedPayload } from '../../../shared/src/protocol.js';
import { messageSendSchema } from '../../../shared/src/validation.js';
import type { Sender } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { DiscussionManager } from '../discussion/manager.js';
import type { DiscussionOrchestrator } from '../discussion/orchestrator.js';
import type { BoardSecretary } from '../governance/secretary.js';
import type { MeetingTriggers } from '../governance/triggers.js';

type BroadcastFn = (envelope: WsEnvelope, exclude?: WebSocket) => void;

export class WsHandlers {
  private orchestrator: DiscussionOrchestrator | null = null;
  private secretary: BoardSecretary | null = null;
  private triggers: MeetingTriggers | null = null;

  constructor(
    private queries: Queries,
    private registry: AgentRegistry,
    private discussionManager: DiscussionManager,
    private broadcast: BroadcastFn,
  ) {}

  setOrchestrator(orchestrator: DiscussionOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  setSecretary(secretary: BoardSecretary): void {
    this.secretary = secretary;
  }

  setTriggers(triggers: MeetingTriggers): void {
    this.triggers = triggers;
  }

  handle(ws: WebSocket, sender: Sender, envelope: WsEnvelope): void {
    const type = envelope.type as WsMessageType;

    switch (type) {
      case 'message.send':
        this.handleMessageSend(ws, sender, envelope.payload as MessageSendPayload);
        break;
      case 'message.typing':
        this.handleTyping(ws, sender, envelope.payload as { discussionId: string });
        break;
      case 'task.accepted':
        this.handleTaskAccepted(sender, envelope.payload as TaskAcceptedPayload);
        break;
      case 'task.progress':
        this.handleTaskProgress(sender, envelope.payload as TaskProgressPayload);
        break;
      case 'task.completed':
        this.handleTaskCompleted(sender, envelope.payload as TaskCompletedPayload);
        break;
      case 'task.failed':
        this.handleTaskFailed(sender, envelope.payload as TaskFailedPayload);
        break;
      case 'heartbeat.pong':
        this.handleHeartbeatPong(sender, envelope.payload as HeartbeatPongPayload);
        break;
      default:
        console.warn(`[ws] Unknown message type: ${type}`);
    }
  }

  private handleMessageSend(ws: WebSocket, sender: Sender, payload: MessageSendPayload): void {
    const parsed = messageSendSchema.safeParse(payload);
    if (!parsed.success) {
      ws.send(JSON.stringify(createEnvelope('message.new', { error: 'Invalid message payload' }, 'system')));
      return;
    }

    const discussion = this.queries.getDiscussion(parsed.data.discussionId);
    if (!discussion) {
      ws.send(JSON.stringify(createEnvelope('message.new', { error: 'Discussion not found' }, 'system')));
      return;
    }

    const message = this.discussionManager.addMessage(
      parsed.data.discussionId,
      sender,
      parsed.data.content,
    );

    const outEnvelope = createEnvelope('message.new', {
      discussionId: parsed.data.discussionId,
      message,
    }, 'system');

    this.broadcast(outEnvelope);

    // If user sent the message, start a new discussion or intervene in an active one
    if (sender === 'user' && this.orchestrator) {
      if (this.orchestrator.isActive(parsed.data.discussionId)) {
        // Discussion already running — inject chairman's message into the flow
        this.orchestrator.onChairmanIntervention(parsed.data.discussionId, parsed.data.content);
      } else {
        // No active discussion — start a new round
        this.orchestrator.startRound(parsed.data.discussionId, message);
      }
    }

    // If an agent sent the message, notify orchestrator it's done
    if (sender !== 'user' && sender !== 'system' && this.orchestrator) {
      this.orchestrator.onAgentResponse(sender, parsed.data.content);
    }
  }

  private handleTyping(_ws: WebSocket, sender: Sender, payload: { discussionId: string }): void {
    const outEnvelope = createEnvelope('message.typing.indicator', {
      discussionId: payload.discussionId,
      sender,
    }, 'system');

    this.broadcast(outEnvelope);
  }

  private handleTaskAccepted(sender: Sender, payload: TaskAcceptedPayload): void {
    const task = this.queries.getTask(payload.taskId);
    if (!task) return;

    this.queries.startTask(payload.taskId);
    this.queries.insertTaskLog(payload.taskId, 'info', `Task accepted by ${sender}`);
    this.queries.updateAgentStatus(sender, 'busy');

    const outEnvelope = createEnvelope('task.accepted', payload, sender);
    this.broadcast(outEnvelope);
  }

  private handleTaskProgress(sender: Sender, payload: TaskProgressPayload): void {
    const task = this.queries.getTask(payload.taskId);
    if (!task) return;

    this.queries.updateTaskProgress(payload.taskId, payload.progress);
    this.queries.insertTaskLog(payload.taskId, 'info', payload.log);

    const outEnvelope = createEnvelope('task.progress', payload, sender);
    this.broadcast(outEnvelope);
  }

  private handleTaskCompleted(sender: Sender, payload: TaskCompletedPayload): void {
    const task = this.queries.getTask(payload.taskId);
    if (!task) return;

    this.queries.completeTask(payload.taskId, payload.result);
    this.queries.insertTaskLog(payload.taskId, 'info', 'Task completed');
    this.queries.updateAgentStatus(sender, 'online');

    const outEnvelope = createEnvelope('task.completed', payload, sender);
    this.broadcast(outEnvelope);

    if (task.discussionId) {
      const resultMessage = this.discussionManager.addMessage(
        task.discussionId,
        sender,
        `Task "${task.title}" completed successfully.`,
        'action',
        null,
        { taskId: task.id, result: payload.result },
      );

      const msgEnvelope = createEnvelope('message.new', {
        discussionId: task.discussionId,
        message: resultMessage,
      }, 'system');

      this.broadcast(msgEnvelope);
    }

    // Secretary: dispatch dependents + evaluate reconvene
    if (this.secretary) {
      const updatedTask = this.queries.getTask(payload.taskId)!;
      this.secretary.onTaskCompleted(updatedTask);
    }
  }

  private handleTaskFailed(sender: Sender, payload: TaskFailedPayload): void {
    const task = this.queries.getTask(payload.taskId);
    if (!task) return;

    this.queries.failTask(payload.taskId, payload.error);
    this.queries.insertTaskLog(payload.taskId, 'error', payload.error);
    this.queries.updateAgentStatus(sender, 'online');

    const outEnvelope = createEnvelope('task.failed', payload, sender);
    this.broadcast(outEnvelope);

    if (task.discussionId) {
      const errorMessage = this.discussionManager.addMessage(
        task.discussionId,
        sender,
        `Task "${task.title}" failed: ${payload.error}`,
        'system',
        null,
        { taskId: task.id, error: payload.error },
      );

      const msgEnvelope = createEnvelope('message.new', {
        discussionId: task.discussionId,
        message: errorMessage,
      }, 'system');

      this.broadcast(msgEnvelope);
    }

    // Secretary: evaluate emergency reconvene
    const updatedTask = this.queries.getTask(payload.taskId);
    if (updatedTask) {
      if (this.secretary) {
        this.secretary.onTaskFailed(updatedTask);
      }
      // Triggers: evaluate if threshold emergency meeting needed
      if (this.triggers) {
        this.triggers.evaluateTaskFailure(updatedTask);
      }
    }
  }

  private handleHeartbeatPong(sender: Sender, payload: HeartbeatPongPayload): void {
    this.registry.recordPong(sender, {
      cpu: payload.load.cpu,
      memory: { total: 0, used: payload.load.mem },
      taskCount: payload.taskCount,
    });
  }
}
