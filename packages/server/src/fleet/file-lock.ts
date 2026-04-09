/**
 * Fleet File Lock Manager — prevents concurrent writes to the same file across agents.
 *
 * Adapted from fleet-command/dispatcher/src/file-lock.ts
 */

import type { NatsConnection } from 'nats';
import type {
  NodeId,
  FleetPreWriteManifest,
  FleetManifestApproval,
  FleetManifestVeto,
  FleetFileConflict,
} from '../../../shared/src/fleet-types.js';
import { FLEET_SUBJECTS } from '../../../shared/src/fleet-types.js';

interface FileLock {
  path: string;
  nodeId: NodeId;
  taskId: string;
  lockedAt: number;
}

export class FleetFileLockManager {
  private locks = new Map<string, FileLock>();

  constructor(private nc: NatsConnection) {}

  async start(): Promise<void> {
    // Listen for manifest requests from all nodes
    const manifestSub = this.nc.subscribe('fleet.manifest.pre.*');
    (async () => {
      for await (const msg of manifestSub) {
        try {
          const manifest = JSON.parse(new TextDecoder().decode(msg.data)) as FleetPreWriteManifest;
          this.handleManifest(manifest);
        } catch (err) {
          console.error('[file-lock] Failed to parse manifest:', err);
        }
      }
    })();

    // Listen for task results to release locks
    const resultSub = this.nc.subscribe('fleet.task.result.*');
    (async () => {
      for await (const msg of resultSub) {
        try {
          const result = JSON.parse(new TextDecoder().decode(msg.data));
          if (result.taskId) {
            this.releaseLocks(result.taskId);
          }
        } catch {
          // ignore
        }
      }
    })();

    console.log('[file-lock] Watching for pre-write manifests');
  }

  private handleManifest(manifest: FleetPreWriteManifest): void {
    const conflicts: FleetFileConflict[] = [];

    for (const path of manifest.willWrite) {
      const existing = this.locks.get(path);
      if (existing && existing.taskId !== manifest.taskId) {
        conflicts.push({
          path,
          heldBy: existing.nodeId,
          heldByTaskId: existing.taskId,
        });
      }
    }

    if (conflicts.length > 0) {
      const veto: FleetManifestVeto = {
        type: 'manifest.vetoed',
        taskId: manifest.taskId,
        nodeId: manifest.nodeId,
        conflicts,
        vetoedAt: new Date().toISOString(),
      };
      this.nc.publish(
        FLEET_SUBJECTS.manifestDecision(manifest.nodeId),
        new TextEncoder().encode(JSON.stringify(veto)),
      );
      console.log(`[file-lock] VETOED task ${manifest.taskId} — ${conflicts.length} conflict(s)`);
    } else {
      for (const path of manifest.willWrite) {
        this.locks.set(path, {
          path,
          nodeId: manifest.nodeId,
          taskId: manifest.taskId,
          lockedAt: Date.now(),
        });
      }

      const approval: FleetManifestApproval = {
        type: 'manifest.approved',
        taskId: manifest.taskId,
        nodeId: manifest.nodeId,
        approvedAt: new Date().toISOString(),
      };
      this.nc.publish(
        FLEET_SUBJECTS.manifestDecision(manifest.nodeId),
        new TextEncoder().encode(JSON.stringify(approval)),
      );
      console.log(`[file-lock] Approved task ${manifest.taskId} — locked ${manifest.willWrite.length} file(s)`);
    }
  }

  releaseLocks(taskId: string): void {
    let released = 0;
    for (const [path, lock] of this.locks) {
      if (lock.taskId === taskId) {
        this.locks.delete(path);
        released++;
      }
    }
    if (released > 0) {
      console.log(`[file-lock] Released ${released} lock(s) for task ${taskId}`);
    }
  }

  releaseNodeLocks(nodeId: NodeId): string[] {
    const released: string[] = [];
    for (const [, lock] of this.locks) {
      if (lock.nodeId === nodeId) {
        this.locks.delete(lock.path);
        released.push(lock.taskId);
      }
    }
    return [...new Set(released)];
  }

  getActiveLocks(): FileLock[] {
    return [...this.locks.values()];
  }
}
