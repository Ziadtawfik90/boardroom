import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';
const execFileAsync = promisify(execFile);
const ALLOWED_OPERATIONS = new Set([
    'clone', 'checkout', 'pull', 'push', 'status', 'branch',
]);
export function parseGitCommand(description) {
    const match = description.match(/^git\s+(clone|checkout|pull|push|status|branch)\s*(.*)/i);
    if (!match)
        return null;
    const operation = match[1].toLowerCase();
    const rawArgs = match[2]?.trim() ?? '';
    const args = rawArgs ? rawArgs.split(/\s+/) : [];
    return { operation, args };
}
export async function runGit(command) {
    if (!ALLOWED_OPERATIONS.has(command.operation)) {
        return {
            success: false,
            output: `Disallowed git operation: ${command.operation}`,
        };
    }
    const gitArgs = [command.operation, ...command.args];
    logger.info(`Running: git ${gitArgs.join(' ')}`);
    try {
        const { stdout, stderr } = await execFileAsync('git', gitArgs, {
            cwd: command.cwd,
            timeout: 120_000,
        });
        const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
        logger.info('Git operation succeeded');
        return { success: true, output };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Git operation failed', message);
        return { success: false, output: message };
    }
}
//# sourceMappingURL=git.js.map