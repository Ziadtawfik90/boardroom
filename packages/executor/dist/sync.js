/**
 * FileSync — rsync-based file synchronization between hub (ASUS) and workers.
 *
 * Adapted from fleet-command/daemon/src/sync.ts
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FLEET_SUBJECTS } from '@boardroom/shared';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class FileSync {
    config;
    nc;
    nodeId;
    constructor(config, nc, nodeId) {
        this.config = config;
        this.nc = nc;
        this.nodeId = nodeId;
        if (!config.isHub) {
            fs.mkdirSync(config.syncRoot, { recursive: true });
            console.log(`[sync] Sync root: ${config.syncRoot}`);
            console.log(`[sync] Hub SSH: ${config.hubSsh}`);
        }
    }
    resolveLocalDir(workDir) {
        let relative = workDir;
        if (relative.startsWith(this.config.hubPathPrefix)) {
            relative = relative.slice(this.config.hubPathPrefix.length);
        }
        relative = relative.replace(/\/+$/, '');
        const slug = relative.replace(/\//g, '--');
        return path.join(this.config.syncRoot, slug);
    }
    async pullFromHub(taskId, workDir) {
        if (this.config.isHub)
            return workDir;
        const localDir = this.resolveLocalDir(workDir);
        fs.mkdirSync(localDir, { recursive: true });
        this.publishSyncStart(taskId, 'pull', workDir, localDir);
        const startTime = Date.now();
        const flags = [
            '-az',
            '--partial',
            `--timeout=${this.config.timeoutSec}`,
            '--delete',
            `-e "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"`,
            ...this.config.extraFlags,
        ].join(' ');
        const cmd = `rsync ${flags} ${this.config.hubSsh}:${workDir}/ ${localDir}/`;
        let lastError = null;
        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                execSync(cmd, { encoding: 'utf-8', timeout: this.config.timeoutSec * 2 * 1000 });
                const durationMs = Date.now() - startTime;
                this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs);
                console.log(`[sync] Pull complete: ${workDir} → ${localDir} (${durationMs}ms)`);
                return localDir;
            }
            catch (err) {
                lastError = err;
                console.warn(`[sync] Pull attempt ${attempt}/${this.config.retries} failed: ${err.message}`);
                if (attempt < this.config.retries) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    await sleep(backoff);
                }
            }
        }
        const durationMs = Date.now() - startTime;
        this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs, 'sync_pull_failed');
        throw new Error(`sync_pull_failed after ${this.config.retries} attempts: ${lastError?.message}`);
    }
    async pushToHub(taskId, localDir, workDir) {
        if (this.config.isHub) {
            return this.detectLocalChanges(workDir);
        }
        this.publishSyncStart(taskId, 'push', workDir, localDir);
        const startTime = Date.now();
        const flags = [
            '-az',
            '--partial',
            `--timeout=${this.config.timeoutSec}`,
            '--itemize-changes',
            `-e "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"`,
            ...this.config.extraFlags,
        ].join(' ');
        const cmd = `rsync ${flags} ${localDir}/ ${this.config.hubSsh}:${workDir}/`;
        let lastError = null;
        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                const output = execSync(cmd, {
                    encoding: 'utf-8',
                    timeout: this.config.timeoutSec * 2 * 1000,
                });
                const filesChanged = this.parseItemizeChanges(output);
                const durationMs = Date.now() - startTime;
                this.publishSyncComplete(taskId, 'push', filesChanged.length, 0, durationMs);
                console.log(`[sync] Push complete: ${localDir} → ${workDir} (${filesChanged.length} files, ${durationMs}ms)`);
                return filesChanged;
            }
            catch (err) {
                lastError = err;
                console.warn(`[sync] Push attempt ${attempt}/${this.config.retries} failed: ${err.message}`);
                if (attempt < this.config.retries) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    await sleep(backoff);
                }
            }
        }
        const durationMs = Date.now() - startTime;
        this.publishSyncComplete(taskId, 'push', 0, 0, durationMs, 'sync_push_failed');
        throw new Error(`sync_push_failed after ${this.config.retries} attempts: ${lastError?.message}`);
    }
    parseItemizeChanges(output) {
        return output
            .split('\n')
            .filter((line) => line.length > 12 && !line.startsWith('cd'))
            .map((line) => line.slice(12).trim())
            .filter((p) => p.length > 0);
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
//# sourceMappingURL=sync.js.map