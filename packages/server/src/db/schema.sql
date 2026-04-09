-- Boardroom SQLite Schema

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

-- Discussions table
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

-- Messages table
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

-- Tasks table
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

-- Task logs table (execution output stream)
CREATE TABLE IF NOT EXISTS task_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    level       TEXT DEFAULT 'info',
    message     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, created_at);

-- Audit log
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
