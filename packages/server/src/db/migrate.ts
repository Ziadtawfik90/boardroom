import Database from 'better-sqlite3';

const SCHEMA = `
-- Agents table (seed data, updated by heartbeat)
CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    host        TEXT NOT NULL,
    ssh_alias   TEXT,
    status      TEXT DEFAULT 'offline',
    capabilities TEXT NOT NULL,
    last_heartbeat DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discussions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    topic       TEXT,
    status      TEXT DEFAULT 'active',
    created_by  TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at   DATETIME
);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    discussion_id   TEXT NOT NULL REFERENCES discussions(id),
    sender          TEXT NOT NULL,
    content         TEXT NOT NULL,
    type            TEXT DEFAULT 'message',
    parent_id       TEXT REFERENCES messages(id),
    metadata        TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_discussion ON messages(discussion_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);

CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    discussion_id   TEXT REFERENCES discussions(id),
    title           TEXT NOT NULL,
    description     TEXT,
    assignee        TEXT NOT NULL REFERENCES agents(id),
    status          TEXT DEFAULT 'pending',
    type            TEXT DEFAULT 'simple',
    priority        INTEGER DEFAULT 0,
    dependencies    TEXT,
    result          TEXT,
    error           TEXT,
    progress        INTEGER DEFAULT 0,
    approved_by     TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME,
    completed_at    DATETIME
);

CREATE INDEX IF NOT EXISTS idx_tasks_discussion ON tasks(discussion_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    level       TEXT DEFAULT 'info',
    message     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    resource    TEXT NOT NULL,
    resource_id TEXT,
    details     TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

export function migrate(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  // Additive migrations (idempotent)
  try { db.exec('ALTER TABLE tasks ADD COLUMN risk TEXT DEFAULT \'medium\''); } catch { /* column exists */ }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS committees (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        charter     TEXT NOT NULL,
        members     TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch { /* table exists */ }

  seed(db);
}

function seed(db: Database.Database): void {
  const upsert = db.prepare(`
    INSERT INTO agents (id, name, role, host, ssh_alias, status, capabilities)
    VALUES (?, ?, ?, ?, ?, 'offline', ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      host = excluded.host,
      ssh_alias = excluded.ssh_alias,
      capabilities = excluded.capabilities
  `);

  const agents = [
    {
      id: 'asus',
      name: 'ASUS',
      role: 'The Builder',
      host: 'localhost',
      sshAlias: null,
      capabilities: ['code', 'git', 'github', 'deploy'],
    },
    {
      id: 'water',
      name: 'WATER',
      role: 'The Heavy Lifter',
      host: '192.168.50.2',
      sshAlias: 'pc2',
      capabilities: ['code', 'git', 'ml', 'compute'],
    },
    {
      id: 'steam',
      name: 'STEAM',
      role: 'The Operator',
      host: '100.122.142.104',
      sshAlias: 'pc3',
      capabilities: ['code', 'git', 'test', 'batch', 'deploy'],
    },
    {
      id: 'oracle',
      name: 'ORACLE',
      role: "Devil's Advocate",
      host: 'openrouter',
      sshAlias: null,
      capabilities: ['analysis', 'risk-assessment', 'critique'],
    },
    {
      id: 'sage',
      name: 'SAGE',
      role: 'Research Analyst',
      host: 'openrouter',
      sshAlias: null,
      capabilities: ['research', 'data', 'fact-check'],
    },
  ];

  const tx = db.transaction(() => {
    for (const agent of agents) {
      upsert.run(
        agent.id,
        agent.name,
        agent.role,
        agent.host,
        agent.sshAlias,
        JSON.stringify(agent.capabilities),
      );
    }
  });

  tx();
}
