import { Router } from 'express';
import { authRouter } from './auth.js';
import { healthRouter } from './health.js';
import { createDiscussionRouter } from './discussions.js';
import { createTaskRouter } from './tasks.js';
import { createAgentRouter } from './agents.js';
import { createCommitteeRouter } from './committees.js';
import type { Queries } from '../db/queries.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { CommitteeManager } from '../governance/committees.js';
import type { WsEnvelope } from '../../../shared/src/protocol.js';

export type BroadcastFn = (envelope: WsEnvelope) => void;

export function createApiRouter(
  queries: Queries,
  dispatcher: TaskDispatcher,
  registry: AgentRegistry,
  broadcast?: BroadcastFn,
  committeeManager?: CommitteeManager,
): Router {
  const router = Router();

  // Public routes (no auth required)
  router.use(healthRouter);
  router.use(authRouter);

  // Protected routes
  router.use(createDiscussionRouter(queries, broadcast));
  router.use(createTaskRouter(queries, dispatcher));
  router.use(createAgentRouter(queries, registry));
  if (committeeManager) {
    router.use(createCommitteeRouter(committeeManager));
  }

  return router;
}
