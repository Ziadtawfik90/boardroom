import Database from 'better-sqlite3';
import type {
  Agent,
  AgentId,
  AgentStatus,
  Discussion,
  DiscussionStatus,
  Message,
  Task,
  TaskLog,
  TaskRiskLevel,
  TaskStatus,
  Sender,
  MessageType,
  TaskType,
  LogLevel,
} from '../../../shared/src/types.js';

// ---------- Row types (snake_case from SQLite) ----------

interface AgentRow {
  id: string;
  name: string;
  role: string;
  host: string;
  ssh_alias: string | null;
  status: string;
  capabilities: string;
  last_heartbeat: string | null;
}

interface DiscussionRow {
  id: string;
  title: string;
  topic: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface MessageRow {
  id: string;
  discussion_id: string;
  sender: string;
  content: string;
  type: string;
  parent_id: string | null;
  metadata: string | null;
  created_at: string;
}

interface TaskRow {
  id: string;
  discussion_id: string | null;
  title: string;
  description: string | null;
  assignee: string;
  status: string;
  type: string;
  priority: number;
  dependencies: string | null;
  risk: string | null;
  result: string | null;
  error: string | null;
  progress: number;
  approved_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TaskLogRow {
  id: number;
  task_id: string;
  level: string;
  message: string;
  created_at: string;
}

// ---------- Row to domain mappers ----------

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id as AgentId,
    name: row.name,
    role: row.role,
    host: row.host,
    sshAlias: row.ssh_alias,
    status: row.status as AgentStatus,
    capabilities: JSON.parse(row.capabilities) as string[],
    lastHeartbeat: row.last_heartbeat,
    currentTask: null, // populated at query time
  };
}

function toDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status as DiscussionStatus,
    createdBy: row.created_by as Sender,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    sender: row.sender as Sender,
    content: row.content,
    type: row.type as MessageType,
    parentId: row.parent_id,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    title: row.title,
    description: row.description,
    assignee: row.assignee as AgentId,
    status: row.status as TaskStatus,
    type: row.type as TaskType,
    priority: row.priority,
    dependencies: row.dependencies ? (JSON.parse(row.dependencies) as string[]) : [],
    risk: (row.risk as TaskRiskLevel) ?? 'medium',
    result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null,
    error: row.error,
    progress: row.progress,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toTaskLog(row: TaskLogRow): TaskLog {
  return {
    id: row.id,
    taskId: row.task_id,
    level: row.level as LogLevel,
    message: row.message,
    createdAt: row.created_at,
  };
}

// ---------- Query class ----------

