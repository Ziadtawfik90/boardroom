/**
 * ChairmanManager — manages chairman sessions across discussions.
 *
 * One chairman session per active discussion.
 * Handles creation, lookup, and cleanup.
 */

import type { WsEnvelope } from '../../../shared/src/protocol.js';
import type { Queries } from '../db/queries.js';
import type { DiscussionManager } from '../discussion/manager.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type { ChairmanConfig } from './types.js';
import { ChairmanSession } from './session.js';
import { config as serverConfig } from '../config.js';

type BroadcastFn = (envelope: WsEnvelope) => void;

export class ChairmanManager {
  private sessions = new Map<string, ChairmanSession>();
  private config: ChairmanConfig;

  constructor(
    private queries: Queries,
    private discussionManager: DiscussionManager,
    private dispatcher: TaskDispatcher,
    private broadcast: BroadcastFn,
  ) {
    this.config = {
      model: serverConfig.chairmanModel,
      maxInterventions: serverConfig.chairmanMaxInterventions,
      evaluateEveryCycle: true,
      autoApproveEnabled: true,
      maxTokens: 800,
    };
  }

  get enabled(): boolean {
    return serverConfig.chairmanEnabled;
  }

  /** Start a chairman session for a discussion */
  async startSession(
    discussionId: string,
    title: string,
    topic: string,
    brief?: { objective: string; background: string; keyQuestion: string; constraints: string },
  ): Promise<ChairmanSession | null> {
    if (!this.enabled) return null;

    // Don't start duplicate sessions
    if (this.sessions.has(discussionId)) {
      return this.sessions.get(discussionId)!;
    }

    const session = new ChairmanSession(
      discussionId,
      this.config,
      this.queries,
      this.discussionManager,
      this.dispatcher,
      this.broadcast,
    );

    this.sessions.set(discussionId, session);
    await session.start(title, topic, brief);

    console.log(`[chairman-mgr] Session created for discussion ${discussionId}`);
    return session;
  }

  /** Get the active session for a discussion */
  getSession(discussionId: string): ChairmanSession | null {
    return this.sessions.get(discussionId) ?? null;
  }

  /** Close a chairman session */
  closeSession(discussionId: string): void {
    const session = this.sessions.get(discussionId);
    if (session) {
      session.close();
      this.sessions.delete(discussionId);
      console.log(`[chairman-mgr] Session closed for discussion ${discussionId}`);
    }
  }

  /** Close all sessions (for shutdown) */
  closeAll(): void {
    for (const [id, session] of this.sessions) {
      session.close();
    }
    this.sessions.clear();
  }

  /** Get count of active sessions */
  get activeCount(): number {
    return this.sessions.size;
  }
}
