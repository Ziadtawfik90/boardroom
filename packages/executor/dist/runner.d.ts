import type { Task } from '@boardroom/shared';
import type { Connection } from './connection.js';
export declare function getActiveTaskCount(): number;
/** Cancel a running task by ID */
export declare function cancelTask(taskId: string): boolean;
export declare function executeTask(task: Task, conn: Connection, workDir?: string): Promise<void>;
//# sourceMappingURL=runner.d.ts.map