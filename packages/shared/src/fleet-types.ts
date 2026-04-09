/**
 * Fleet Command Message Schemas — integrated from fleet-command repo.
 *
 * Defines NATS message formats for distributed task dispatch,
 * heartbeat monitoring, file locking, and sync.
 */

// ─── Node Identity ───────────────────────────────────────────

export type NodeId = 'asus' | 'water' | 'steam';

export type NodeState = 'alive' | 'suspect' | 'dead';

export type FleetTaskStatus =
  | 'queued'
  | 'dispatched'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'requeued';

// ─── 1. TaskDispatch ─────────────────────────────────────────
// Server → Daemon via NATS
// Subject: fleet.task.dispatch.{nodeId}

export interface FleetTaskDispatch {
  type: 'task.dispatch';
  taskId: string;
  nodeId: NodeId;
  prompt: string;
  workDir: string;
  files: string[];
  timeout: number;
  priority: number;
  metadata: Record<string, string>;
  dispatchedAt: string;
}

// ─── 2. TaskAccepted ─────────────────────────────────────────
// Daemon → Server via NATS
// Subject: fleet.task.accepted.{nodeId}

export interface FleetTaskAccepted {
  type: 'task.accepted';
  taskId: string;
  nodeId: NodeId;
  pid: number;
  acceptedAt: string;
}

// ─── 3. TaskOutput ───────────────────────────────────────────
// Daemon → Server (streamed)
// Subject: fleet.task.output.{nodeId}.{taskId}

export interface FleetTaskOutput {
  type: 'task.output';
  taskId: string;
  nodeId: NodeId;
  stream: 'stdout' | 'stderr';
  chunk: string; // base64-encoded
  seq: number;
  timestamp: string;
}

// ─── 4. TaskResult ───────────────────────────────────────────
// Daemon → Server via NATS
// Subject: fleet.task.result.{nodeId}

export interface FleetTaskResult {
  type: 'task.result';
  taskId: string;
  nodeId: NodeId;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number;
  filesChanged: string[];
  durationMs: number;
  error?: string;
  completedAt: string;
}

// ─── 5. Heartbeat ────────────────────────────────────────────
// Daemon → Server (periodic)
// Subject: fleet.heartbeat.{nodeId}

export interface FleetHeartbeat {
  type: 'heartbeat';
  nodeId: NodeId;
  state: NodeState;
  activeTasks: number;
  cpuPercent: number;
  memPercent: number;
  gpuPercent?: number;
  gpuMemPercent?: number;
  uptime: number;
  version: string;
  timestamp: string;
}

// ─── 6. PreWriteManifest ─────────────────────────────────────
// Daemon → Server (before starting work)
// Subject: fleet.manifest.pre.{nodeId}

export interface FleetPreWriteManifest {
  type: 'manifest.pre';
  taskId: string;
  nodeId: NodeId;
  willWrite: string[];
  willRead: string[];
  requestedAt: string;
}

// ─── 7. ManifestApproval / Veto ──────────────────────────────
// Server → Daemon
// Subject: fleet.manifest.decision.{nodeId}

export interface FleetManifestApproval {
  type: 'manifest.approved';
  taskId: string;
  nodeId: NodeId;
  approvedAt: string;
}

export interface FleetManifestVeto {
  type: 'manifest.vetoed';
  taskId: string;
  nodeId: NodeId;
  conflicts: FleetFileConflict[];
  vetoedAt: string;
}

export interface FleetFileConflict {
  path: string;
  heldBy: NodeId;
  heldByTaskId: string;
}

// ─── 8. NodeStateChange ──────────────────────────────────────
// Server → Dashboard
// Subject: fleet.node.state.{nodeId}

export interface FleetNodeStateChange {
  type: 'node.state';
  nodeId: NodeId;
  previous: NodeState;
  current: NodeState;
  reason: string;
  timestamp: string;
}

// ─── 9. TaskRequeue ──────────────────────────────────────────
// Server internal
// Subject: fleet.task.requeue

export interface FleetTaskRequeue {
  type: 'task.requeue';
  taskId: string;
  originalNode: NodeId;
  reason: string;
  requeuedAt: string;
}

// ─── 9b. TaskCancel ─────────────────────────────────────────
// Server → Daemon
// Subject: fleet.task.cancel.{nodeId}

export interface FleetTaskCancel {
  type: 'task.cancel';
  taskId: string;
  nodeId: NodeId;
  reason: string;
  cancelledAt: string;
}

// ─── 10. SyncStart ───────────────────────────────────────────
// Daemon → Server
// Subject: fleet.sync.start.{nodeId}

export interface FleetSyncStart {
  type: 'sync.start';
  taskId: string;
  nodeId: NodeId;
  direction: 'pull' | 'push';
  hubDir: string;
  localDir: string;
  timestamp: string;
}

// ─── 11. SyncComplete ────────────────────────────────────────
// Daemon → Server
// Subject: fleet.sync.complete.{nodeId}

export interface FleetSyncComplete {
  type: 'sync.complete';
  taskId: string;
  nodeId: NodeId;
  direction: 'pull' | 'push';
  filesTransferred: number;
  bytesTransferred: number;
  durationMs: number;
  error?: string;
  timestamp: string;
}

// ─── Union Type ──────────────────────────────────────────────

export type FleetMessage =
  | FleetTaskDispatch
  | FleetTaskAccepted
  | FleetTaskOutput
  | FleetTaskResult
  | FleetTaskCancel
  | FleetHeartbeat
  | FleetPreWriteManifest
  | FleetManifestApproval
  | FleetManifestVeto
  | FleetNodeStateChange
  | FleetTaskRequeue
  | FleetSyncStart
  | FleetSyncComplete;

// ─── NATS Subject Map ────────────────────────────────────────

export const FLEET_SUBJECTS = {
  taskDispatch: (nodeId: NodeId) => `fleet.task.dispatch.${nodeId}`,
  taskAccepted: (nodeId: NodeId) => `fleet.task.accepted.${nodeId}`,
  taskOutput: (nodeId: NodeId, taskId: string) => `fleet.task.output.${nodeId}.${taskId}`,
  taskResult: (nodeId: NodeId) => `fleet.task.result.${nodeId}`,
  heartbeat: (nodeId: NodeId) => `fleet.heartbeat.${nodeId}`,
  manifestPre: (nodeId: NodeId) => `fleet.manifest.pre.${nodeId}`,
  manifestDecision: (nodeId: NodeId) => `fleet.manifest.decision.${nodeId}`,
  nodeState: (nodeId: NodeId) => `fleet.node.state.${nodeId}`,
  taskCancel: (nodeId: NodeId) => `fleet.task.cancel.${nodeId}`,
  taskRequeue: 'fleet.task.requeue',
  syncStart: (nodeId: NodeId) => `fleet.sync.start.${nodeId}`,
  syncComplete: (nodeId: NodeId) => `fleet.sync.complete.${nodeId}`,
} as const;

// ─── Heartbeat Config ────────────────────────────────────────

export const FLEET_HEARTBEAT_INTERVAL_MS = 5_000;

export const FLEET_HEARTBEAT_THRESHOLDS: Record<NodeId, { suspectMs: number; deadMs: number }> = {
  asus: { suspectMs: 5_000, deadMs: 15_000 },
  water: { suspectMs: 5_000, deadMs: 15_000 },
  steam: { suspectMs: 30_000, deadMs: 90_000 }, // WiFi grace
};
