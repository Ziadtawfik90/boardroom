import { connect, type NatsConnection } from 'nats';
import { config } from './config.js';
import { Connection } from './connection.js';
import { Discussant } from './discussant.js';
import { executeTask, getActiveTaskCount, cancelTask } from './runner.js';
import { collectPongPayload } from './health.js';
import { startNatsHeartbeat } from './nats-heartbeat.js';
import { FileSync } from './sync.js';
import { GitSync } from './git-sync.js';
import { logger } from './logger.js';
import type { WsEnvelope, TaskCreatedPayload, MessageNewPayload, DiscussionYourTurnPayload, DiscussionSoloAnalyzePayload } from '@boardroom/shared';
import { FLEET_SUBJECTS, type FleetTaskDispatch, type FleetTaskAccepted, type FleetTaskResult, type FleetTaskOutput, type FleetTaskCancel, type NodeId } from '@boardroom/shared';

const conn = new Connection();
const discussant = new Discussant(conn);

let nc: NatsConnection | null = null;
let fileSync: FileSync | GitSync | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// --- NATS task handler ---

async function handleNatsTask(task: FleetTaskDispatch): Promise<void> {
  if (task.nodeId !== config.agentId) return;
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    logger.warn(`At capacity (${config.maxConcurrentTasks}), ignoring NATS task ${task.taskId}`);
    return;
  }

  logger.info(`[NATS] Received task: ${task.taskId} - ${task.prompt.slice(0, 80)}...`);

  // Send accepted via NATS
  if (nc) {
    const accepted: FleetTaskAccepted = {
      type: 'task.accepted',
      taskId: task.taskId,
      nodeId: config.agentId as NodeId,
      pid: process.pid,
      acceptedAt: new Date().toISOString(),
    };
    nc.publish(
      FLEET_SUBJECTS.taskAccepted(config.agentId as NodeId),
      new TextEncoder().encode(JSON.stringify(accepted)),
    );
  }

  // Also accept via WS if connected
  if (conn.isConnected) {
    conn.send('task.accepted', { taskId: task.taskId });
  }

  // File sync: pull from hub before execution
  let workDir = task.workDir;
  if (fileSync) {
    try {
      workDir = await fileSync.pullFromHub(task.taskId, task.workDir);
      logger.info(`[sync] Pulled workspace: ${task.workDir} → ${workDir}`);
    } catch (err) {
      logger.error(`[sync] Pull failed, using direct path: ${(err as Error).message}`);
      // Fall through — try executing with the original path
    }
  }

  const startTime = Date.now();

  try {
    // Build a task-like object for executeTask
    const boardroomTask = {
      id: task.taskId,
      discussionId: task.metadata.discussionId || null,
      title: task.metadata.title || task.prompt.slice(0, 100),
      description: task.prompt,
      assignee: config.agentId,
      status: 'running' as const,
      type: (task.metadata.type || 'simple') as 'simple' | 'complex',
      priority: task.priority,
      dependencies: [],
      risk: 'low' as const,
      result: null,
      error: null,
      progress: 0,
      approvedBy: null,
      createdAt: task.dispatchedAt,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    // Execute the task using existing runner
    await executeTask(boardroomTask, conn, workDir);

    // File sync: push results back to hub
    let filesChanged: string[] = [];
    if (fileSync && workDir !== task.workDir) {
      try {
        filesChanged = await fileSync.pushToHub(task.taskId, workDir, task.workDir);
        logger.info(`[sync] Pushed ${filesChanged.length} files back to hub`);
      } catch (syncErr) {
        logger.error(`[sync] Push failed — task completed but results may not be on hub: ${(syncErr as Error).message}`);
        // Don't fail the task — the work was done, only sync failed
      }
    }

    // Report result via NATS
    if (nc) {
      const result: FleetTaskResult = {
        type: 'task.result',
        taskId: task.taskId,
        nodeId: config.agentId as NodeId,
        status: 'completed',
        exitCode: 0,
        filesChanged,
        durationMs: Date.now() - startTime,
        completedAt: new Date().toISOString(),
      };
      nc.publish(
        FLEET_SUBJECTS.taskResult(config.agentId as NodeId),
        new TextEncoder().encode(JSON.stringify(result)),
      );
    }
  } catch (err) {
    const error = (err as Error).message;
    logger.error(`[NATS] Task ${task.taskId} failed:`, error);

    if (nc) {
      const result: FleetTaskResult = {
        type: 'task.result',
        taskId: task.taskId,
        nodeId: config.agentId as NodeId,
        status: 'failed',
        exitCode: 1,
        filesChanged: [],
        durationMs: Date.now() - startTime,
        error,
        completedAt: new Date().toISOString(),
      };
      nc.publish(
        FLEET_SUBJECTS.taskResult(config.agentId as NodeId),
        new TextEncoder().encode(JSON.stringify(result)),
      );
    }
  }
}

