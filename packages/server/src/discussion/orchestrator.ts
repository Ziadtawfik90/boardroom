import { createEnvelope } from '../../../shared/src/protocol.js';
import type { WsEnvelope } from '../../../shared/src/protocol.js';
import type { AgentId, Message } from '../../../shared/src/types.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { DiscussionManager } from './manager.js';
import type { Queries } from '../db/queries.js';
import type { TaskPlanner } from '../task/planner.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import { getAdvisorResponse, getAdvisorTurnResponse, selectRelevantAdvisors } from '../ai/advisors.js';
import { runClaudeOnPC } from '../task/ssh-runner.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { config } from '../config.js';

const LOCAL_AGENT_IDS: AgentId[] = ['asus', 'water', 'steam'];

type BroadcastFn = (envelope: WsEnvelope) => void;

type DiscussionPhase = 'solo' | 'positions' | 'debate' | 'converge' | 'review';
type DiscussionType = 'brainstorm' | 'evaluate' | 'decide' | 'inform';

interface DiscussionBrief {
  text: string;
  objective: string;
  background: string;
  keyQuestion: string;
  constraints: string;
}

interface DiscussionState {
  discussionId: string;
  triggerMessage: Message;
  turnCount: number;
  maxTurns: number;
  speakerHistory: string[];
  spokenThisCycle: Set<string>;
  consecutivePasses: number;
  agreementScore: number;
  currentAgent: AgentId | null;
  timeout: ReturnType<typeof setTimeout> | null;
  pendingNextSpeaker: AgentId | null;
  phase: DiscussionPhase;
  discussionType: DiscussionType;
  agentConfidence: Map<string, string>;
  soloResponses: Map<string, string>;
  soloExpected: number;
  brief: DiscussionBrief | null;
}

