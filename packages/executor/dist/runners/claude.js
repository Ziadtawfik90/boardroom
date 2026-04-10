import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { logger } from '../logger.js';
import { config } from '../config.js';
async function fetchDiscussionContext(discussionId) {
    try {
        const httpUrl = config.serverUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace(/\/ws\/?$/, '');
        // Login to get token
        const loginRes = await fetch(`${httpUrl}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: config.agentKey }),
        });
        const { token } = await loginRes.json();
        // Fetch discussion with messages
        const discRes = await fetch(`${httpUrl}/api/v1/discussions/${discussionId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await discRes.json();
        return data.messages ?? [];
    }
    catch (err) {
        logger.warn('Failed to fetch discussion context', err.message);
        return [];
    }
}
function buildPrompt(ctx) {
    const lines = [
        `You are ${config.agentName} (${config.agentRole}), a Boardroom agent executing a task autonomously.`,
        '',
    ];
    // Include discussion context if available
    if (ctx.discussionMessages && ctx.discussionMessages.length > 0) {
        lines.push('DISCUSSION CONTEXT (what the board discussed before assigning this task):');
        for (const msg of ctx.discussionMessages.slice(-10)) { // last 10 messages
            lines.push(`  [${msg.sender.toUpperCase()}]: ${msg.content}`);
        }
        lines.push('');
    }
    lines.push(`TASK: ${ctx.title}`, `DETAILS: ${ctx.description}`, '', 'RULES:', '- Execute this task immediately. Do NOT ask for clarification.', '- If the task involves creating files, create them in the current working directory.', '- If the task involves running commands, run them.', '- Be concise. Report what you did and the results.', '- If you encounter an error, report it clearly.');
    return lines.join('\n');
}
export async function runClaude(taskDescription, onProgress, taskTitle, discussionId, overrideWorkDir) {
    // Fetch discussion context if available
    let discussionMessages;
    if (discussionId) {
        discussionMessages = await fetchDiscussionContext(discussionId);
        logger.info(`Fetched ${discussionMessages.length} discussion messages for context`);
    }
    const prompt = buildPrompt({
        title: taskTitle ?? taskDescription,
        description: taskDescription,
        discussionMessages,
    });
    const workDir = overrideWorkDir || process.env['WORK_DIR'] || process.cwd();
    // Resolve claude binary
    let claudeCmd;
    let claudeArgs;
    if (process.platform === 'win32') {
        // On Windows, find the claude JS entry point and run via node directly
        // This avoids needing cmd.exe / shell which may not be available in service contexts
        const appData = process.env['APPDATA'] ?? `C:\\Users\\${process.env['USERNAME'] ?? 'user'}\\AppData\\Roaming`;
        const npmDir = `${appData}\\npm`;
        const nodeModulesDir = `${npmDir}\\node_modules\\@anthropic-ai\\claude-code`;
        const cliPathJs = `${nodeModulesDir}\\cli.js`;
        const cliPathMjs = `${nodeModulesDir}\\cli.mjs`;
        const cliPath = existsSync(cliPathJs) ? cliPathJs : existsSync(cliPathMjs) ? cliPathMjs : null;
        if (cliPath) {
            claudeCmd = process.execPath; // node.exe
            claudeArgs = [cliPath, '-p', '--dangerously-skip-permissions', '--output-format', 'json'];
        }
        else {
            // Fallback: try claude.cmd with shell
            claudeCmd = `${npmDir}\\claude.cmd`;
            claudeArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'json'];
        }
    }
    else {
        claudeCmd = process.env['CLAUDE_BIN'] || 'claude';
        claudeArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'json'];
    }
    logger.info(`Spawning Claude Code CLI: ${claudeCmd} ${claudeArgs[0]} (cwd: ${workDir})`);
    return new Promise((resolve) => {
        const child = spawn(claudeCmd, claudeArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: workDir,
            env: {
                ...process.env,
                PATH: [
                    process.env['APPDATA'] ? `${process.env['APPDATA']}\\npm` : '',
                    `${process.env['HOME']}/.local/bin`,
                    `${process.env['HOME']}/.npm-global/bin`,
                    '/usr/local/bin',
                    process.env['PATH'] ?? '',
                ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
            },
        });
        // Set encoding on pipes for reliable Windows output capture
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        // Write prompt to stdin and close it
        child.stdin.write(prompt);
        child.stdin.end();
        const chunks = [];
        child.stdout.on('data', (text) => {
            chunks.push(text);
            onProgress(text);
        });
        child.stderr.on('data', (text) => {
            chunks.push(`[stderr] ${text}`);
            logger.warn('Claude stderr', text);
        });
        child.on('error', (err) => {
            logger.error('Failed to spawn Claude CLI', err.message);
            resolve({
                success: false,
                output: `Failed to spawn Claude CLI: ${err.message}`,
                exitCode: null,
            });
        });
        child.on('close', (code) => {
            const rawOutput = chunks.join('');
            logger.info(`Claude CLI exited with code ${code}`);
            // Parse JSON output if available (--output-format json)
            let output = rawOutput;
            try {
                const parsed = JSON.parse(rawOutput);
                if (parsed.result) {
                    output = parsed.result;
                }
                else if (parsed.content) {
                    output = parsed.content;
                }
            }
            catch {
                // Not JSON — use raw output (happens if CLI doesn't support --output-format)
            }
            resolve({
                success: code === 0,
                output,
                exitCode: code,
            });
        });
    });
}
//# sourceMappingURL=claude.js.map