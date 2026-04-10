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
import type { NatsConnection } from 'nats';
import type { NodeId } from '@boardroom/shared';
export interface GitSyncConfig {
    /** Local root for cloned workspaces */
    syncRoot: string;
    /** Git remote base URL (e.g. "https://github.com/user" or "/mnt/d/AI") */
    remoteBase: string;
    /** Hub path prefix to strip when deriving repo names */
    hubPathPrefix: string;
    /** If true, this node is the hub — work directly in workDir */
    isHub: boolean;
    /** Git timeout in seconds */
    timeoutSec: number;
    /** Default branch to sync */
    branch: string;
}
export declare class GitSync {
    private config;
    private nc;
    private nodeId;
    constructor(config: GitSyncConfig, nc: NatsConnection | null, nodeId: NodeId);
    /** Convert a hub workDir to a local directory path */
    resolveLocalDir(workDir: string): string;
    /** Derive the git remote URL for a workspace */
    private remoteUrl;
    private execOpts;
    private git;
    /** Pull workspace from hub. Returns the local working directory. */
    pullFromHub(taskId: string, workDir: string): Promise<string>;
    /** Push local changes back to hub. Returns list of changed files. */
    pushToHub(taskId: string, localDir: string, workDir: string): Promise<string[]>;
    private detectLocalChanges;
    private publishSyncStart;
    private publishSyncComplete;
}
//# sourceMappingURL=git-sync.d.ts.map