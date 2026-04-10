/**
 * FileSync — rsync-based file synchronization between hub (ASUS) and workers.
 *
 * Adapted from fleet-command/daemon/src/sync.ts
 */
import type { NatsConnection } from 'nats';
import type { NodeId } from '@boardroom/shared';
export interface SyncConfig {
    syncRoot: string;
    hubSsh: string;
    hubPathPrefix: string;
    isHub: boolean;
    retries: number;
    timeoutSec: number;
    extraFlags: string[];
}
export declare class FileSync {
    private config;
    private nc;
    private nodeId;
    constructor(config: SyncConfig, nc: NatsConnection | null, nodeId: NodeId);
    resolveLocalDir(workDir: string): string;
    pullFromHub(taskId: string, workDir: string): Promise<string>;
    pushToHub(taskId: string, localDir: string, workDir: string): Promise<string[]>;
    private parseItemizeChanges;
    private detectLocalChanges;
    private publishSyncStart;
    private publishSyncComplete;
}
//# sourceMappingURL=sync.d.ts.map