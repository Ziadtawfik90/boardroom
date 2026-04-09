import { v4 as uuidv4 } from 'uuid';
import type { AgentId, Message, Task, TaskType, TaskRiskLevel } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';
import { callOpenRouterJSON } from '../ai/openrouter.js';
import { config } from '../config.js';

export interface TaskPlan {
  title: string;
  description: string | null;
  assignee: AgentId;
  type: TaskType;
  priority: number;
  dependencies: string[];
  risk: TaskRiskLevel;
}

// Legacy regex patterns (fallback)
const COMMITMENT_PATTERNS = [
  /\bI'll\s+(.{10,80})/i,
  /\bI will\s+(.{10,80})/i,
  /\bmy piece is\s+(.{10,80})/i,
  /\bI'm going to\s+(.{10,80})/i,
  /\bI'll handle\s+(.{10,80})/i,
  /\bI'll take\s+(.{10,80})/i,
  /\bI can handle\s+(.{10,80})/i,
];

const AGENT_IDS: AgentId[] = ['asus', 'water', 'steam'];

// Model resolved from config (env-configurable via EXTRACTION_MODEL)
import { config as serverConfig } from '../config.js';

const EXTRACTION_PROMPT = `You are a board secretary analyzing a multi-agent discussion transcript. Extract concrete, actionable tasks that agents committed to or that emerged as action items from the discussion.

AGENT CAPABILITIES:
- ASUS (The Builder): code, git, GitHub, deploy — best for building features, git operations, deployments
- WATER (The Heavy Lifter): code, git, ML, compute — best for ML tasks, heavy computation, data processing
- STEAM (The Operator): code, git, test, batch, deploy — best for testing, batch operations, deployments

RULES:
1. Only extract tasks that are concrete and actionable — not vague suggestions
2. Assign each task to the most capable agent based on the task nature and agent capabilities
3. Each task must have exactly one assignee (asus, water, or steam)
4. CRITICAL: You MUST distribute tasks across ALL THREE agents. Each agent runs on a separate physical PC. NEVER assign all tasks to one agent — that will crash the machine. Spread the workload evenly based on capabilities.
5. Rate risk: "low" for read-only/diagnostic/info tasks, "medium" for code changes/installs, "high" for destructive ops/production changes/security-sensitive
6. If a task depends on another task completing first, list the dependency by referencing the other task's title
7. Type "simple" for single-step tasks, "complex" for multi-step tasks requiring Claude CLI

Return ONLY valid JSON in this exact format:
{
  "tasks": [
    {
      "title": "short imperative title",
      "description": "what specifically needs to be done",
      "assignee": "asus|water|steam",
      "type": "simple|complex",
      "risk": "low|medium|high",
      "priority": 0-10,
      "dependsOn": ["title of prerequisite task"]
    }
  ]
}

If no actionable tasks exist, return {"tasks": []}.`;

interface LLMTaskOutput {
  tasks: Array<{
    title: string;
    description: string;
    assignee: string;
    type: string;
    risk: string;
    priority: number;
    dependsOn?: string[];
  }>;
}

export class TaskPlanner {
  constructor(private queries: Queries) {}

  createTask(discussionId: string | null, plan: TaskPlan): Task {
    const id = uuidv4();
    return this.queries.insertTask(
      id,
      discussionId,
      plan.title,
      plan.description,
      plan.assignee,
      plan.type,
      plan.priority,
      plan.dependencies,
      plan.risk,
    );
  }

  createMultiple(discussionId: string, plans: TaskPlan[]): Task[] {
    return plans.map((plan) => this.createTask(discussionId, plan));
  }

  getTasksForDiscussion(discussionId: string): Task[] {
    return this.queries.listTasksByDiscussion(discussionId);
  }

