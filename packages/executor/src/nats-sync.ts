/**
 * NatsSync — file synchronization via NATS Object Store (JetStream).
 *
 * Replaces rsync/SSH entirely. Uses JetStream Object Store to push/pull
 * workspace files between the hub (ASUS) and workers (WATER/STEAM).
 *
 * Flow:
 *   Hub publishes workspace as a tar archive to Object Store bucket
 *   Workers pull the archive and extract to local syncRoot
 *   After task, workers push changed files back to Object Store
 *   Hub pulls and extracts the results
 *
 * No SSH, no git, no rsync. Pure NATS.
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { NatsConnection, JetStreamClient, ObjectStore } from 'nats';
import type { NodeId, FleetSyncStart, FleetSyncComplete } from '@boardroom/shared';
import { FLEET_SUBJECTS } from '@boardroom/shared';

export interface NatsSyncConfig {
  syncRoot: string;
  hubPathPrefix: string;
  isHub: boolean;
  timeoutSec: number;
  bucketName: string;
}

export class NatsSync {
  private js: JetStreamClient;
  private objStore: ObjectStore | null = null;

  constructor(
    private nc: NatsConnection,
    private config: NatsSyncConfig,
    private nodeId: NodeId,
  ) {
    this.js = nc.jetstream();
    if (!config.isHub) {
      fs.mkdirSync(config.syncRoot, { recursive: true });
      console.log(`[nats-sync] Sync root: ${config.syncRoot}`);
    }
  }

  async init(): Promise<void> {
    try {
      this.objStore = await this.js.views.os(this.config.bucketName, {
        storage: 'file' as any,
      } as any);
      console.log(`[nats-sync] Object store "${this.config.bucketName}" ready`);
    } catch (err) {
      console.error(`[nats-sync] Failed to init object store: ${(err as Error).message}`);
    }
  }

  resolveLocalDir(workDir: string): string {
    let relative = workDir;
    if (relative.startsWith(this.config.hubPathPrefix)) {
      relative = relative.slice(this.config.hubPathPrefix.length);
    }
    relative = relative.replace(/\/+$/, '');
    const slug = relative.replace(/\//g, '--').replace(/\\/g, '--');
    return path.join(this.config.syncRoot, slug);
  }

  /** Key used in object store for a workspace */
  private objectKey(taskId: string, direction: 'workspace' | 'result'): string {
    return `sync/${taskId}/${direction}.tar.gz`;
  }

  async pullFromHub(taskId: string, workDir: string): Promise<string> {
    if (this.config.isHub) return workDir;
    if (!this.objStore) return workDir;

    const localDir = this.resolveLocalDir(workDir);
    fs.mkdirSync(localDir, { recursive: true });

    this.publishSyncStart(taskId, 'pull', workDir, localDir);
    const startTime = Date.now();

    try {
      const key = this.objectKey(taskId, 'workspace');
      const result = await this.objStore.get(key);

      if (!result) {
        // No workspace uploaded — work directly (hub may not have pushed)
        console.log(`[nats-sync] No workspace in object store for ${taskId}, using local dir`);
        const durationMs = Date.now() - startTime;
        this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs);
        return localDir;
      }

      // Read the data from the ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = result.data.getReader();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (value) chunks.push(value);
        done = d;
      }
      const archive = Buffer.concat(chunks);

      // Write archive to temp file and extract
      const archivePath = path.join(localDir, '.sync-pull.tar.gz');
      fs.writeFileSync(archivePath, archive);
      execSync(`tar xzf "${archivePath}" -C "${localDir}"`, {
        timeout: this.config.timeoutSec * 1000,
      });
      fs.unlinkSync(archivePath);

      const durationMs = Date.now() - startTime;
      this.publishSyncComplete(taskId, 'pull', 0, archive.length, durationMs);
      console.log(`[nats-sync] Pull complete: ${workDir} → ${localDir} (${archive.length} bytes, ${durationMs}ms)`);
      return localDir;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.publishSyncComplete(taskId, 'pull', 0, 0, durationMs, 'nats_pull_failed');
      throw new Error(`nats_pull_failed: ${(err as Error).message}`);
    }
  }

  async pushToHub(taskId: string, localDir: string, workDir: string): Promise<string[]> {
    if (this.config.isHub) {
      return this.detectLocalChanges(workDir);
    }
    if (!this.objStore) return [];

    this.publishSyncStart(taskId, 'push', workDir, localDir);
    const startTime = Date.now();

    try {
      // Detect changed files
      const filesChanged = this.detectLocalChanges(localDir);
      if (filesChanged.length === 0) {
        const durationMs = Date.now() - startTime;
        this.publishSyncComplete(taskId, 'push', 0, 0, durationMs);
        return [];
      }

      // Create tar archive of changed files
      const archivePath = path.join(localDir, '.sync-push.tar.gz');
      const fileList = filesChanged.join('\n');
      const fileListPath = path.join(localDir, '.sync-filelist');
      fs.writeFileSync(fileListPath, fileList);

      execSync(`tar czf "${archivePath}" -T "${fileListPath}"`, {
        cwd: localDir,
        timeout: this.config.timeoutSec * 1000,
      });
      fs.unlinkSync(fileListPath);

      // Upload to object store
      const archive = fs.readFileSync(archivePath);
      const key = this.objectKey(taskId, 'result');
      await this.objStore.put({ name: key }, new ReadableStream({
        start(controller) {
          controller.enqueue(archive);
          controller.close();
        },
      }));
      fs.unlinkSync(archivePath);

      const durationMs = Date.now() - startTime;
      this.publishSyncComplete(taskId, 'push', filesChanged.length, archive.length, durationMs);
      console.log(`[nats-sync] Push complete: ${filesChanged.length} files, ${archive.length} bytes (${durationMs}ms)`);
      return filesChanged;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.publishSyncComplete(taskId, 'push', 0, 0, durationMs, 'nats_push_failed');
      throw new Error(`nats_push_failed: ${(err as Error).message}`);
    }
  }

  private detectLocalChanges(workDir: string): string[] {
    try {
      const output = execSync('git diff --name-only HEAD 2>/dev/null || git status --porcelain 2>/dev/null', {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return output
        .split('\n')
        .map((l) => l.replace(/^.{3}/, '').trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  private publishSyncStart(taskId: string, direction: 'pull' | 'push', hubDir: string, localDir: string): void {
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
