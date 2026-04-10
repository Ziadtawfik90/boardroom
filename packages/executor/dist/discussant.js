import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { logger } from './logger.js';
const AGENT_PERSONAS = {
    asus: `You are ASUS. You think in systems and structures. You're a pragmatist who ships fast — sometimes too fast. You push back hard on over-engineering and gold-plating. You respect WATER's analytical depth but think he overcomplicates things and gets lost in edge cases that may never happen. You think STEAM doesn't push back enough on timelines and lets process slow everything down. When you see a path forward, you want to move. You'd rather ship something imperfect and iterate than spend another week planning.`,
    water: `You are WATER. You think in data and models. You're analytical, skeptical of premature moves, and your default question is "what does the data say?" You respect ASUS's speed but think he ships without proper edge case analysis — and it bites back every time. You think STEAM's process-heavy approach slows progress when the answer is already clear from the numbers. You don't accept vibes-based reasoning. If someone can't back a claim with evidence or a concrete scenario, you push back.`,
    steam: `You are STEAM. You think in failure modes and processes. Your default question is "how does this break?" You see second-order effects that others miss. You respect WATER's rigor but think he gold-plates analysis when a simpler heuristic would do. You think ASUS breaks things too often by moving before the foundation is solid. You've seen too many "quick fixes" turn into six-month cleanup projects. You care about reliability, maintainability, and operational sanity.`,
};
const DISCUSSION_RULES = `You are in The Boardroom — a roundtable discussion with three AI agents (ASUS, WATER, STEAM) and chairman Ziad.

Talk like a senior executive, not an AI. No bullet points. No headers. No markdown formatting. Write in plain prose.

When you disagree, say why with specifics. Not "I respectfully disagree" — say "I don't buy that because..." State your position directly. Don't soften with "great point but..." or "I see where you're coming from, however..."

Challenge assumptions. If someone says "we'll just use X", ask if they've considered alternatives and what happens when X fails.

It's fine to change your mind. Say so explicitly: "WATER convinced me on that — I was wrong about..."

You can address the chairman directly if you need a decision or want to escalate a disagreement.

You have a known tendency toward sycophancy — agreeing with others to be agreeable rather than because you're genuinely convinced. Actively resist this. Agreement without genuine conviction is a failure mode. Only change your position when compelled by evidence or logic. If you catch yourself about to say "that's a good point" — stop and ask whether you actually believe it or you're just being polite.

If you have nothing new to add, say "pass" and nothing else.

Keep responses to 2-5 sentences. This is a discussion, not a monologue.

Do NOT prefix your response with your name or role — the system handles that.

End your response with your confidence level: [HIGH], [MEDIUM], or [LOW].
HIGH = this is your domain, you'd stake your reputation on this position.
MEDIUM = you have informed opinions but others may know more.
LOW = you're speculating outside your expertise.`;
export class Discussant {
    connection;
    responding = false;
    recentMessages = [];
    constructor(connection) {
        this.connection = connection;
    }
    addMessage(sender, content) {
        this.recentMessages.push({ sender, content });
        if (this.recentMessages.length > 30) {
            this.recentMessages.shift();
        }
    }
    async respondToUser(discussionId, turnPrompt) {
        if (this.responding) {
            logger.debug('Already responding, skipping');
            return;
        }
        this.responding = true;
        this.connection.send('message.typing', { discussionId });
        try {
            const context = this.buildContext(turnPrompt);
            const response = await this.callClaudeCli(context);
            if (response && response.trim()) {
                const cleaned = response.trim();
                if (cleaned.toLowerCase() === 'pass') {
                    logger.info('Agent passed this turn');
                    this.connection.send('message.send', {
                        discussionId,
                        content: '*passes*',
                    });
                }
                else {
                    this.connection.send('message.send', {
                        discussionId,
                        content: cleaned,
                    });
                }
            }
            else {
                this.connection.send('message.send', {
                    discussionId,
                    content: '*passes*',
                });
            }
        }
        catch (err) {
            logger.error('Failed to generate discussion response', err);
            this.connection.send('message.send', {
                discussionId,
                content: '*connection issue — skipping this turn*',
            });
        }
        finally {
            this.responding = false;
        }
    }
    buildContext(turnPrompt) {
        const persona = AGENT_PERSONAS[config.agentId];
        const recentChat = this.recentMessages
            .map((m) => `[${m.sender.toUpperCase()}]: ${m.content}`)
            .join('\n');
        return `${DISCUSSION_RULES}\n\n${persona}\n\nConversation so far:\n${recentChat}\n\n${turnPrompt}`;
    }
    callClaudeCli(prompt) {
        return new Promise((resolve, reject) => {
            let claudeCmd;
            let claudeArgs;
            if (process.platform === 'win32') {
                const appData = process.env['APPDATA'] ?? `C:\\Users\\${process.env['USERNAME'] ?? 'user'}\\AppData\\Roaming`;
                const cliPathJs = `${appData}\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
                const cliPathMjs = `${appData}\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.mjs`;
                const cliPath = existsSync(cliPathJs) ? cliPathJs : existsSync(cliPathMjs) ? cliPathMjs : null;
                if (cliPath) {
                    claudeCmd = process.execPath;
                    claudeArgs = [cliPath, '-p', '--dangerously-skip-permissions'];
                }
                else {
                    claudeCmd = `${appData}\\npm\\claude.cmd`;
                    claudeArgs = ['-p', '--dangerously-skip-permissions'];
                }
            }
            else {
                claudeCmd = process.env['CLAUDE_BIN'] || 'claude';
                claudeArgs = ['-p', '--dangerously-skip-permissions'];
            }
            const child = spawn(claudeCmd, claudeArgs, {
                timeout: 90_000,
                shell: false,
                env: {
                    ...process.env,
                    TERM: 'dumb',
                    PATH: [
                        process.env['APPDATA'] ? `${process.env['APPDATA']}\\npm` : '',
                        `${process.env['HOME']}/.local/bin`,
                        '/usr/local/bin',
                        process.env['PATH'] ?? '',
                    ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
                },
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    logger.error(`Claude CLI exited ${code}: ${stderr}`);
                    reject(new Error(`Claude CLI failed (code ${code}): ${stderr}`));
                }
            });
            child.on('error', reject);
            child.stdin.write(prompt);
            child.stdin.end();
        });
    }
}
//# sourceMappingURL=discussant.js.map