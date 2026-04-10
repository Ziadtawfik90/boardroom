export interface ClaudeResult {
    success: boolean;
    output: string;
    exitCode: number | null;
}
export declare function runClaude(taskDescription: string, onProgress: (chunk: string) => void, taskTitle?: string, discussionId?: string, overrideWorkDir?: string): Promise<ClaudeResult>;
//# sourceMappingURL=claude.d.ts.map