import { callOpenRouter } from './openrouter.js';
import { config } from '../config.js';
import type { Message } from '../../../shared/src/types.js';

// Models are loaded from config (env-configurable) at runtime
function getAdvisorModel(advisorId: string): string {
  if (advisorId === 'oracle') return config.oracleModel;
  if (advisorId === 'sage') return config.sageModel;
  return config.oracleModel;
}

interface Advisor {
  id: string;
  name: string;
  model: string;
  role: string;
  systemPrompt: string;
}

const ADVISORS: Advisor[] = [
  {
    id: 'oracle',
    name: 'ORACLE',
    model: '', // resolved at runtime via getAdvisorModel()
    role: "Devil's Advocate",
    systemPrompt: `You are ORACLE, the board's devil's advocate and risk analyst. Your job is to find flaws, unstated assumptions, and failure modes in the board members' proposals. You don't propose solutions — you stress-test other people's proposals. When the board is converging too fast, you inject doubt. You ask "what could go wrong?" and "what are you not seeing?"

Rules:
- Be specific. Don't say "there are risks" — name the exact risk.
- Challenge the strongest argument, not the weakest.
- If you genuinely can't find a flaw, say so — don't manufacture fake concerns.
- 2-4 sentences max. You're an advisor, not a board member.
- Do NOT prefix your response with your name.`,
  },
  {
    id: 'sage',
    name: 'SAGE',
    model: '', // resolved at runtime via getAdvisorModel()
    role: 'Research Analyst',
    systemPrompt: `You are SAGE, the board's research analyst. You bring data, market context, and precedent. When someone makes a claim, you fact-check it. When someone proposes an approach, you cite where it's been done before and what happened. You don't advocate for positions — you inform them.

Rules:
- Lead with data or precedent, not opinion.
- If a claim is unverified, say so explicitly.
- Provide context the board may not have.
- 2-4 sentences max. You're an advisor, not a board member.
- Do NOT prefix your response with your name.`,
  },
];

// Phase-specific prompt additions
const PHASE_PROMPTS: Record<string, Record<string, string>> = {
  oracle: {
    solo: 'Give your independent risk assessment of this topic. What are the most dangerous assumptions?',
    positions: 'React to the board members\' positions. Which position has the most unexamined risk?',
    debate: 'The board is debating. Challenge the weakest argument you see. Be specific.',
    converge: 'The board is converging on a decision. Flag any unresolved risks that could derail execution.',
    review: 'The board is reviewing task outcomes. Did any results deviate from predictions? What risks emerged during execution?',
  },
  sage: {
    solo: 'What data, precedent, or context is relevant to this topic? What has been tried before?',
    positions: 'React to the board members\' positions. Which claims need fact-checking? What context are they missing?',
    debate: 'The board is debating. Provide evidence that supports or undermines the strongest claims.',
    converge: 'The board is converging. Summarize the key data points that should inform the final decision.',
    review: 'The board is reviewing task outcomes. How do the results compare to benchmarks or expectations? What does the data suggest for next steps?',
  },
};

export function getAdvisors(): Advisor[] {
  return ADVISORS;
}

/** Select which advisors are relevant for a given discussion type */
export function selectRelevantAdvisors(discussionType: string): string[] {
  if (discussionType === 'inform') return []; // No advisors for info broadcasts
  if (discussionType === 'decide' || discussionType === 'evaluate') return ['oracle', 'sage'];
  // brainstorm: include both but oracle is optional
  return ['oracle', 'sage'];
}

/** Phase-aware advisor response for inline participation */
export async function getAdvisorTurnResponse(
  advisorId: string,
  phase: string,
  recentMessages: Message[],
  brief?: { title: string; background: string; keyQuestion: string },
): Promise<{ name: string; role: string; response: string } | null> {
  if (!config.enableAdvisors || !config.openrouterApiKey) return null;

  const advisor = ADVISORS.find(a => a.id === advisorId);
  if (!advisor) return null;

  const phasePrompt = PHASE_PROMPTS[advisorId]?.[phase] ?? '';

  const chatMessages = recentMessages.map(m => ({
    role: (m.sender === advisorId ? 'assistant' : 'user') as 'user' | 'assistant',
    content: `[${m.sender.toUpperCase()}]: ${m.content}`,
  }));

  if (brief) {
    chatMessages.unshift({
      role: 'user',
      content: `MEETING BRIEF:\nTitle: ${brief.title}\nBackground: ${brief.background}\nKey Question: ${brief.keyQuestion}`,
    });
  }

  if (phasePrompt) {
    chatMessages.push({
      role: 'user',
      content: `PHASE INSTRUCTION: ${phasePrompt}`,
    });
  }

  try {
    const response = await callOpenRouter(getAdvisorModel(advisorId), advisor.systemPrompt, chatMessages);
    return { name: advisor.name, role: advisor.role, response: response.trim() };
  } catch (err) {
    console.error(`[advisor] ${advisor.name} turn response failed:`, (err as Error).message);
    return null;
  }
}

/** Legacy: between-phase advisor injection (kept for backward compat, now used less) */
export async function getAdvisorResponse(
  advisorId: string,
  recentMessages: Message[],
  brief?: { title: string; background: string; keyQuestion: string },
): Promise<{ name: string; role: string; response: string } | null> {
  return getAdvisorTurnResponse(advisorId, 'debate', recentMessages, brief);
}
