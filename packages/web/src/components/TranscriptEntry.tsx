import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, Sender } from '../types';

const ADVISOR_SENDERS = new Set(['oracle', 'sage']);

const AGENT_CONFIG: Record<Sender, {
  color: string; bg: string; border: string; label: string;
  role: string; avatarBg: string; avatarText: string;
}> = {
  asus: {
    color: 'text-[#4ade80]', bg: 'bg-[#4ade80]/[0.03]', border: 'border-[#4ade80]/10',
    label: 'ASUS', role: 'The Builder', avatarBg: 'bg-[#4ade80]/10', avatarText: 'text-[#4ade80]',
  },
  water: {
    color: 'text-[#a78bfa]', bg: 'bg-[#a78bfa]/[0.03]', border: 'border-[#a78bfa]/10',
    label: 'WATER', role: 'Heavy Lifter', avatarBg: 'bg-[#a78bfa]/10', avatarText: 'text-[#a78bfa]',
  },
  steam: {
    color: 'text-[#fb923c]', bg: 'bg-[#fb923c]/[0.03]', border: 'border-[#fb923c]/10',
    label: 'STEAM', role: 'The Operator', avatarBg: 'bg-[#fb923c]/10', avatarText: 'text-[#fb923c]',
  },
  oracle: {
    color: 'text-[#f87171]', bg: 'bg-[#f87171]/[0.02]', border: 'border-[#f87171]/8',
    label: 'ORACLE', role: 'Risk Analyst', avatarBg: 'bg-[#f87171]/10', avatarText: 'text-[#f87171]',
  },
  sage: {
    color: 'text-[#2dd4bf]', bg: 'bg-[#2dd4bf]/[0.02]', border: 'border-[#2dd4bf]/8',
    label: 'SAGE', role: 'Research', avatarBg: 'bg-[#2dd4bf]/10', avatarText: 'text-[#2dd4bf]',
  },
  user: {
    color: 'text-[#d4af37]', bg: 'bg-[#d4af37]/[0.04]', border: 'border-[#d4af37]/15',
    label: 'CHAIRMAN', role: 'You', avatarBg: 'bg-[#d4af37]/15', avatarText: 'text-[#d4af37]',
  },
  system: {
    color: 'text-white/30', bg: '', border: '', label: 'SYSTEM', role: '',
    avatarBg: '', avatarText: '',
  },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

interface TranscriptEntryProps {
  message: Message;
}

export const TranscriptEntry = memo(function TranscriptEntry({ message }: TranscriptEntryProps) {
  const config = AGENT_CONFIG[message.sender] ?? AGENT_CONFIG.system;
  const isUser = message.sender === 'user';
  const isSystem = message.sender === 'system';
  const isAdvisor = ADVISOR_SENDERS.has(message.sender);

  // System messages
  if (isSystem) {
    return (
      <div className="message-enter flex justify-center py-2.5 px-4">
        <span className="text-[11px] text-white/20 tracking-wide">
          {message.content}
        </span>
      </div>
    );
  }

  // Pass messages
  if (message.content === '*passes*') {
    return (
      <div className="message-enter flex items-center gap-2 py-1.5 px-6 opacity-30">
        <span className={`text-[10px] tracking-wider ${config.color}`}>{config.label}</span>
        <span className="text-[10px] text-white/30 italic">passes</span>
      </div>
    );
  }

  const isDecision = message.type === 'decision';
  const isAction = message.type === 'action';

  return (
    <div className={`message-enter flex gap-3 px-5 py-2.5 ${isUser ? 'flex-row-reverse' : ''} ${isAdvisor ? 'pl-10 opacity-80' : ''}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wider ${config.avatarBg} ${config.avatarText}`}>
        {config.label.slice(0, 2)}
      </div>

      {/* Content */}
      <div className={`max-w-[78%] min-w-[180px] ${isUser ? 'items-end' : ''}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'justify-end' : ''}`}>
          <span className={`text-[10px] font-semibold tracking-[0.1em] ${config.color}`}>
            {config.label}
          </span>
          {isAdvisor && (
            <span className={`text-[8px] tracking-[0.15em] uppercase ${config.color} opacity-50 border ${config.border} px-1.5 py-px rounded`}>
              Advisor
            </span>
          )}
          {isDecision && (
            <span className="text-[8px] tracking-[0.15em] uppercase text-[#d4af37]/50 border border-[#d4af37]/15 px-1.5 py-px rounded">
              Decision
            </span>
          )}
          {isAction && (
            <span className="text-[8px] tracking-[0.15em] uppercase text-blue-400/50 border border-blue-400/15 px-1.5 py-px rounded">
              Action
            </span>
          )}
          <time className="text-[10px] text-white/15 tabular-nums ml-auto" dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
        </div>

        {/* Message bubble */}
        <div className={`px-4 py-3 border ${config.border} ${config.bg} ${
          isUser ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl rounded-tl-sm'
        }`}>
          <div className={`prose-message ${isAdvisor ? 'italic' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
});