  /** LLM-based task extraction via Gemini Flash */
  async extractTasksLLM(
    discussionId: string,
    messages: Message[],
  ): Promise<Task[]> {
    // Build transcript for the LLM
    const transcript = messages
      .map(m => `[${m.sender.toUpperCase()}]: ${m.content}`)
      .join('\n');

    const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: `DISCUSSION TRANSCRIPT:\n${transcript}\n\nExtract all actionable tasks from this discussion.` },
    ];

    const result = await callOpenRouterJSON<LLMTaskOutput>(
      serverConfig.extractionModel,
      EXTRACTION_PROMPT,
      chatMessages,
      2000,
    );

    // Validate and filter
    if (!result?.tasks || !Array.isArray(result.tasks)) {
      console.error('[planner] LLM returned invalid structure, falling back to regex');
      return this.extractTasksRegexFallback(discussionId, messages);
    }

    const validTasks = result.tasks.filter(t =>
      t.title &&
      typeof t.title === 'string' &&
      AGENT_IDS.includes(t.assignee as AgentId),
    );

    if (validTasks.length === 0) {
      console.log('[planner] LLM found no valid tasks');
      return [];
    }

    // SAFETY: Rebalance if all tasks assigned to one agent — distribute across PCs
    if (validTasks.length >= 3) {
      const assigneeCounts = new Map<string, number>();
      for (const t of validTasks) {
        assigneeCounts.set(t.assignee, (assigneeCounts.get(t.assignee) ?? 0) + 1);
      }
      const maxOnOneAgent = Math.max(...assigneeCounts.values());
      if (maxOnOneAgent === validTasks.length || maxOnOneAgent > Math.ceil(validTasks.length * 0.6)) {
        console.log(`[planner] Rebalancing: ${maxOnOneAgent}/${validTasks.length} tasks on one agent`);
        // Round-robin redistribute
        for (let i = 0; i < validTasks.length; i++) {
          validTasks[i]!.assignee = AGENT_IDS[i % AGENT_IDS.length]!;
        }
      }
    }

    // Create all tasks first (to get IDs)
    const created: Task[] = [];
    for (const t of validTasks) {
      const id = uuidv4();
      const risk = (['low', 'medium', 'high'].includes(t.risk) ? t.risk : 'medium') as TaskRiskLevel;
      const type = (t.type === 'complex' ? 'complex' : 'simple') as TaskType;
      const task = this.queries.insertTask(
        id,
        discussionId,
        t.title,
        t.description || null,
        t.assignee as AgentId,
        type,
        t.priority ?? 0,
        [], // dependencies resolved below
        risk,
      );
      created.push(task);
    }

    // Resolve dependency titles to UUIDs
    this.resolveDependencyTitles(created, validTasks);

    // Audit
    this.queries.audit('system', 'llm-extract', 'tasks', discussionId, {
      count: created.length,
      tasks: created.map(t => ({ id: t.id, title: t.title, assignee: t.assignee, risk: t.risk })),
    });

    return created;
  }

  /** Resolve dependsOn titles to actual task IDs */
  private resolveDependencyTitles(
    created: Task[],
    llmTasks: LLMTaskOutput['tasks'],
  ): void {
    const titleToId = new Map(created.map(t => [t.title.toLowerCase(), t.id]));

    for (let i = 0; i < llmTasks.length; i++) {
      const deps = llmTasks[i]!.dependsOn;
      if (!deps || deps.length === 0) continue;

      const resolvedIds: string[] = [];
      for (const depTitle of deps) {
        const id = titleToId.get(depTitle.toLowerCase());
        if (id) resolvedIds.push(id);
      }

      if (resolvedIds.length > 0) {
        this.queries.updateTaskDependencies(created[i]!.id, resolvedIds);
        created[i]!.dependencies = resolvedIds;
      }
    }
  }

  /** Legacy regex extraction (fallback when LLM fails) */
  extractTasksRegex(discussionId: string, messages: Message[]): Array<{ title: string; assignee: AgentId }> {
    const extracted: Array<{ title: string; assignee: AgentId }> = [];

    for (const msg of messages) {
      if (!AGENT_IDS.includes(msg.sender as AgentId)) continue;

      for (const pattern of COMMITMENT_PATTERNS) {
        const match = msg.content.match(pattern);
        if (match && match[1]) {
          const title = match[1].replace(/[.!,;]+$/, '').trim();
          if (title.length > 10) {
            extracted.push({ title, assignee: msg.sender as AgentId });
            break;
          }
        }
      }
    }

    return extracted;
  }

  /** Full fallback: regex extract + create tasks */
  private extractTasksRegexFallback(discussionId: string, messages: Message[]): Task[] {
    const extracted = this.extractTasksRegex(discussionId, messages);
    const tasks: Task[] = [];
    for (const item of extracted) {
      const id = uuidv4();
      const task = this.queries.insertTask(
        id,
        discussionId,
        item.title,
        null,
        item.assignee,
        'simple',
        0,
        [],
        'medium',
      );
      tasks.push(task);
    }
    return tasks;
  }

  /** Check if a task is eligible for auto-approval (consent agenda) */
  autoApproveEligible(task: Task): boolean {
    const allowedRisks = config.autoApproveRiskLevels;
    return (
      allowedRisks.includes(task.risk) &&
      task.type === 'simple' &&
      task.status === 'pending'
    );
  }

  // Keep old method name for backward compat (used in old orchestrator code path)
  extractTasks(discussionId: string, messages: Message[]): Array<{ title: string; assignee: AgentId }> {
    return this.extractTasksRegex(discussionId, messages);
  }

  createExtractedTasks(discussionId: string, tasks: Array<{ title: string; assignee: AgentId }>): string[] {
    const ids: string[] = [];
    for (const task of tasks) {
      const id = uuidv4();
      this.queries.insertTask(
        id,
        discussionId,
        task.title,
        null,
        task.assignee,
        'simple',
        0,
        [],
        'medium',
      );
      ids.push(id);
    }
    return ids;
  }
}
