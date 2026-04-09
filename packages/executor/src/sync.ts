/**
 * FileSync — rsync-based file synchronization between hub (ASUS) and workers.
 *
 * Adapted from fleet-command/daemon/src/sync.ts
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { NatsConnection } from 'nats';
import type { NodeId, FleetSyncStart, FleetSyncComplete } from '@boardroom/shared';
import { FLEET_SUBJECTS } from '@boardroom/shared';

export interface SyncConfig {
  syncRoot: string;
  hubSsh: string;
  hubPathPrefix: string;
  isHub: boolean;
  retries: number;
  timeoutSec: number;
  extraFlags: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FileSync {
  constructor(
    private config: SyncConfig,
    private nc: NatsConnection | null,
    private nodeId: NodeId,
  ) {
    if (!config.isHub) {
      fs.mkdirSync(config.syncRoot, { recursive: true });
      console.log(`[sync] Sync root: ${config.syncRoot}`);
      console.log(`[sync] Hub SSH: ${config.hubSsh}`);
    }
  }

  resolveLocalDir(workDir: string): string {
    let relative = workDir;
    if (relative.startsWith(this.config.hubPathPrefix)) {
      relative = relative.slice(this.config.hubPathPrefix.length);
    }
    relative = relative.replace(/\/+$/, '');
    const slug = relative.replace(/\//g, '--');
    return path.join(this.config.syncRoot, slug);
  }

  async pullFromHub(taskId: string, workDir: string): Promise<string> {
    if (this.config.isHub) return workDir;

    const localDir = this.resolveLocalDir(workDir);
    fs.mkdirSync(localDir, { recursive: true });

    this.publishSyncStart(taskId, 'pull', workDir, localDir);
    const startTime = Date.now();

    const flags = [
      '-az',
      '--partial',
      `--timeout=${this.config.timeoutSec}`,
      '--delete',
      `-e "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no"`,
      ...this.config.extraFlags,
    ].join(' ');

    const cmd = `rsync ${flags} ${this.config.hubSsh}:${workDir}/ ${localDir}/`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        execSync(cmd, { encoding: 'utf-8', timeout: this.config.timeoutSec * 2 * 1000 });
        const durationMs = Date.now() - startTime;
        this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs);
        console.log(`[sync] Pull complete: ${workDir} → ${localDir} (${durationMs}ms)`);
        return localDir;
      } catch (err) {
        lastError = err as Error;
        console.warn(`[sync] Pull attempt ${attempt}/${this.config.retries} failed: ${(err as Error).message}`);
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

  async pushToHub(taskId: string, localDir: string, workDir: string): Promise<string[]> {
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
      `-e "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no"`,
      ...this.config.extraFlags,
    ].join(' ');

    const cmd = `rsync ${flags} ${localDir}/ ${this.config.hubSsh}:${workDir}/`;

    let lastError: Error | null = null;
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
      } catch (err) {
        lastError = err as Error;
        console.warn(`[sync] Push attempt ${attempt}/${this.config.retries} failed: ${(err as Error).message}`);
        if (attempt < this.config.retries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await sleep(backoff);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.publishSyncComplete(taskId, 'push', 0, 0, durationMs, 'sync_push_failed');
    console.error(`[sync] Push failed after ${this.config.retries} attempts`);
    return [];
  }

  private parseItemizeChanges(output: string): string[] {
    return output
      .split('\n')
      .filter((line) => line.length > 12 && !line.startsWith('cd'))
      .map((line) => line.slice(12).trim())
      .filter((p) => p.length > 0);
  }

  private detectLocalChanges(workDir: string): string[] {
    try {
      const output = execSync('git diff --name-only HEAD', {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  private publishSyncStart(taskId: string, direction: 'pull' | 'push', hubDir: string, localDir: string): void {
    if (!this.nc) return;
    const msg: FleetSyncStart = {
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

  private publishSyncComplete(
    taskId: string,
    direction: 'pull' | 'push',
    filesTransferred: number,
    bytesTransferred: number,
    durationMs: number,
    error?: string,
  ): void {
    if (!this.nc) return;
    const msg: FleetSyncComplete = {
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
