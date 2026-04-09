import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { Queries } from './db/queries.js';
import { AgentRegistry } from './agent/registry.js';
import { DiscussionManager } from './discussion/manager.js';
import { TaskPlanner } from './task/planner.js';
import { TaskDispatcher } from './task/dispatcher.js';
import { WsHandlers } from './ws/handlers.js';
import { BoardroomWsServer } from './ws/server.js';
import { HeartbeatService } from './ws/heartbeat.js';
import { createApiRouter } from './api/router.js';
import { DiscussionOrchestrator } from './discussion/orchestrator.js';
import { BoardSecretary } from './governance/secretary.js';
import { MeetingTriggers } from './governance/triggers.js';
import { CommitteeManager } from './governance/committees.js';
import { WorkspaceManager } from './workspace/manager.js';
import { SshHealthService } from './ws/ssh-health.js';
import { connect, type NatsConnection } from 'nats';
import { NatsBridge } from './fleet/nats-bridge.js';
import { FleetHealthMonitor } from './fleet/health-monitor.js';
import { FleetFileLockManager } from './fleet/file-lock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Database ----------

// DB path resolves relative to the monorepo root (where npm scripts run from)
const dbPath = resolve(process.cwd(), config.dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
migrate(db);

const queries = new Queries(db);

// ---------- Domain services ----------

const registry = new AgentRegistry(queries);
const discussionManager = new DiscussionManager(queries);
const dispatcher = new TaskDispatcher(registry, queries);

// ---------- Express ----------

const app = express();
app.use(express.json());

// CORS for dev
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Committee manager (needs db, created early for router)
const committeeManager = new CommitteeManager(db);

// Note: broadcast function is set after wsServer is created (below)
let apiBroadcast: ((envelope: import('./../../shared/src/protocol.js').WsEnvelope) => void) | undefined;
app.use('/api/v1', createApiRouter(queries, dispatcher, registry, (...args) => apiBroadcast?.(...args), committeeManager));

// ---------- Static files (Web UI) ----------

const webDistPath = resolve(process.cwd(), 'packages/web/dist');
if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    if (!_req.path.startsWith('/api/') && !_req.path.startsWith('/ws')) {
      res.sendFile(join(webDistPath, 'index.html'));
    }
  });
  console.log(`[static] Serving web UI from ${webDistPath}`);
} else {
  console.log('[static] Web UI not found — run "npm -w packages/web run build" first');
}

// ---------- HTTP + WebSocket ----------

const server = createServer(app);

const wsHandlers = new WsHandlers(queries, registry, discussionManager, (envelope, exclude) => {
  wsServer.broadcast(envelope, exclude);
});

const wsServer = new BoardroomWsServer(registry, dispatcher, wsHandlers);
wsServer.attach(server);
apiBroadcast = (envelope) => wsServer.broadcast(envelope);

// Workspace manager
const workspaceManager = new WorkspaceManager();

// Wire SSH fallback into dispatcher
dispatcher.setBroadcast((envelope) => wsServer.broadcast(envelope));
dispatcher.setDiscussionManager(discussionManager);
dispatcher.setWorkspaceManager(workspaceManager);

// ---------- Discussion Orchestrator ----------

const taskPlanner = new TaskPlanner(queries);
const orchestrator = new DiscussionOrchestrator(registry, discussionManager, (envelope) => {
  wsServer.broadcast(envelope);
}, queries, taskPlanner);
orchestrator.setDispatcher(dispatcher);
orchestrator.setWorkspaceManager(workspaceManager);
wsHandlers.setOrchestrator(orchestrator);

// ---------- Board Secretary (Autonomous Governance) ----------

const secretary = new BoardSecretary(queries, discussionManager, dispatcher, (envelope) => {
  wsServer.broadcast(envelope);
});
secretary.setReconveneHandler((discussionId, trigger, actionLog) => {
  orchestrator.reconvene(discussionId, trigger, actionLog);
});
secretary.setWorkspaceManager(workspaceManager);
wsHandlers.setSecretary(secretary);

// ---------- Meeting Triggers ----------

const triggers = new MeetingTriggers(queries, secretary);

wsHandlers.setTriggers(triggers);

// Periodic check for stuck tasks (every 2 minutes)
const stuckTaskInterval = setInterval(() => {
  triggers.evaluateStuckTasks();
}, 120_000);

// ---------- Heartbeat ----------

const heartbeat = new HeartbeatService(registry);
heartbeat.start();

// ---------- SSH Health Check (marks agents online if reachable via SSH) ----------

const sshHealth = new SshHealthService(queries);
sshHealth.start(30_000);

// ---------- Advisors (OpenRouter-based, no WebSocket) ----------

if (config.enableAdvisors && config.openrouterApiKey) {
  for (const advisorId of ['oracle', 'sage']) {
    queries.updateAgentStatus(advisorId, 'online');
    queries.updateAgentHeartbeat(advisorId);
  }
  console.log('[advisors] ORACLE and SAGE marked online (OpenRouter)');
}

// ---------- NATS — Fleet Task Distribution ----------

let nc: NatsConnection | null = null;
let natsBridge: NatsBridge | null = null;
let fleetHealthMonitor: FleetHealthMonitor | null = null;
let fleetFileLock: FleetFileLockManager | null = null;

async function initNats(): Promise<void> {
  if (!config.natsEnabled) {
    console.log('[nats] Disabled (NATS_ENABLED=false)');
    return;
  }

  try {
    nc = await connect({
      servers: config.natsUrl,
      name: 'boardroom-server',
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2_000,
    });

    console.log(`[nats] Connected to ${nc.getServer()}`);

    // Bridge: NATS events → WS broadcast + DB updates
    natsBridge = new NatsBridge(nc, queries, registry, (envelope) => wsServer.broadcast(envelope));
    await natsBridge.start();

    // Health monitor: track alive/suspect/dead via heartbeats
    fleetHealthMonitor = new FleetHealthMonitor(nc, registry, queries, dispatcher);
    await fleetHealthMonitor.start();

    // File lock manager: prevent concurrent writes
    fleetFileLock = new FleetFileLockManager(nc);
    await fleetFileLock.start();

    // Give dispatcher the NATS connection for publishing tasks
    dispatcher.setNats(nc);

    console.log('[nats] Fleet systems online (bridge, health, file-locks)');
  } catch (err) {
    console.warn(`[nats] Failed to connect to ${config.natsUrl}: ${(err as Error).message}`);
    console.warn('[nats] Falling back to WebSocket-only mode');
  }
}

// ---------- Start ----------

server.listen(config.port, config.host, async () => {
  console.log('');
  console.log('=================================');
  console.log('  BOARDROOM SERVER');
  console.log(`  http://${config.host}:${config.port}`);
  console.log(`  WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log('=================================');
  console.log('');
  console.log(`  Database: ${dbPath}`);
  console.log(`  Agents: ${queries.getAllAgents().map((a) => `${a.id} (${a.role})`).join(', ')}`);
  console.log('');

  // Connect to NATS after HTTP is ready
  await initNats();
});

// ---------- Graceful shutdown ----------

async function shutdown(): Promise<void> {
  console.log('\n[server] Shutting down...');
  heartbeat.stop();
  sshHealth.stop();
  fleetHealthMonitor?.stop();
  clearInterval(stuckTaskInterval);

  if (nc) {
    try { await nc.drain(); } catch { /* ignore */ }
  }

  server.close(() => {
    db.close();
    console.log('[server] Closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
