/**
 * Claude CLI client for the AI Chairman.
 * Routes through Claude Code CLI — covered by your Max subscription.
 * No API charges.
 */

import { runClaudeOnPC } from '../task/ssh-runner.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Call Claude Code CLI locally and parse JSON from the response.
 * Uses the same `claude --dangerously-skip-permissions` as agents.
 */
export async function callChairmanCLI<T = unknown>(
  _model: string, // ignored — CLI uses whatever model your subscription has
  systemPrompt: string,
  messages: ChatMessage[],
  _maxTokens: number = 1500,
): Promise<T> {
  // Build a single prompt from system + conversation history
  const parts: string[] = [systemPrompt, ''];

  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(msg.content);
    } else {
      parts.push(`[YOUR PREVIOUS RESPONSE]: ${msg.content}`);
    }
    parts.push('');
  }

  parts.push('Respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.');

  const prompt = parts.join('\n');

  const result = await runClaudeOnPC(null, prompt, 90_000);

  if (!result.success) {
    throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${result.output}`);
  }

  let raw = result.output;

  // Extract JSON from the response — Claude may wrap it in text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    raw = jsonMatch[0];
  }

  // Strip markdown fences if present
  raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  return JSON.parse(raw) as T;
}
