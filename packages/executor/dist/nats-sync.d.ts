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
import type { NatsConnection } from 'nats';
import type { NodeId } from '@boardroom/shared';
export interface NatsSyncConfig {
    syncRoot: string;
    hubPathPrefix: string;
    isHub: boolean;
    timeoutSec: number;
    bucketName: string;
}
export declare class NatsSync {
    private nc;
    private config;
    private nodeId;
    private js;
    private objStore;
    constructor(nc: NatsConnection, config: NatsSyncConfig, nodeId: NodeId);
    init(): Promise<void>;
    resolveLocalDir(workDir: string): string;
    /** Key used in object store for a workspace */
    private objectKey;
    pullFromHub(taskId: string, workDir: string): Promise<string>;
    pushToHub(taskId: string, localDir: string, workDir: string): Promise<string[]>;
    private detectLocalChanges;
    private publishSyncStart;
    private publishSyncComplete;
}
//# sourceMappingURL=nats-sync.d.ts.map