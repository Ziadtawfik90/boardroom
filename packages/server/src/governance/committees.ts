import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { AgentId } from '../../../shared/src/types.js';

export interface Committee {
  id: string;
  name: string;
  charter: string;
  members: AgentId[];
  createdAt: string;
}

interface CommitteeRow {
  id: string;
  name: string;
  charter: string;
  members: string; // JSON
  created_at: string;
}

function toCommittee(row: CommitteeRow): Committee {
  return {
    id: row.id,
    name: row.name,
    charter: row.charter,
    members: JSON.parse(row.members) as AgentId[],
    createdAt: row.created_at,
  };
}

export class CommitteeManager {
  private stmts: ReturnType<typeof this.prepareAll>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareAll();
  }

  private prepareAll() {
    return {
      list: this.db.prepare<[]>('SELECT * FROM committees ORDER BY created_at DESC'),
      get: this.db.prepare<[string]>('SELECT * FROM committees WHERE id = ?'),
      getByName: this.db.prepare<[string]>('SELECT * FROM committees WHERE name = ?'),
      insert: this.db.prepare<[string, string, string, string]>(
        'INSERT INTO committees (id, name, charter, members) VALUES (?, ?, ?, ?)',
      ),
      update: this.db.prepare<[string, string, string, string]>(
        'UPDATE committees SET name = ?, charter = ?, members = ? WHERE id = ?',
      ),
      delete: this.db.prepare<[string]>('DELETE FROM committees WHERE id = ?'),
    };
  }

  list(): Committee[] {
    const rows = this.stmts.list.all() as CommitteeRow[];
    return rows.map(toCommittee);
  }

  get(id: string): Committee | null {
    const row = this.stmts.get.get(id) as CommitteeRow | undefined;
    return row ? toCommittee(row) : null;
  }

  getByName(name: string): Committee | null {
    const row = this.stmts.getByName.get(name) as CommitteeRow | undefined;
    return row ? toCommittee(row) : null;
  }

  create(name: string, charter: string, members: AgentId[]): Committee {
    const id = uuidv4();
    this.stmts.insert.run(id, name, charter, JSON.stringify(members));
    return this.get(id)!;
  }

  update(id: string, name: string, charter: string, members: AgentId[]): Committee | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.stmts.update.run(name, charter, JSON.stringify(members), id);
    return this.get(id)!;
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.stmts.delete.run(id);
    return true;
  }

  /** Check if an agent is a member of a committee */
  isMember(committeeId: string, agentId: AgentId): boolean {
    const committee = this.get(committeeId);
    return committee ? committee.members.includes(agentId) : false;
  }
}
