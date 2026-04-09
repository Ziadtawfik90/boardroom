import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { config } from '../config.js';

export type WorkspaceType = 'code' | 'docs';

export interface WorkspaceInfo {
  path: string;
  type: WorkspaceType;
  discussionId: string;
}

export interface WorkspaceStatus {
  files: Array<{ name: string; size: string }>;
  recentCommits: string[];
  diffStat: string;
  summary: string;
}

const workspaces = new Map<string, WorkspaceInfo>();

function getBasePath(): string {
  return config.workspacePath ?? '/tmp/boardroom-workspaces';
}

/** Detect workspace type from discussion topic/tasks */
export function detectWorkspaceType(topic: string): WorkspaceType {
  const codeKeywords = /\b(build|code|create|scaffold|implement|deploy|frontend|backend|api|app|website|component|function|class|module|npm|git|docker)\b/i;
  return codeKeywords.test(topic) ? 'code' : 'docs';
}

export class WorkspaceManager {
  /** Create a workspace for a discussion, optionally at a user-chosen path */
  create(discussionId: string, type: WorkspaceType, userPath?: string): WorkspaceInfo {
    const existing = workspaces.get(discussionId);
    if (existing) return existing;

    let wsPath: string;
    if (userPath) {
      // User-chosen path: absolute paths used directly, relative names go under basePath
      wsPath = userPath.startsWith('/') ? userPath : join(getBasePath(), userPath);
    } else {
      wsPath = join(getBasePath(), discussionId);
    }

    mkdirSync(wsPath, { recursive: true });

    // Skip git init if the directory already has a .git folder
    const alreadyGit = existsSync(join(wsPath, '.git'));

    if (type === 'code' && !alreadyGit) {
      try {
        execSync('git init && git commit --allow-empty -m "Workspace initialized"', {
          cwd: wsPath,
          stdio: 'pipe',
          env: { ...process.env, GIT_AUTHOR_NAME: 'Boardroom', GIT_AUTHOR_EMAIL: 'boardroom@local', GIT_COMMITTER_NAME: 'Boardroom', GIT_COMMITTER_EMAIL: 'boardroom@local' },
        });
        console.log(`[workspace] Created code workspace: ${wsPath}`);
      } catch (err) {
        console.error('[workspace] Failed to init git:', (err as Error).message);
      }
    } else if (alreadyGit) {
      console.log(`[workspace] Using existing git repo: ${wsPath}`);
    } else {
      console.log(`[workspace] Created docs workspace: ${wsPath}`);
    }

    const info: WorkspaceInfo = { path: wsPath, type, discussionId };
    workspaces.set(discussionId, info);
    return info;
  }

  /** Get workspace for a discussion */
  get(discussionId: string): WorkspaceInfo | null {
    return workspaces.get(discussionId) ?? null;
  }

  /** Get or create workspace, with optional user-chosen path */
  getOrCreate(discussionId: string, topic: string, userPath?: string): WorkspaceInfo {
    const existing = workspaces.get(discussionId);
    if (existing) return existing;
    return this.create(discussionId, detectWorkspaceType(topic), userPath);
  }

  /** Get workspace status for inclusion in prompts */
  getStatus(discussionId: string): WorkspaceStatus | null {
    const ws = workspaces.get(discussionId);
    if (!ws || !existsSync(ws.path)) return null;

    const files: Array<{ name: string; size: string }> = [];
    try {
      const entries = this.listFilesRecursive(ws.path, ws.path);
      for (const entry of entries.slice(0, 30)) { // cap at 30 files
        files.push(entry);
      }
    } catch {}

    let recentCommits: string[] = [];
    let diffStat = '';

    if (ws.type === 'code') {
      try {
        const log = execSync('git log --oneline -10 2>/dev/null', { cwd: ws.path, stdio: 'pipe' }).toString().trim();
        recentCommits = log.split('\n').filter(Boolean);
      } catch {}

      try {
        diffStat = execSync('git diff --stat HEAD~3 2>/dev/null || echo ""', { cwd: ws.path, stdio: 'pipe' }).toString().trim();
      } catch {}
    }

    // Build human-readable summary
    const lines: string[] = [];
    if (files.length > 0) {
      lines.push(`Files (${files.length}):`);
      for (const f of files) {
        lines.push(`  ${f.name} (${f.size})`);
      }
    } else {
      lines.push('Workspace is empty — no files yet.');
    }

    if (recentCommits.length > 0) {
      lines.push('');
      lines.push('Recent commits:');
      for (const c of recentCommits) {
        lines.push(`  ${c}`);
      }
    }

    if (diffStat) {
      lines.push('');
      lines.push('Changes since last round:');
      lines.push(`  ${diffStat}`);
    }

    return {
      files,
      recentCommits,
      diffStat,
      summary: lines.join('\n'),
    };
  }

  /** Auto-commit changes in a code workspace */
  commitChanges(discussionId: string, agentName: string, message: string): boolean {
    const ws = workspaces.get(discussionId);
    if (!ws || ws.type !== 'code') return false;

    try {
      execSync(`git add -A && git diff --cached --quiet || git commit -m "[${agentName}] ${message}"`, {
        cwd: ws.path,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: agentName,
          GIT_AUTHOR_EMAIL: `${agentName.toLowerCase()}@boardroom.local`,
          GIT_COMMITTER_NAME: agentName,
          GIT_COMMITTER_EMAIL: `${agentName.toLowerCase()}@boardroom.local`,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** List files recursively, excluding .git */
  private listFilesRecursive(dir: string, base: string): Array<{ name: string; size: string }> {
    const results: Array<{ name: string; size: string }> = [];

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry === '.git' || entry === 'node_modules') continue;
        const fullPath = join(dir, entry);
        const relativePath = fullPath.replace(base + '/', '');
        const stat = statSync(fullPath);

        if (stat.isFile()) {
          const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
          results.push({ name: relativePath, size });
        } else if (stat.isDirectory()) {
          results.push(...this.listFilesRecursive(fullPath, base));
        }
      }
    } catch {}

    return results;
  }

  /** Destroy workspace */
  destroy(discussionId: string): void {
    const ws = workspaces.get(discussionId);
    if (ws) {
      workspaces.delete(discussionId);
      console.log(`[workspace] Destroyed workspace: ${ws.path}`);
    }
  }
}