// --- Initialize NATS ---

async function initNats(): Promise<void> {
  if (!config.natsEnabled) {
    logger.info('NATS disabled (FLEET_NATS_ENABLED=false)');
    return;
  }

  try {
    nc = await connect({
      servers: config.natsUrl,
      name: `boardroom-executor-${config.agentId}`,
      token: config.natsToken || undefined,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2_000,
    });

    logger.info(`[NATS] Connected to ${nc.getServer()}`);

    // Start heartbeat
    heartbeatTimer = startNatsHeartbeat(nc, config.agentId as NodeId, getActiveTaskCount);

    // Initialize file sync (git mode = no SSH, rsync mode = legacy)
    if (config.syncMode === 'git') {
      fileSync = new GitSync(
        {
          syncRoot: config.syncRoot,
          remoteBase: config.gitRemoteBase,
          hubPathPrefix: config.hubPathPrefix,
          isHub: config.isHub,
          timeoutSec: config.syncTimeoutSec,
          branch: config.gitBranch,
        },
        nc,
        config.agentId as NodeId,
      );
      logger.info(`[sync] Using git-based sync (no SSH)`);
    } else {
      fileSync = new FileSync(
        {
          syncRoot: config.syncRoot,
          hubSsh: config.hubSsh,
          hubPathPrefix: config.hubPathPrefix,
          isHub: config.isHub,
          retries: config.syncRetries,
          timeoutSec: config.syncTimeoutSec,
          extraFlags: config.syncExtraFlags,
        },
        nc,
        config.agentId as NodeId,
      );
      logger.info(`[sync] Using rsync-based sync (SSH required)`);
    }

    // Subscribe to task dispatches for this node
    const taskSub = nc.subscribe(FLEET_SUBJECTS.taskDispatch(config.agentId as NodeId));
    logger.info(`[NATS] Listening for tasks on ${FLEET_SUBJECTS.taskDispatch(config.agentId as NodeId)}`);

    (async () => {
      for await (const msg of taskSub) {
        try {
          const task = JSON.parse(new TextDecoder().decode(msg.data)) as FleetTaskDispatch;
          if (task.type !== 'task.dispatch') continue;
          handleNatsTask(task).catch((err) => {
            logger.error(`[NATS] Unhandled error in task execution:`, err);
          });
        } catch (err) {
          logger.error('[NATS] Failed to parse task message:', err);
        }
      }
    })();

    // Subscribe to task cancellations
    const cancelSub = nc.subscribe(FLEET_SUBJECTS.taskCancel(config.agentId as NodeId));
    logger.info(`[NATS] Listening for cancels on ${FLEET_SUBJECTS.taskCancel(config.agentId as NodeId)}`);

    (async () => {
      try {
        for await (const msg of cancelSub) {
          try {
            const cancel = JSON.parse(new TextDecoder().decode(msg.data)) as FleetTaskCancel;
            if (cancel.type !== 'task.cancel') continue;
            logger.info(`[NATS] Cancel received for task ${cancel.taskId}: ${cancel.reason}`);
            cancelTask(cancel.taskId);
          } catch (err) {
            logger.error('[NATS] Failed to parse cancel message:', err);
          }
        }
      } catch (err) {
        logger.error('[NATS] Cancel subscription loop died:', (err as Error).message);
      }
    })();

    logger.info('[NATS] Fleet systems online (heartbeat, sync, task-sub, cancel-sub)');
  } catch (err) {
    logger.warn(`[NATS] Failed to connect to ${config.natsUrl}: ${(err as Error).message}`);
    logger.warn('[NATS] Running in WebSocket-only mode');
  }
}

// --- WebSocket message handler ---

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

      // Skip if already handling via NATS
      if (getActiveTaskCount() >= config.maxConcurrentTasks) {
        logger.warn(`At capacity, ignoring WS task ${task.id}`);
        break;
      }

      logger.info(`Received task via WS: ${task.id} - ${task.title}`);
      executeTask(task, conn).catch((err) => {
        logger.error(`Unhandled error in task execution: ${task.id}`, err);
      });
      break;
    }

    case 'message.new': {
      const payload = envelope.payload as MessageNewPayload;
      const msg = payload.message;
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

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down...`);
  conn.disconnect();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (nc) {
    try { await nc.drain(); } catch { /* ignore */ }
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Start ---

logger.info(`Boardroom Executor starting: agent=${config.agentId} server=${config.serverUrl}`);
conn.connect();
initNats().catch((err) => {
  logger.error('Failed to initialize NATS:', err);
});
