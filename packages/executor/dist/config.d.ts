import 'dotenv/config';
import type { AgentId } from '@boardroom/shared';
export declare const config: {
    readonly agentId: AgentId;
    readonly agentKey: string;
    readonly serverUrl: string;
    readonly agentName: string;
    readonly agentRole: string;
    readonly natsUrl: string;
    readonly natsToken: string;
    readonly natsEnabled: boolean;
    readonly syncMode: "nats" | "git" | "rsync" | "share";
    readonly remoteShare: string;
    readonly natsSyncBucket: string;
    readonly gitRemoteBase: string;
    readonly gitBranch: string;
    readonly hubSsh: string;
    readonly syncRoot: string;
    readonly hubPathPrefix: string;
    readonly isHub: boolean;
    readonly syncRetries: number;
    readonly syncTimeoutSec: number;
    readonly syncExtraFlags: string[];
    readonly maxConcurrentTasks: number;
};
//# sourceMappingURL=config.d.ts.map