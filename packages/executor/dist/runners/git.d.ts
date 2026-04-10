export interface GitResult {
    success: boolean;
    output: string;
}
type GitOperation = 'clone' | 'checkout' | 'pull' | 'push' | 'status' | 'branch';
interface GitCommand {
    operation: GitOperation;
    args: string[];
    cwd?: string;
}
export declare function parseGitCommand(description: string): GitCommand | null;
export declare function runGit(command: GitCommand): Promise<GitResult>;
export {};
//# sourceMappingURL=git.d.ts.map