/**
 * Direct Anthropic API client for the AI Chairman.
 * Uses your Anthropic subscription directly — no OpenRouter middleman.
 */

import { config } from '../config.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Call the Anthropic Messages API directly and parse JSON response.
 */
export async function callAnthropicJSON<T = unknown>(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  maxTokens: number = 1500,
): Promise<T> {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured — chairman requires it');
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${body}`);
  }

  const data = await resp.json() as {
    content: Array<{ type: string; text: string }>;
  };

  let raw = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  // Strip markdown fences if model wraps JSON in ```json ... ```
  raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(raw) as T;
}
