/**
 * ShareSync — no-copy sync for shared network drives.
 *
 * When WATER/STEAM mount ASUS's D:\AI as a network share (SMB/UNC),
 * there's no need to copy files — just rewrite the hub path to the
 * local mount/UNC path. All three PCs then read/write the same location.
 *
 * Hub sends workDir like:  D:\AI\projects\foo  or  /mnt/d/AI/projects/foo
 * WATER sees it as:        \\192.168.50.1\AI\projects\foo
 * STEAM sees it as:        \\100.74.16.2\AI\projects\foo  (Tailscale)
 *
 * Config:
 *   FLEET_SYNC_MODE=share
 *   FLEET_REMOTE_SHARE=\\192.168.50.1\AI      (UNC to ASUS share)
 *   FLEET_HUB_PATH_PREFIX=/mnt/d/AI/          (what the server sends — strip this prefix)
 *   FLEET_IS_HUB=false
 */

import * as path from 'node:path';
import type { FileSync } from './sync.js';

export interface ShareSyncConfig {
  /** Local path prefix from hub (e.g. /mnt/d/AI/ or D:\AI\) */
  hubPathPrefix: string;
  /** UNC path or mount path to the hub's AI folder on this machine (e.g. \\192.168.50.1\AI) */
  remoteShare: string;
  /** Whether this node is the hub (if so, no rewriting needed) */
  isHub: boolean;
}

export class ShareSync implements Pick<FileSync, 'pullFromHub' | 'pushToHub'> {
  constructor(private config: ShareSyncConfig) {}

  /**
   * Rewrites a hub path to the local share path.
   * /mnt/d/AI/projects/foo  →  \\192.168.50.1\AI\projects\foo
   */
  private rewritePath(hubPath: string): string {
    if (this.config.isHub) return hubPath;

    let relative = hubPath;

    // Normalize separators for comparison
    const normalizedPrefix = this.config.hubPathPrefix.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedPath = hubPath.replace(/\\/g, '/');

    if (normalizedPath.startsWith(normalizedPrefix)) {
      relative = normalizedPath.slice(normalizedPrefix.length).replace(/^\//, '');
    } else {
      // Try stripping Windows-style prefix like D:\AI\
      const winPrefix = normalizedPrefix.replace(/^\/mnt\/d\//, 'D:/').replace(/\//g, '\\');
      const winPath = hubPath.replace(/\//g, '\\');
      if (winPath.toLowerCase().startsWith(winPrefix.toLowerCase())) {
        relative = winPath.slice(winPrefix.length).replace(/^\\/, '');
      }
    }

    // On Windows, join with backslash; on Linux (mounted share), use forward slash
    const sep = process.platform === 'win32' ? '\\' : '/';
    const share = this.config.remoteShare.replace(/[/\\]$/, '');
    const result = relative
      ? `${share}${sep}${relative.replace(/[/\\]/g, sep)}`
      : share;

    return result;
  }

  async pullFromHub(_taskId: string, workDir: string): Promise<string> {
    // No copying — just rewrite the path to the shared location
    const localPath = this.rewritePath(workDir);
    console.log(`[share-sync] Rewriting workDir: ${workDir} → ${localPath}`);
    return localPath;
  }

  async pushToHub(_taskId: string, _localDir: string, _workDir: string): Promise<string[]> {
    // No push needed — writes went directly to the shared drive
    console.log(`[share-sync] Push skipped — writing directly to shared drive`);
    return [];
  }
}