const AGREE_SIGNALS = /\b(agree|right|good point|makes sense|let's do|aligned|that works|fair enough|on board|convinced)\b/i;
const DISAGREE_SIGNALS = /\b(disagree|don't think|push back|concern|risk|what about|but |however|what if|don't buy|wrong|problem with|issue with|overlooking|missing)\b/i;

function classifyDiscussion(content: string): DiscussionType {
  if (/\b(pick|choose|decide|go.or.no.go|vote|commit|which one|select)\b/i.test(content)) return 'decide';
  if (/\b(should we|pros and cons|compare|evaluate|assess|review|weigh)\b/i.test(content)) return 'evaluate';
  if (/\b(fyi|update on|announcing|just so you know|here.s what happened)\b/i.test(content)) return 'inform';
  if (/\b(explore|ideas|what if|brainstorm|think about|discuss|let.s talk)\b/i.test(content)) return 'brainstorm';
  return 'brainstorm';
}

export class DiscussionOrchestrator {
  private state: DiscussionState | null = null;
  private recentAgentMessages: string[] = [];

  private dispatcher: TaskDispatcher | null = null;
  private workspaceManager: WorkspaceManager | null = null;

  constructor(
    private registry: AgentRegistry,
    private discussionManager: DiscussionManager,
    private broadcast: BroadcastFn,
    private queries?: Queries,
    private taskPlanner?: TaskPlanner,
  ) {}

  setDispatcher(dispatcher: TaskDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm;
  }

  isActive(discussionId: string): boolean {
    return this.state !== null && this.state.discussionId === discussionId;
  }

  /** Reconvene a discussion after tasks complete — enters review phase */
  reconvene(discussionId: string, trigger: string, actionLog: string): void {
    // If another discussion is active, skip
    if (this.state) {
      console.log(`[orchestrator] Cannot reconvene ${discussionId} — another discussion is active`);
      return;
    }

    if (!this.queries) return;

    // Gate: ALL PC agents must be online before reconvening
    const offlineAgents: string[] = [];
    for (const agentId of LOCAL_AGENT_IDS) {
      const agent = this.queries.getAgent(agentId);
      if (!agent || agent.status === 'offline') {
        offlineAgents.push(agentId);
      }
    }
    if (offlineAgents.length > 0) {
      console.log(`[orchestrator] Cannot reconvene ${discussionId} — agents offline: ${offlineAgents.join(', ')}`);
      return;
    }

    const discussion = this.queries.getDiscussion(discussionId);
    if (!discussion) return;

    // Post the action log as a system message
    const logMsg = this.discussionManager.addMessage(
      discussionId,
      'system',
      actionLog,
      'system',
    );
    this.broadcast(createEnvelope('message.new', { discussionId, message: logMsg }, 'system'));

    const onlineAgents = this.registry.getConnectedIds() as AgentId[];
    if (onlineAgents.length === 0) return;

    // Initialize state in review phase
    this.state = {
      discussionId,
      triggerMessage: logMsg,
      turnCount: 0,
      maxTurns: onlineAgents.length + 1, // one round of review
      speakerHistory: [],
      spokenThisCycle: new Set(),
      consecutivePasses: 0,
      agreementScore: 0,
      currentAgent: null,
      timeout: null,
      pendingNextSpeaker: null,
      phase: 'review',
      discussionType: 'evaluate',
      agentConfidence: new Map(),
      soloResponses: new Map(),
      soloExpected: 0,
      brief: null,
    };

    this.recentAgentMessages = [];

    console.log(`[orchestrator] Reconvening discussion ${discussionId} (trigger=${trigger}, phase=review, agents=${onlineAgents.join(', ')})`);

    this.selectAndPromptNext();
  }

  startRound(discussionId: string, triggerMessage: Message): void {
    if (this.state?.timeout) {
      clearTimeout(this.state.timeout);
    }

    // Gate: ALL PC agents must be online before a meeting can start.
    // Each agent must be running on its own PC — prevents overloading one machine.
    if (this.queries) {
      const offlineAgents: string[] = [];
      for (const agentId of LOCAL_AGENT_IDS) {
        const agent = this.queries.getAgent(agentId);
        if (!agent || agent.status === 'offline') {
          offlineAgents.push(agentId);
        }
      }
      if (offlineAgents.length > 0) {
        const error = `Cannot start meeting — agents offline: ${offlineAgents.join(', ')}. All PC agents must be online and running on their own machines.`;
        console.log(`[orchestrator] ${error}`);
        const msg = this.discussionManager.addMessage(discussionId, 'system', error, 'system');
        this.broadcast(createEnvelope('message.new', { discussionId, message: msg }, 'system'));
        return;
      }
    }

    // All local agents participate (SSH fallback for disconnected ones)
    const allAgents: AgentId[] = [...LOCAL_AGENT_IDS];
    if (allAgents.length === 0) return;

    // Parse structured brief from the discussion's topic column
    let brief: DiscussionBrief | null = null;
    if (this.queries) {
      const discussion = this.queries.getDiscussion(discussionId);
      if (discussion?.topic) {
        try {
          const parsed = JSON.parse(discussion.topic);
          if (parsed.objective) {
            brief = parsed as DiscussionBrief;
          }
        } catch { /* not a structured brief, use content as-is */ }
      }
    }

    const discussionType: DiscussionType = brief?.objective
      ? (brief.objective as DiscussionType)
      : classifyDiscussion(triggerMessage.content);
    const maxTurnsMap: Record<DiscussionType, number> = {
      brainstorm: 12,
      evaluate: 9,
      decide: 9,
      inform: 3,
    };

    const initialPhase: DiscussionPhase = discussionType === 'inform' ? 'positions' : 'solo';

    this.state = {
      discussionId,
      triggerMessage,
      turnCount: 0,
      maxTurns: maxTurnsMap[discussionType],
      speakerHistory: [],
      spokenThisCycle: new Set(),
      consecutivePasses: 0,
      agreementScore: 0,
      currentAgent: null,
      timeout: null,
      pendingNextSpeaker: null,
      phase: initialPhase,
      discussionType,
      agentConfidence: new Map(),
      soloResponses: new Map(),
      soloExpected: allAgents.length,
      brief,
    };

    this.recentAgentMessages = [];

    console.log(`[orchestrator] Discussion started (type=${discussionType}, phase=${initialPhase}), agents: ${allAgents.join(', ')}`);

    if (initialPhase === 'solo') {
      // Send solo analyze to ALL agents simultaneously
      const soloPrompt = "Form your independent position on this topic. Don't try to align with others — you'll hear their takes next. What's your gut reaction, main concern, and proposal? [2-4 sentences]";

      for (const agentId of allAgents) {
        const ws = this.registry.getConnection(agentId);
        if (ws) {
          // Connected via WebSocket — send directly
          const turnEnvelope = createEnvelope('discussion.your_turn', {
            discussionId,
            turnPrompt: soloPrompt,
            turnCount: 0,
          }, 'system');
          ws.send(JSON.stringify(turnEnvelope));
        } else {
          // Not connected — SSH fallback for solo
          const agent = this.queries?.getAgent(agentId);
          const sshAlias = agent?.sshAlias ?? null;
          const agentName = agent?.name ?? agentId.toUpperCase();
          const agentRole = agent?.role ?? 'Agent';

          // SAFETY: Remote agents must run on their own PC, never locally
          if (!sshAlias && agentId !== 'asus') {
            console.log(`[orchestrator] Solo REFUSED for ${agentId} — no SSH alias, cannot run locally`);
            if (this.state) {
              this.state.soloExpected--;
              if (this.state.soloResponses.size >= this.state.soloExpected) {
                this.advancePhase();
                this.selectAndPromptNext();
              }
            }
            continue;
          }

          const prompt = [
            `You are ${agentName} (${agentRole}), a Boardroom agent.`,
            '',
            `TOPIC: ${triggerMessage.content}`,
            '',
            soloPrompt,
            '',
            'Respond in 2-4 sentences. Do NOT prefix with your name.',
          ].join('\n');

          console.log(`[orchestrator] Solo SSH: ${agentId} (ssh=${sshAlias ?? 'local'})`);

          runClaudeOnPC(sshAlias, prompt, 60_000).then((result) => {
            if (result.success && result.output && this.state) {
              // Post as agent message
              const msg = this.discussionManager.addMessage(discussionId, agentId, result.output, 'message');
              this.broadcast(createEnvelope('message.new', { discussionId, message: msg }, 'system'));
              // Feed into solo collection
              this.onAgentResponse(agentId, result.output);
            } else {
              console.log(`[orchestrator] Solo SSH failed for ${agentId}`);
              if (this.state) {
                this.state.soloExpected--;
                // Check if all expected are in
                if (this.state.soloResponses.size >= this.state.soloExpected) {
                  this.advancePhase();
                  this.selectAndPromptNext();
                }
              }
            }
          }).catch(() => {
            if (this.state) this.state.soloExpected--;
          });
        }
      }

      // Timeout for solo phase: 90 seconds
      this.state.timeout = setTimeout(() => {
        console.log(`[orchestrator] Solo phase timed out, advancing with ${this.state?.soloResponses.size ?? 0} responses`);
        if (this.state && this.state.phase === 'solo') {
          this.advancePhase();
          this.selectAndPromptNext();
        }
      }, 90_000);
    } else {
      this.selectAndPromptNext();
    }
  }

  /** Chairman (user) intervenes mid-discussion */
  onChairmanIntervention(discussionId: string, content: string): void {
    if (!this.state || this.state.discussionId !== discussionId) return;

    // Reset cycle so all agents react to the chairman
    this.state.spokenThisCycle.clear();
    this.state.consecutivePasses = 0;

    // Check if the chairman addressed a specific agent
    const addressed = this.detectAddressedAgent(content);
    if (addressed) {
      this.state.pendingNextSpeaker = addressed;
    }

    // If no agent is currently speaking, kick off the next turn
    if (!this.state.currentAgent && this.state.phase !== 'solo') {
      this.selectAndPromptNext();
    }
  }

  onAgentResponse(agentId: string, content: string): void {
    if (!this.state) return;

    // Parse confidence tag
    const confidenceMatch = content.match(/\[(HIGH|MEDIUM|LOW)\]\s*$/i);
    if (confidenceMatch) {
      this.state.agentConfidence.set(agentId, confidenceMatch[1]!.toUpperCase());
    }

    // Solo phase: collect responses from all agents simultaneously
    if (this.state.phase === 'solo') {
      this.state.soloResponses.set(agentId, content);
      this.state.speakerHistory.push(agentId);
      this.state.turnCount++;

      console.log(`[orchestrator] Solo response from ${agentId} (${this.state.soloResponses.size}/${this.state.soloExpected})`);

      if (this.state.soloResponses.size >= this.state.soloExpected) {
        if (this.state.timeout) {
          clearTimeout(this.state.timeout);
          this.state.timeout = null;
        }
        this.advancePhase();
        this.selectAndPromptNext();
      }
      return;
    }

    // Sequential phase: only accept from the current speaker
    if (this.state.currentAgent !== agentId) return;

    if (this.state.timeout) {
      clearTimeout(this.state.timeout);
      this.state.timeout = null;
    }

    // Track the response
    if (content === '*passes*') {
      this.state.consecutivePasses++;
    } else {
      this.state.consecutivePasses = 0;
      this.recentAgentMessages.push(content);
      if (this.recentAgentMessages.length > 6) {
        this.recentAgentMessages.shift();
      }
    }

    this.state.speakerHistory.push(agentId);
    this.state.spokenThisCycle.add(agentId);
    this.state.turnCount++;
    this.state.currentAgent = null;

    // Recalculate agreement
    this.state.agreementScore = this.calculateAgreement();

    // Check if everyone in this cycle has spoken — advance phase
    const participants = this.getParticipants();
    if (this.state.spokenThisCycle.size >= participants.length) {
      this.maybeAdvancePhase();
    }

    // Pause between agents
    setTimeout(() => {
      this.selectAndPromptNext();
    }, 1500);
  }

  private maybeAdvancePhase(): void {
    if (!this.state) return;

    const { phase, discussionType } = this.state;

    if (phase === 'review') {
      // After review, check if agents raised issues (disagreement/concerns)
      if (this.state.agreementScore < 0.6 || this.state.consecutivePasses === 0) {
        // Issues found — transition to positions for a new round of discussion
        console.log(`[orchestrator] Review raised issues (agreement=${this.state.agreementScore.toFixed(2)}), continuing to positions`);
        this.advanceTo('positions');
      } else {
        // Everything looks good — discussion closes cleanly
        console.log(`[orchestrator] Review complete, no issues. Discussion closed.`);
        this.state = null;
        return;
      }
    } else if (phase === 'positions') {
      this.advanceTo('debate');
    } else if (phase === 'debate') {
      this.advanceTo('converge');
    } else if (phase === 'converge') {
      if (discussionType === 'decide') {
        this.triggerVoteRound();
        return;
      }
      // Extract tasks before ending
      const discussionId = this.state.discussionId;
      this.extractAndPostTasks().then(() => {
        console.log(`[orchestrator] Discussion complete after converge phase`);
      }).catch(err => {
        console.error(`[orchestrator] Task extraction failed:`, err);
      });
      this.state = null;
      return;
    }
  }

  private advancePhase(): void {
    if (!this.state) return;
    const { phase } = this.state;

    if (phase === 'solo') {
      this.advanceTo('positions');
    } else if (phase === 'positions') {
      this.advanceTo('debate');
    } else if (phase === 'debate') {
      this.advanceTo('converge');
    }
  }

  private advanceTo(newPhase: DiscussionPhase): void {
    if (!this.state) return;
    console.log(`[orchestrator] Phase: ${this.state.phase} → ${newPhase}`);
    this.state.phase = newPhase;
    this.state.spokenThisCycle.clear();
  }

  private triggerVoteRound(): void {
    if (!this.state) return;

    const onlineAgents = this.registry.getConnectedIds() as AgentId[];
    const votePrompt = "Final vote. One sentence: what's your position? End with [FOR], [AGAINST], or [ABSTAIN].";
    const discussionId = this.state.discussionId;

    // Send vote request to all local agents
    for (const agentId of onlineAgents) {
      const ws = this.registry.getConnection(agentId);
      if (!ws) continue;

      const envelope = createEnvelope('discussion.your_turn', {
        discussionId,
        turnPrompt: votePrompt,
        turnCount: this.state.turnCount,
      }, 'system');
      ws.send(JSON.stringify(envelope));
    }

    // Also request advisory votes from cloud advisors
    const advisors = config.enableAdvisors ? selectRelevantAdvisors(this.state.discussionType) : [];
    const advisorVotePromises = advisors.map(async (advisorId) => {
      if (!this.queries) return;
      const messages = this.queries.getMessages(discussionId, 20);
      const briefData = this.state?.brief
        ? { title: this.state.triggerMessage.content, background: this.state.brief.background, keyQuestion: this.state.brief.keyQuestion }
        : undefined;
      const result = await getAdvisorTurnResponse(advisorId, 'converge', messages, briefData);
      if (result && result.response && this.state) {
        // Post advisor vote as a message
        const msg = this.discussionManager.addMessage(
          discussionId,
          advisorId as import('../../../shared/src/types.js').Sender,
          result.response,
          'message',
        );
        this.broadcast(createEnvelope('message.new', { discussionId, message: msg }, 'system'));
        // Add to solo collection with [ADVISORY] tag
        this.state.soloResponses.set(advisorId, result.response);
      }
    });

    // Fire advisor votes in background (don't block)
    Promise.all(advisorVotePromises).catch(err =>
      console.error('[orchestrator] Advisor vote collection failed:', err),
    );

    // Repurpose solo mechanism for collecting votes
    this.state.phase = 'solo' as DiscussionPhase;
    this.state.soloResponses.clear();
    this.state.soloExpected = onlineAgents.length; // Only local agents count toward quorum

    // Override: after collecting, tally
    const originalState = this.state;
    const checkVotes = (): void => {
      if (!originalState || originalState.soloResponses.size < originalState.soloExpected) return;

      let forCount = 0;
      let againstCount = 0;
      let abstainCount = 0;
      const bindingPositions: string[] = [];
      const advisoryPositions: string[] = [];

      for (const [agent, response] of originalState.soloResponses) {
        const isAdvisory = agent === 'oracle' || agent === 'sage';
        const targetList = isAdvisory ? advisoryPositions : bindingPositions;

        if (/\[FOR\]\s*$/i.test(response)) {
          if (!isAdvisory) forCount++;
          targetList.push(`${agent}: FOR${isAdvisory ? ' [ADVISORY]' : ''}`);
        } else if (/\[AGAINST\]\s*$/i.test(response)) {
          if (!isAdvisory) againstCount++;
          targetList.push(`${agent}: AGAINST${isAdvisory ? ' [ADVISORY]' : ''}`);
        } else {
          if (!isAdvisory) abstainCount++;
          targetList.push(`${agent}: ABSTAIN${isAdvisory ? ' [ADVISORY]' : ''}`);
        }
      }

      let summary = `Vote: ${forCount} FOR, ${againstCount} AGAINST, ${abstainCount} ABSTAIN. ${bindingPositions.join(', ')}.`;
      if (advisoryPositions.length > 0) {
        summary += ` Advisory: ${advisoryPositions.join(', ')}.`;
      }
      console.log(`[orchestrator] ${summary}`);

      // Post system message with vote results
      this.discussionManager.addMessage(discussionId, 'system', summary, 'system');
      const msgEnvelope = createEnvelope('message.new', {
        discussionId,
        message: {
          id: crypto.randomUUID(),
          discussionId,
          sender: 'system',
          content: summary,
          type: 'system',
          parentId: null,
          metadata: null,
          createdAt: new Date().toISOString(),
        },
      }, 'system');
      this.broadcast(msgEnvelope);

      this.state = null;
    };

    // Patch: intercept solo collection completion to tally
    const origOnAgent = this.onAgentResponse.bind(this);
    const self = this;
    // Set a timeout for vote collection
    this.state.timeout = setTimeout(() => {
      console.log(`[orchestrator] Vote round timed out`);
      checkVotes();
    }, 60_000);

    // The existing solo collection in onAgentResponse will collect responses.
    // We need a post-collection hook. We'll store checkVotes and call it.
    (this.state as DiscussionState & { _voteCallback?: () => void })._voteCallback = checkVotes;
  }

  private async extractAndPostTasks(): Promise<void> {
    if (!this.state || !this.queries || !this.taskPlanner) return;

    const discussionId = this.state.discussionId;
    const messages = this.queries.getMessages(discussionId, 15);

    // Create workspace if not exists — use user-chosen path if provided
    if (this.workspaceManager) {
      const topic = messages.map(m => m.content).join(' ');
      let userPath: string | undefined;
      const discussion = this.queries.getDiscussion(discussionId);
      if (discussion?.topic) {
        try {
          const parsed = JSON.parse(discussion.topic);
          if (parsed.workspacePath) userPath = parsed.workspacePath;
        } catch {}
      }
      this.workspaceManager.getOrCreate(discussionId, topic, userPath);
    }

    let tasks: import('../../../shared/src/types.js').Task[];
    try {
      tasks = await this.taskPlanner.extractTasksLLM(discussionId, messages);
      console.log(`[orchestrator] LLM extracted ${tasks.length} tasks`);
    } catch (err) {
      console.error('[orchestrator] LLM extraction failed, falling back to regex:', err);
      tasks = [];
      const regexTasks = this.taskPlanner.extractTasks(discussionId, messages);
      if (regexTasks.length > 0) {
        const ids = this.taskPlanner.createExtractedTasks(discussionId, regexTasks);
        tasks = ids.map(id => this.queries!.getTask(id)!).filter(Boolean);
      }
    }

    if (tasks.length > 0) {
      // Broadcast each task to dashboard clients
      for (const task of tasks) {
        this.broadcast(createEnvelope('task.created', { task }, 'system'));
      }

      // Separate round 1 tasks (no dependencies) from later rounds
      const round1 = tasks.filter(t => t.dependencies.length === 0);
      const later = tasks.filter(t => t.dependencies.length > 0);

      // Auto-approve eligible tasks (consent agenda)
      const autoApproved: string[] = [];
      const needsApproval: string[] = [];

      for (const task of tasks) {
        if (this.taskPlanner!.autoApproveEligible(task)) {
          this.queries!.approveTask(task.id, 'consent-agenda');
          autoApproved.push(`- ${task.assignee.toUpperCase()}: ${task.title} [${task.risk}]`);
        } else {
          needsApproval.push(`- ${task.assignee.toUpperCase()}: ${task.title} [${task.risk}]`);
        }
      }

      let sysContent = '';
      if (autoApproved.length > 0) {
        sysContent += `Consent agenda — ${autoApproved.length} task(s) auto-approved (low risk):\n${autoApproved.join('\n')}`;
      }
      if (needsApproval.length > 0) {
        if (sysContent) sysContent += '\n\n';
        sysContent += `${needsApproval.length} task(s) require chairman approval:\n${needsApproval.join('\n')}`;
      }
      if (later.length > 0) {
        sysContent += `\n\n${later.length} task(s) queued for later rounds (waiting on dependencies).`;
      }

      const sysMsg = this.discussionManager.addMessage(
        discussionId,
        'system',
        sysContent,
        'system',
      );
      this.broadcast(createEnvelope('message.new', { discussionId, message: sysMsg }, 'system'));

      // Dispatch only round 1 tasks (no dependencies)
      if (this.dispatcher) {
        for (const task of round1) {
          const updated = this.queries!.getTask(task.id);
          if (updated?.status === 'approved') {
            this.dispatcher.dispatchIfReady(updated);
          }
        }
      }
    }
  }

  /** Get all participants: ALL local agents (connected or not) + relevant cloud advisors */
  private getParticipants(): string[] {
    // Include all local agents — SSH fallback handles disconnected ones
    const local: string[] = [...LOCAL_AGENT_IDS];
    if (!config.enableAdvisors || !this.state) return local;

    const advisors = selectRelevantAdvisors(this.state.discussionType);
    return [...local, ...advisors];
  }

  private isAdvisor(id: string): boolean {
    return id === 'oracle' || id === 'sage';
  }

  private selectAndPromptNext(): void {
    if (!this.state) return;

    // Check stop conditions
    if (!this.shouldContinue()) {
      console.log(`[orchestrator] Discussion ending: turns=${this.state.turnCount}, passes=${this.state.consecutivePasses}, agreement=${this.state.agreementScore.toFixed(2)}`);
      this.extractAndPostTasks().catch(err =>
        console.error('[orchestrator] Task extraction failed:', err),
      );
      this.state = null;
      return;
    }

    const participants = this.getParticipants();
    const onlineAgents = this.registry.getConnectedIds() as AgentId[];
    const nextAgent = this.pickNextSpeaker(participants as AgentId[]);

    if (!nextAgent) {
      console.log(`[orchestrator] No available speaker, discussion ends`);
      this.state = null;
      return;
    }

    // Cloud advisor — handle via LLM call instead of WebSocket
    if (this.isAdvisor(nextAgent)) {
      this.handleAdvisorTurn(nextAgent);
      return;
    }

    const ws = this.registry.getConnection(nextAgent);
    if (!ws) {
      // Agent not connected via WebSocket — use SSH fallback
      this.handleSshTurn(nextAgent);
      return;
    }

    this.state.currentAgent = nextAgent;
    const turnPrompt = this.buildTurnPrompt(nextAgent, onlineAgents);

    console.log(`[orchestrator] Turn ${this.state.turnCount + 1}: ${nextAgent} (phase=${this.state.phase}, agreement: ${this.state.agreementScore.toFixed(2)})`);

    // Typing indicator
    const typingEnvelope = createEnvelope('message.typing.indicator', {
      discussionId: this.state.discussionId,
      sender: nextAgent,
    }, 'system');
    this.broadcast(typingEnvelope);

    // Send turn prompt
    const turnEnvelope = createEnvelope('discussion.your_turn', {
      discussionId: this.state.discussionId,
      turnPrompt,
      turnCount: this.state.turnCount,
    }, 'system');
    ws.send(JSON.stringify(turnEnvelope));

    // 60s timeout
    this.state.timeout = setTimeout(() => {
      console.log(`[orchestrator] ${nextAgent} timed out`);
      if (this.state) {
        this.state.currentAgent = null;
        this.state.spokenThisCycle.add(nextAgent);
        this.state.turnCount++;
        this.selectAndPromptNext();
      }
    }, 60_000);
  }

  /** Handle an advisor's turn via async LLM call */
  private handleAdvisorTurn(advisorId: string): void {
    if (!this.state || !this.queries) return;

    const discussionId = this.state.discussionId;
    const phase = this.state.phase;

    console.log(`[orchestrator] Advisor turn: ${advisorId} (phase=${phase})`);

    // Typing indicator
    const typingEnvelope = createEnvelope('message.typing.indicator', {
      discussionId,
      sender: advisorId as import('../../../shared/src/types.js').Sender,
    }, 'system');
    this.broadcast(typingEnvelope);

    const messages = this.queries.getMessages(discussionId, 20);
    const briefData = this.state.brief
      ? { title: this.state.triggerMessage.content, background: this.state.brief.background, keyQuestion: this.state.brief.keyQuestion }
      : undefined;

    // 15s timeout for advisor response
    const timeoutMs = 15_000;
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));

    Promise.race([
      getAdvisorTurnResponse(advisorId, phase, messages, briefData),
      timeoutPromise,
    ]).then((result) => {
      if (!this.state || this.state.discussionId !== discussionId) return;

      if (result && result.response) {
        // Post advisor message
        const msg = this.discussionManager.addMessage(
          discussionId,
          advisorId as import('../../../shared/src/types.js').Sender,
          result.response,
          'message',
        );
        const envelope = createEnvelope('message.new', { discussionId, message: msg }, 'system');
        this.broadcast(envelope);

        // Track as a normal response
        this.recentAgentMessages.push(result.response);
        if (this.recentAgentMessages.length > 6) this.recentAgentMessages.shift();
      } else {
        console.log(`[orchestrator] Advisor ${advisorId} timed out or returned empty, skipping`);
      }

      // Mark as spoken and advance
      this.state!.spokenThisCycle.add(advisorId);
      this.state!.speakerHistory.push(advisorId);
      this.state!.turnCount++;

      // Check if cycle complete
      const participants = this.getParticipants();
      if (this.state!.spokenThisCycle.size >= participants.length) {
        this.maybeAdvancePhase();
      }

      setTimeout(() => this.selectAndPromptNext(), 1500);
    }).catch((err) => {
      console.error(`[orchestrator] Advisor ${advisorId} error:`, err);
      if (this.state) {
        this.state.spokenThisCycle.add(advisorId);
        this.state.turnCount++;
        setTimeout(() => this.selectAndPromptNext(), 1500);
      }
    });
  }

  /** Handle a local agent's turn via SSH when not connected via WebSocket */
  private handleSshTurn(agentId: AgentId): void {
    if (!this.state || !this.queries) return;

    const discussionId = this.state.discussionId;
    const phase = this.state.phase;
    const onlineAgents = this.registry.getConnectedIds() as AgentId[];
    const turnPrompt = this.buildTurnPrompt(agentId, [...onlineAgents, agentId]);

    const agent = this.queries.getAgent(agentId);
    const sshAlias = agent?.sshAlias ?? null;
    const agentName = agent?.name ?? agentId.toUpperCase();
    const agentRole = agent?.role ?? 'Agent';

    // SAFETY: Remote agents must run on their own PC, never locally
    if (!sshAlias && agentId !== 'asus') {
      console.log(`[orchestrator] SSH turn REFUSED for ${agentId} — no SSH alias, cannot run locally`);
      this.state!.spokenThisCycle.add(agentId);
      this.state!.speakerHistory.push(agentId);
      this.state!.turnCount++;
      const participants = this.getParticipants();
      if (this.state!.spokenThisCycle.size >= participants.length) {
        this.advancePhase();
      }
      this.selectAndPromptNext();
      return;
    }

    console.log(`[orchestrator] SSH turn: ${agentId} (phase=${phase}, ssh=${sshAlias ?? 'local'})`);

    // Typing indicator
    this.broadcast(createEnvelope('message.typing.indicator', {
      discussionId,
      sender: agentId as import('../../../shared/src/types.js').Sender,
    }, 'system'));

    // Build prompt with agent persona + workspace state + discussion context + turn prompt
    const messages = this.queries.getMessages(discussionId, 20);
    const contextLines: string[] = [
      `You are ${agentName} (${agentRole}), a Boardroom agent participating in a discussion.`,
      '',
    ];

    // Include workspace state if available
    if (this.workspaceManager) {
      const wsStatus = this.workspaceManager.getStatus(discussionId);
      if (wsStatus && wsStatus.files.length > 0) {
        contextLines.push('WORKSPACE STATE (what has been built so far):');
        contextLines.push(wsStatus.summary);
        contextLines.push('');
      }
    }

    if (messages.length > 0) {
      contextLines.push('DISCUSSION SO FAR:');
      for (const m of messages) {
        contextLines.push(`  [${m.sender.toUpperCase()}]: ${m.content}`);
      }
      contextLines.push('');
    }
    contextLines.push(
      'YOUR TURN:',
      turnPrompt,
      '',
      'Respond in 2-5 sentences. Be direct and specific. Do NOT prefix with your name.',
    );

    const prompt = contextLines.join('\n');

    runClaudeOnPC(sshAlias, prompt, 60_000).then((result) => {
      if (!this.state || this.state.discussionId !== discussionId) return;

      if (result.success && result.output) {
        // Post agent message
        const msg = this.discussionManager.addMessage(
          discussionId,
          agentId as import('../../../shared/src/types.js').Sender,
          result.output,
          'message',
        );
        this.broadcast(createEnvelope('message.new', { discussionId, message: msg }, 'system'));

        // Track response
        this.recentAgentMessages.push(result.output);
        if (this.recentAgentMessages.length > 6) this.recentAgentMessages.shift();

        // Feed into onAgentResponse for phase tracking
        this.onAgentResponse(agentId, result.output);
      } else {
        console.log(`[orchestrator] SSH turn failed for ${agentId}: ${result.output?.substring(0, 100)}`);
        // Mark as spoken (skip) and continue
        this.state!.spokenThisCycle.add(agentId);
        this.state!.speakerHistory.push(agentId);
        this.state!.turnCount++;

        const participants = this.getParticipants();
        if (this.state!.spokenThisCycle.size >= participants.length) {
          this.maybeAdvancePhase();
        }
        setTimeout(() => this.selectAndPromptNext(), 1500);
      }
    }).catch((err) => {
      console.error(`[orchestrator] SSH turn error for ${agentId}:`, err);
      if (this.state) {
        this.state.spokenThisCycle.add(agentId);
        this.state.turnCount++;
        setTimeout(() => this.selectAndPromptNext(), 1500);
      }
    });
  }

  private pickNextSpeaker(onlineAgents: AgentId[]): AgentId | null {
    // 1. If someone was directly addressed, they go next
    if (this.state?.pendingNextSpeaker) {
      const next = this.state.pendingNextSpeaker;
      this.state.pendingNextSpeaker = null;
      if (onlineAgents.includes(next) && this.registry.isConnected(next)) {
        return next;
      }
    }

    // 2. Prioritize agents who haven't spoken this cycle
    const unspoken = onlineAgents.filter(
      (id) => !this.state!.spokenThisCycle.has(id),
    );

    if (unspoken.length > 0) {
      // Shuffle to avoid always the same order
      return this.shuffleArray([...unspoken])[0]!;
    }

    // 3. Everyone spoke this cycle — check phase advancement
    this.maybeAdvancePhase();

    if (!this.state) return null; // Discussion ended in phase advancement

    // Pick from all online agents, shuffled
    const shuffled = this.shuffleArray([...onlineAgents]);
    return shuffled[0] ?? null;
  }

  private buildTurnPrompt(agent: AgentId, onlineAgents: AgentId[]): string {
    if (!this.state) return 'Respond to what has been said. Be direct.';

    const { phase, discussionType, agreementScore, agentConfidence, soloResponses } = this.state;

    // --- Review phase (reconvene) ---
    if (phase === 'review') {
      return "Review the action log above. Did the outcomes match expectations? Are there any failures that need addressing, follow-up tasks needed, or new concerns? If everything looks good, say so briefly. [2-4 sentences]";
    }

    // --- Solo phase ---
    if (phase === 'solo') {
      return "Form your independent position on this topic. Don't try to align with others — you'll hear their takes next. What's your gut reaction, main concern, and proposal? [2-4 sentences]";
    }

    // --- Positions phase ---
    if (phase === 'positions') {
      let soloContext = "Here's what each board member independently concluded:\n\n";
      for (const [agentId, response] of soloResponses) {
        soloContext += `[${agentId.toUpperCase()}]: ${response}\n\n`;
      }
      soloContext += "\nNow share your refined position. Where do you agree? Where do you fundamentally disagree? What did others miss?";
      return soloContext;
    }

    // --- Debate phase ---
    if (phase === 'debate') {
      if (agreementScore > 0.8) {
        return "The board is converging too fast. Play devil's advocate — what's the strongest argument AGAINST the emerging consensus? What risks is everyone ignoring?";
      }

      // Check if a low-confidence agent exists and current agent might be domain expert
      for (const [lowAgent, confidence] of agentConfidence) {
        if (confidence === 'LOW' && lowAgent !== agent) {
          return `[${lowAgent.toUpperCase()}] expressed low confidence on this. This is your area — challenge or confirm their position with authority.`;
        }
      }

      return "React to what others have said. Challenge assumptions. Build on strong points. Be direct about where you disagree.";
    }

    // --- Converge phase ---
    if (phase === 'converge') {
      if (discussionType === 'decide') {
        return "State your final position clearly. The chairman needs a recommendation. End with [FOR], [AGAINST], or [ABSTAIN] on the proposal.";
      }
      return "The discussion needs to land. Either propose a concrete plan of action with clear ownership, or identify the specific blocker preventing convergence and escalate it to the chairman.";
    }

    return 'Respond to what has been said. Be direct.';
  }

  private shouldContinue(): boolean {
    if (!this.state) return false;

    const { turnCount, maxTurns, consecutivePasses, discussionType, phase } = this.state;
    const agentCount = this.registry.getConnectedIds().length;

    // 'inform' type: stop after 1 cycle regardless
    if (discussionType === 'inform' && this.state.spokenThisCycle.size >= agentCount && turnCount > 0) {
      return false;
    }

    // Hard stop at max turns
    if (turnCount >= maxTurns) return false;

    // Two consecutive passes = discussion is dead
    if (consecutivePasses >= 2) return false;

    // Everyone passed in the same cycle
    if (consecutivePasses >= agentCount) return false;

    return true;
  }

  private calculateAgreement(): number {
    if (this.recentAgentMessages.length < 2) return 0;

    let agreeCount = 0;
    let disagreeCount = 0;

    for (const msg of this.recentAgentMessages) {
      const agrees = (msg.match(AGREE_SIGNALS) || []).length;
      const disagrees = (msg.match(DISAGREE_SIGNALS) || []).length;
      agreeCount += agrees;
      disagreeCount += disagrees;
    }

    const total = agreeCount + disagreeCount;
    if (total === 0) return 0.5; // Neutral if no signals
    return agreeCount / total;
  }

  private detectAddressedAgent(content: string): AgentId | null {
    const upper = content.toUpperCase();
    const agents: AgentId[] = ['asus', 'water', 'steam'];
    for (const agent of agents) {
      if (upper.includes(agent.toUpperCase())) {
        return agent;
      }
    }
    return null;
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
}
