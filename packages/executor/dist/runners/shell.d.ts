export interface ShellResult {
    success: boolean;
    output: string;
    exitCode: number | null;
}
export interface ShellCommand {
    binary: string;
    args: string[];
    cwd?: string;
}
export declare function parseShellCommand(raw: string): ShellCommand | null;
export declare function runShell(command: ShellCommand): Promise<ShellResult>;
//# sourceMappingURL=shell.d.ts.map