export class Queries {
  private stmts: ReturnType<typeof this.prepareAll>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareAll();
  }

  private prepareAll() {
    return {
      // Agents
      getAllAgents: this.db.prepare<[]>('SELECT * FROM agents ORDER BY id'),
      getAgent: this.db.prepare<[string]>('SELECT * FROM agents WHERE id = ?'),
      updateAgentStatus: this.db.prepare<[string, string]>(
        'UPDATE agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ),
      updateAgentHeartbeat: this.db.prepare<[string]>(
        'UPDATE agents SET last_heartbeat = CURRENT_TIMESTAMP, status = \'online\', updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ),

      // Discussions
      listDiscussions: this.db.prepare<[string, string, number, number]>(
        'SELECT * FROM discussions WHERE (? = \'all\' OR status = ?) ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      ),
      countDiscussions: this.db.prepare<[string, string]>(
        'SELECT COUNT(*) as count FROM discussions WHERE (? = \'all\' OR status = ?)',
      ),
      getDiscussion: this.db.prepare<[string]>('SELECT * FROM discussions WHERE id = ?'),
      insertDiscussion: this.db.prepare<[string, string, string | null, string]>(
        'INSERT INTO discussions (id, title, topic, created_by) VALUES (?, ?, ?, ?)',
      ),
      updateDiscussionStatus: this.db.prepare<[string, string, string]>(
        'UPDATE discussions SET status = ?, updated_at = CURRENT_TIMESTAMP, closed_at = CASE WHEN ? = \'closed\' THEN CURRENT_TIMESTAMP ELSE closed_at END WHERE id = ?',
      ),
      deleteDiscussion: this.db.prepare<[string]>('DELETE FROM discussions WHERE id = ?'),

      // Messages
      getMessages: this.db.prepare<[string, number]>(
        'SELECT * FROM messages WHERE discussion_id = ? ORDER BY created_at ASC LIMIT ?',
      ),
      getMessagesBefore: this.db.prepare<[string, string, number]>(
        'SELECT * FROM messages WHERE discussion_id = ? AND created_at < (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at DESC LIMIT ?',
      ),
      insertMessage: this.db.prepare<[string, string, string, string, string, string | null, string | null]>(
        'INSERT INTO messages (id, discussion_id, sender, content, type, parent_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),

      // Tasks
      listTasks: this.db.prepare<[]>('SELECT * FROM tasks ORDER BY created_at DESC'),
      listTasksByStatus: this.db.prepare<[string]>(
        'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC',
      ),
      listTasksByAssignee: this.db.prepare<[string]>(
        'SELECT * FROM tasks WHERE assignee = ? ORDER BY created_at DESC',
      ),
      listTasksByStatusAndAssignee: this.db.prepare<[string, string]>(
        'SELECT * FROM tasks WHERE status = ? AND assignee = ? ORDER BY created_at DESC',
      ),
      listTasksByDiscussion: this.db.prepare<[string]>(
        'SELECT * FROM tasks WHERE discussion_id = ? ORDER BY created_at DESC',
      ),
      getTask: this.db.prepare<[string]>('SELECT * FROM tasks WHERE id = ?'),
      getRunningTaskForAgent: this.db.prepare<[string]>(
        'SELECT * FROM tasks WHERE assignee = ? AND status IN (\'running\', \'approved\') ORDER BY created_at DESC LIMIT 1',
      ),
      insertTask: this.db.prepare<[string, string | null, string, string | null, string, string, number, string, string]>(
        'INSERT INTO tasks (id, discussion_id, title, description, assignee, type, priority, dependencies, risk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      updateTaskRisk: this.db.prepare<[string, string]>(
        'UPDATE tasks SET risk = ? WHERE id = ?',
      ),
      updateTaskDependencies: this.db.prepare<[string, string]>(
        'UPDATE tasks SET dependencies = ? WHERE id = ?',
      ),
      listTasksByDiscussionAndStatus: this.db.prepare<[string, string]>(
        'SELECT * FROM tasks WHERE discussion_id = ? AND status = ? ORDER BY created_at DESC',
      ),
      updateTaskStatus: this.db.prepare<[string, string]>(
        'UPDATE tasks SET status = ? WHERE id = ?',
      ),
      approveTask: this.db.prepare<[string, string]>(
        'UPDATE tasks SET status = \'approved\', approved_by = ? WHERE id = ?',
      ),
      cancelTask: this.db.prepare<[string]>(
        'UPDATE tasks SET status = \'cancelled\' WHERE id = ?',
      ),
      startTask: this.db.prepare<[string]>(
        'UPDATE tasks SET status = \'running\', started_at = CURRENT_TIMESTAMP WHERE id = ?',
      ),
      updateTaskProgress: this.db.prepare<[number, string]>(
        'UPDATE tasks SET progress = ? WHERE id = ?',
      ),
      completeTask: this.db.prepare<[string, string]>(
        'UPDATE tasks SET status = \'done\', progress = 100, result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
      ),
      failTask: this.db.prepare<[string, string]>(
        'UPDATE tasks SET status = \'failed\', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
      ),
      reassignTask: this.db.prepare<[string, string]>(
        'UPDATE tasks SET assignee = ?, status = \'approved\', started_at = NULL WHERE id = ?',
      ),

      // Task logs
      getTaskLogs: this.db.prepare<[string]>(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC',
      ),
      insertTaskLog: this.db.prepare<[string, string, string]>(
        'INSERT INTO task_logs (task_id, level, message) VALUES (?, ?, ?)',
      ),

      // Audit
      insertAudit: this.db.prepare<[string, string, string, string | null, string | null]>(
        'INSERT INTO audit_log (actor, action, resource, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      ),
    };
  }

  // ---------- Agents ----------

  getAllAgents(): Agent[] {
    const rows = this.stmts.getAllAgents.all() as AgentRow[];
    return rows.map((r) => {
      const agent = toAgent(r);
      const taskRow = this.stmts.getRunningTaskForAgent.get(agent.id) as TaskRow | undefined;
      if (taskRow) {
        agent.currentTask = { id: taskRow.id, title: taskRow.title };
      }
      return agent;
    });
  }

  getAgent(id: string): Agent | null {
    const row = this.stmts.getAgent.get(id) as AgentRow | undefined;
    if (!row) return null;
    const agent = toAgent(row);
    const taskRow = this.stmts.getRunningTaskForAgent.get(agent.id) as TaskRow | undefined;
    if (taskRow) {
      agent.currentTask = { id: taskRow.id, title: taskRow.title };
    }
    return agent;
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    this.stmts.updateAgentStatus.run(status, id);
  }

  updateAgentHeartbeat(id: string): void {
    this.stmts.updateAgentHeartbeat.run(id);
  }

  // ---------- Discussions ----------

  listDiscussions(status?: string, limit = 20, offset = 0): { discussions: Discussion[]; total: number } {
    const filterVal = status ?? 'all';
    const rows = this.stmts.listDiscussions.all(filterVal, filterVal, limit, offset) as DiscussionRow[];
    const countRow = this.stmts.countDiscussions.get(filterVal, filterVal) as { count: number };
    return {
      discussions: rows.map(toDiscussion),
      total: countRow.count,
    };
  }

  getDiscussion(id: string): Discussion | null {
    const row = this.stmts.getDiscussion.get(id) as DiscussionRow | undefined;
    return row ? toDiscussion(row) : null;
  }

  insertDiscussion(id: string, title: string, topic: string | null, createdBy: string): Discussion {
    this.stmts.insertDiscussion.run(id, title, topic, createdBy);
    return this.getDiscussion(id)!;
  }

  updateDiscussionStatus(id: string, status: DiscussionStatus): void {
    this.stmts.updateDiscussionStatus.run(status, status, id);
  }

  deleteDiscussion(id: string): void {
    this.stmts.deleteDiscussion.run(id);
  }

  // ---------- Messages ----------

  getMessages(discussionId: string, limit = 50): Message[] {
    const rows = this.stmts.getMessages.all(discussionId, limit) as MessageRow[];
    return rows.map(toMessage);
  }

  getMessagesBefore(discussionId: string, beforeId: string, limit = 50): Message[] {
    const rows = this.stmts.getMessagesBefore.all(discussionId, beforeId, limit) as MessageRow[];
    return rows.map(toMessage).reverse();
  }

  insertMessage(
    id: string,
    discussionId: string,
    sender: Sender,
    content: string,
    type: MessageType = 'message',
    parentId: string | null = null,
    metadata: Record<string, unknown> | null = null,
  ): Message {
    this.stmts.insertMessage.run(
      id, discussionId, sender, content, type, parentId,
      metadata ? JSON.stringify(metadata) : null,
    );
    // Update discussion timestamp
    this.db.prepare('UPDATE discussions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(discussionId);
    return {
      id, discussionId, sender, content, type, parentId, metadata,
      createdAt: new Date().toISOString(),
    };
  }

  // ---------- Tasks ----------

  listTasks(filters?: { status?: string; assignee?: string }): Task[] {
    let rows: TaskRow[];
    if (filters?.status && filters?.assignee) {
      rows = this.stmts.listTasksByStatusAndAssignee.all(filters.status, filters.assignee) as TaskRow[];
    } else if (filters?.status) {
      rows = this.stmts.listTasksByStatus.all(filters.status) as TaskRow[];
    } else if (filters?.assignee) {
      rows = this.stmts.listTasksByAssignee.all(filters.assignee) as TaskRow[];
    } else {
      rows = this.stmts.listTasks.all() as TaskRow[];
    }
    return rows.map(toTask);
  }

  listTasksByDiscussion(discussionId: string): Task[] {
    const rows = this.stmts.listTasksByDiscussion.all(discussionId) as TaskRow[];
    return rows.map(toTask);
  }

  getTask(id: string): Task | null {
    const row = this.stmts.getTask.get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  insertTask(
    id: string,
    discussionId: string | null,
    title: string,
    description: string | null,
    assignee: AgentId,
    type: TaskType = 'simple',
    priority = 0,
    dependencies: string[] = [],
    risk: TaskRiskLevel = 'medium',
  ): Task {
    this.stmts.insertTask.run(id, discussionId, title, description, assignee, type, priority, JSON.stringify(dependencies), risk);
    return this.getTask(id)!;
  }

  updateTaskRisk(id: string, risk: TaskRiskLevel): void {
    this.stmts.updateTaskRisk.run(risk, id);
  }

  updateTaskDependencies(id: string, dependencies: string[]): void {
    this.stmts.updateTaskDependencies.run(JSON.stringify(dependencies), id);
  }

  listTasksByDiscussionAndStatus(discussionId: string, status: string): Task[] {
    const rows = this.stmts.listTasksByDiscussionAndStatus.all(discussionId, status) as TaskRow[];
    return rows.map(toTask);
  }

  updateTaskStatus(status: TaskStatus, id: string): void {
    this.stmts.updateTaskStatus.run(status, id);
  }

  approveTask(id: string, approvedBy: string): void {
    this.stmts.approveTask.run(approvedBy, id);
  }

  cancelTask(id: string): void {
    this.stmts.cancelTask.run(id);
  }

  startTask(id: string): void {
    this.stmts.startTask.run(id);
  }

  updateTaskProgress(id: string, progress: number): void {
    this.stmts.updateTaskProgress.run(progress, id);
  }

  completeTask(id: string, result: Record<string, unknown>): void {
    this.stmts.completeTask.run(JSON.stringify(result), id);
  }

  failTask(id: string, error: string): void {
    this.stmts.failTask.run(error, id);
  }

  reassignTask(id: string, newAssignee: string): void {
    this.stmts.reassignTask.run(newAssignee, id);
  }

  // ---------- Task logs ----------

  getTaskLogs(taskId: string): TaskLog[] {
    const rows = this.stmts.getTaskLogs.all(taskId) as TaskLogRow[];
    return rows.map(toTaskLog);
  }

  insertTaskLog(taskId: string, level: LogLevel, message: string): void {
    this.stmts.insertTaskLog.run(taskId, level, message);
  }

  // ---------- Audit ----------

  audit(actor: string, action: string, resource: string, resourceId?: string, details?: Record<string, unknown>): void {
    this.stmts.insertAudit.run(
      actor, action, resource,
      resourceId ?? null,
      details ? JSON.stringify(details) : null,
    );
  }
}
