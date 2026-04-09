import { config } from './config.js';
import { Connection } from './connection.js';
import { Discussant } from './discussant.js';
import { executeTask, getActiveTaskCount } from './runner.js';
import { collectPongPayload } from './health.js';
import { logger } from './logger.js';
import type { WsEnvelope, TaskCreatedPayload, MessageNewPayload, DiscussionYourTurnPayload, DiscussionSoloAnalyzePayload } from '@boardroom/shared';

const conn = new Connection();
const discussant = new Discussant(conn);

// --- Message handler ---

conn.on('message', async (envelope: WsEnvelope) => {
  switch (envelope.type) {
    case 'heartbeat.ping': {
      const pong = await collectPongPayload(getActiveTaskCount());
      conn.send('heartbeat.pong', pong);
      break;
    }

    case 'task.created': {
      const payload = envelope.payload as TaskCreatedPayload;
      const task = payload.task;
      if (task.assignee !== config.agentId) break;
      logger.info(`Received task: ${task.id} - ${task.title}`);
      executeTask(task, conn).catch((err) => {
        logger.error(`Unhandled error in task execution: ${task.id}`, err);
      });
      break;
    }

    case 'message.new': {
      const payload = envelope.payload as MessageNewPayload;
      const msg = payload.message;
      // Track all messages for context (don't respond — wait for your turn)
      discussant.addMessage(msg.sender, msg.content);
      break;
    }

    case 'discussion.your_turn': {
      const payload = envelope.payload as DiscussionYourTurnPayload;
      logger.info(`Turn ${payload.turnCount + 1} — my turn`);
      discussant.respondToUser(payload.discussionId, payload.turnPrompt).catch((err) => {
        logger.error('Failed to respond to discussion', err);
      });
      break;
    }

    case 'discussion.solo_analyze': {
      const payload = envelope.payload as DiscussionSoloAnalyzePayload;
      logger.info('Solo analyze — forming independent position');
      discussant.respondToUser(payload.discussionId, payload.topic).catch((err) => {
        logger.error('Failed to respond to solo analyze', err);
      });
      break;
    }

    default:
      logger.debug(`Ignoring message type: ${envelope.type}`);
  }
});

// --- Connection lifecycle ---

conn.on('connected', () => {
  logger.info(`Agent "${config.agentId}" online and ready`);
});

conn.on('disconnected', () => {
  logger.warn('Disconnected from server, will reconnect...');
});

// --- Graceful shutdown ---

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down...`);
  conn.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Start ---

logger.info(`Boardroom Executor starting: agent=${config.agentId} server=${config.serverUrl}`);
conn.connect();
