/**
 * GitSync — git-based file synchronization between hub (ASUS) and workers.
 *
 * Replaces rsync/SSH sync. Each workspace is a git repo that all nodes
 * can clone/pull/push to via a shared remote (the hub repo on ASUS).
 *
 * Flow:
 *   pullFromHub:  git clone (first time) or git pull (subsequent)
 *   pushToHub:    git add + commit + push
 *
 * The remote URL uses the configured git remote (HTTPS, SSH, or local path).
 * When FLEET_SYNC_MODE=git (default), this class is used instead of FileSync.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FLEET_SUBJECTS } from '@boardroom/shared';
export class GitSync {
    config;
    nc;
    nodeId;
    constructor(config, nc, nodeId) {
        this.config = config;
        this.nc = nc;
        this.nodeId = nodeId;
        if (!config.isHub) {
            fs.mkdirSync(config.syncRoot, { recursive: true });
            console.log(`[git-sync] Sync root: ${config.syncRoot}`);
            console.log(`[git-sync] Remote base: ${config.remoteBase}`);
        }
    }
    /** Convert a hub workDir to a local directory path */
    resolveLocalDir(workDir) {
        let relative = workDir;
        if (relative.startsWith(this.config.hubPathPrefix)) {
            relative = relative.slice(this.config.hubPathPrefix.length);
        }
        relative = relative.replace(/\/+$/, '');
        const slug = relative.replace(/\//g, '--').replace(/\\/g, '--');
        return path.join(this.config.syncRoot, slug);
    }
    /** Derive the git remote URL for a workspace */
    remoteUrl(workDir) {
        // If remoteBase is a local path, use it directly
        if (this.config.remoteBase.startsWith('/') || this.config.remoteBase.match(/^[A-Z]:\\/)) {
            return workDir; // Direct path on hub — use as bare remote
        }
        // Otherwise construct URL from base
        let relative = workDir;
        if (relative.startsWith(this.config.hubPathPrefix)) {
            relative = relative.slice(this.config.hubPathPrefix.length);
        }
        return `${this.config.remoteBase}/${relative.replace(/\\/g, '/')}`;
    }
    execOpts(cwd) {
        return {
            cwd,
            encoding: 'utf-8',
            timeout: this.config.timeoutSec * 1000,
            stdio: ['pipe', 'pipe', 'pipe'],
        };
    }
    git(args, cwd) {
        return execSync(`git ${args}`, this.execOpts(cwd));
    }
    /** Pull workspace from hub. Returns the local working directory. */
    async pullFromHub(taskId, workDir) {
        if (this.config.isHub)
            return workDir;
        const localDir = this.resolveLocalDir(workDir);
        const remote = this.remoteUrl(workDir);
        this.publishSyncStart(taskId, 'pull', workDir, localDir);
        const startTime = Date.now();
        try {
            if (fs.existsSync(path.join(localDir, '.git'))) {
                // Existing clone — fetch and reset to match remote
                this.git(`fetch origin ${this.config.branch}`, localDir);
                this.git(`reset --hard origin/${this.config.branch}`, localDir);
                this.git('clean -fd', localDir);
                console.log(`[git-sync] Pull (fetch+reset): ${workDir} → ${localDir}`);
            }
            else {
                // Fresh clone
                fs.mkdirSync(localDir, { recursive: true });
                execSync(`git clone --branch ${this.config.branch} --single-branch "${remote}" "${localDir}"`, this.execOpts());
                console.log(`[git-sync] Pull (clone): ${workDir} → ${localDir}`);
            }
            const durationMs = Date.now() - startTime;
            this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs);
            return localDir;
        }
        catch (err) {
            const durationMs = Date.now() - startTime;
            this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs, 'git_pull_failed');
            throw new Error(`git_pull_failed: ${err.message}`);
        }
    }
    /** Push local changes back to hub. Returns list of changed files. */
    async pushToHub(taskId, localDir, workDir) {
        if (this.config.isHub) {
            return this.detectLocalChanges(workDir);
        }
        this.publishSyncStart(taskId, 'push', workDir, localDir);
        const startTime = Date.now();
        try {
            // Stage all changes
            this.git('add -A', localDir);
            // Check if there are changes to commit
            const status = this.git('status --porcelain', localDir).trim();
            if (!status) {
                const durationMs = Date.now() - startTime;
                this.publishSyncComplete(taskId, 'push', 0, 0, durationMs);
                console.log(`[git-sync] Push: no changes to push`);
                return [];
            }
            // Get list of changed files before committing
            const filesChanged = status
                .split('\n')
                .map((line) => line.slice(3).trim())
                .filter((f) => f.length > 0);
            // Commit
            this.git(`commit -m "task ${taskId}: ${filesChanged.length} file(s) changed by ${this.nodeId}"`, localDir);
            // Push
            this.git(`push origin ${this.config.branch}`, localDir);
            const durationMs = Date.now() - startTime;
            this.publishSyncComplete(taskId, 'push', filesChanged.length, 0, durationMs);
            console.log(`[git-sync] Push complete: ${filesChanged.length} files (${durationMs}ms)`);
            return filesChanged;
        }
        catch (err) {
            const durationMs = Date.now() - startTime;
            this.publishSyncComplete(taskId, 'push', 0, 0, durationMs, 'git_push_failed');
            throw new Error(`git_push_failed: ${err.message}`);
        }
    }
    detectLocalChanges(workDir) {
        try {
            const output = execSync('git diff --name-only HEAD', {
                cwd: workDir,
                encoding: 'utf-8',
                timeout: 5000,
            });
            return output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        }
        catch {
            return [];
        }
    }
    publishSyncStart(taskId, direction, hubDir, localDir) {
        if (!this.nc)
            return;
        const msg = {
            type: 'sync.start',
            taskId,
            nodeId: this.nodeId,
            direction,
            hubDir,
            localDir,
            timestamp: new Date().toISOString(),
        };
        this.nc.publish(FLEET_SUBJECTS.syncStart(this.nodeId), new TextEncoder().encode(JSON.stringify(msg)));
    }
    publishSyncComplete(taskId, direction, filesTransferred, bytesTransferred, durationMs, error) {
        if (!this.nc)
            return;
        const msg = {
            type: 'sync.complete',
            taskId,
            nodeId: this.nodeId,
            direction,
            filesTransferred,
            bytesTransferred,
            durationMs,
            error,
            timestamp: new Date().toISOString(),
        };
        this.nc.publish(FLEET_SUBJECTS.syncComplete(this.nodeId), new TextEncoder().encode(JSON.stringify(msg)));
    }
}
//# sourceMappingURL=git-sync.js.map