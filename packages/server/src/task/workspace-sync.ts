import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

const TAR_EXCLUDES = [
  '--exclude=.git',
  '--exclude=node_modules',
  '--exclude=dist',
  '--exclude=.next',
  '--exclude=__pycache__',
  '--exclude=.venv',
  '--exclude=*.tar.gz',
].join(' ');

const REMOTE_TAR = 'C:\\Windows\\System32\\tar.exe';

/** Get the remote workspace path for a discussion on a Windows PC */
export function remoteWorkspacePath(discussionId: string): string {
  return `${config.remoteWorkspaceBase}\\${discussionId}`;
}

/** Push workspace files from asus to a remote PC via SCP */
export async function pushWorkspaceToRemote(
  sshAlias: string,
  workspacePath: string,
  discussionId: string,
): Promise<boolean> {
  const remotePath = remoteWorkspacePath(discussionId);
  const tarFile = `/tmp/ws-push-${discussionId}.tar.gz`;

  try {
    // Check if workspace has any files to push
    if (!existsSync(workspacePath)) {
      console.log(`[sync] No workspace at ${workspacePath}, skipping push`);
      return true;
    }

    const entries = readdirSync(workspacePath).filter(e => e !== '.git');
    if (entries.length === 0) {
      console.log(`[sync] Workspace empty, skipping push`);
      return true;
    }

    console.log(`[sync] Pushing workspace to ${sshAlias} (${entries.length} entries)`);

    // Step 1: tar the workspace on asus
    execSync(`tar czf ${tarFile} ${TAR_EXCLUDES} -C "${workspacePath}" .`, {
      stdio: 'pipe',
      timeout: 60_000,
    });

    // Step 2: create remote dir (idempotent)
    execSync(`ssh -o ConnectTimeout=10 ${sshAlias} "mkdir ${remotePath} 2>nul"`, {
      stdio: 'pipe',
      timeout: 15_000,
    }).toString(); // ignore "already exists" errors

    // Step 3: SCP tarball to remote
    execSync(`scp -o ConnectTimeout=10 "${tarFile}" ${sshAlias}:${remotePath.replace(/\\/g, '/')}/workspace.tar.gz`, {
      stdio: 'pipe',
      timeout: 120_000,
    });

    // Step 4: extract on remote and clean up
    execSync(
      `ssh -o ConnectTimeout=10 ${sshAlias} "cd /d ${remotePath} && ${REMOTE_TAR} -xzf workspace.tar.gz && del workspace.tar.gz"`,
      { stdio: 'pipe', timeout: 60_000 },
    );

    console.log(`[sync] Push complete → ${sshAlias}:${remotePath}`);
    return true;
  } catch (err) {
    console.error(`[sync] Push failed to ${sshAlias}:`, (err as Error).message?.substring(0, 200));
    return false;
  } finally {
    // Clean up local temp file
    try { if (existsSync(tarFile)) unlinkSync(tarFile); } catch {}
  }
}

/** Pull workspace files from a remote PC back to asus via SCP */
export async function pullWorkspaceFromRemote(
  sshAlias: string,
  discussionId: string,
  workspacePath: string,
): Promise<boolean> {
  const remotePath = remoteWorkspacePath(discussionId);
  const tarFile = `/tmp/ws-pull-${discussionId}.tar.gz`;

  try {
    console.log(`[sync] Pulling results from ${sshAlias}:${remotePath}`);

    // Step 1: tar on remote (exclude .git, node_modules, etc.)
    execSync(
      `ssh -o ConnectTimeout=10 ${sshAlias} "cd /d ${remotePath} && ${REMOTE_TAR} -czf result.tar.gz ${TAR_EXCLUDES} ."`,
      { stdio: 'pipe', timeout: 60_000 },
    );

    // Step 2: SCP tarball back to asus
    execSync(`scp -o ConnectTimeout=10 ${sshAlias}:${remotePath.replace(/\\/g, '/')}/result.tar.gz "${tarFile}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });

    // Step 3: extract over local workspace
    execSync(`tar xzf "${tarFile}" -C "${workspacePath}"`, {
      stdio: 'pipe',
      timeout: 60_000,
    });

    // Step 4: clean up remote tarball
    try {
      execSync(`ssh -o ConnectTimeout=10 ${sshAlias} "del ${remotePath}\\result.tar.gz"`, {
        stdio: 'pipe',
        timeout: 15_000,
      });
    } catch {} // non-critical

    console.log(`[sync] Pull complete ← ${sshAlias}:${remotePath}`);
    return true;
  } catch (err) {
    console.error(`[sync] Pull failed from ${sshAlias}:`, (err as Error).message?.substring(0, 200));
    return false;
  } finally {
    try { if (existsSync(tarFile)) unlinkSync(tarFile); } catch {}
  }
}
