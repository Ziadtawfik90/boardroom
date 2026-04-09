import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Send, ChevronUp, FileText, Target, HelpCircle, AlertTriangle } from 'lucide-react';
import type { Message, Sender, MeetingBrief } from '../types';
import { TranscriptEntry } from './TranscriptEntry';

const SENDER_NAMES: Record<Sender, string> = {
  user: 'CHAIRMAN',
  asus: 'ASUS',
  water: 'WATER',
  steam: 'STEAM',
  oracle: 'ORACLE',
  sage: 'SAGE',
  system: 'SYSTEM',
};

interface TranscriptProps {
  messages: Message[];
  typingUsers: Set<Sender>;
  loading: boolean;
  hasMore: boolean;
  onSendMessage: (content: string) => void;
  onSendTyping: () => void;
  onLoadMore: () => void;
  discussionTitle: string | null;
  discussionTopic: string | null;
}

export function Transcript({
  messages,
  typingUsers,
  loading,
  hasMore,
  onSendMessage,
  onSendTyping,
  onLoadMore,
  discussionTitle,
  discussionTopic,
}: TranscriptProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottom = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (isAtBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView();
    isAtBottom.current = true;
  }, [discussionTitle]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    if (!typingTimeout.current) {
      onSendTyping();
      typingTimeout.current = setTimeout(() => {
        typingTimeout.current = null;
      }, 2000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  }

  if (!discussionTitle) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xs text-white/20">No discussion selected</p>
        </div>
      </div>
    );
  }

  const meetingBrief = useMemo((): MeetingBrief | null => {
    if (!discussionTopic) return null;
    try {
      const parsed = JSON.parse(discussionTopic);
      if (parsed && typeof parsed === 'object' && parsed.objective) {
        return parsed as MeetingBrief;
      }
    } catch {
      // Not JSON
    }
    return null;
  }, [discussionTopic]);

  const typingNames = Array.from(typingUsers)
    .filter((s) => s !== 'user')
    .map((s) => SENDER_NAMES[s] ?? s);

  function isRoundSeparator(msg: Message): string | null {
    if (msg.sender !== 'system') return null;
    const match = msg.content.match(/round\s+(\d+)/i);
    if (match) return msg.content;
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Discussion header */}
      <div className="shrink-0 border-b border-white/[0.04] px-6 py-3 bg-[#0a0a12]/50">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-4 rounded-full bg-[#d4af37]/30" />
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-white/70 truncate">
              {discussionTitle}
            </h2>
            {meetingBrief && (
              <span className="text-[10px] text-white/20 tracking-wider uppercase">
                {meetingBrief.objective}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Transcript area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-3"
      >
        {hasMore && (
          <div className="text-center py-3 mb-1">
            <button
              onClick={onLoadMore}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[10px] text-white/20 hover:text-white/40
                         disabled:opacity-50 tracking-wider uppercase transition-colors px-3 py-1.5 rounded-md hover:bg-white/[0.02]"
            >
              <ChevronUp className="w-3 h-3" />
              {loading ? 'Loading...' : 'Load earlier'}
            </button>
          </div>
        )}

        {/* Meeting Brief */}
        {meetingBrief && (
          <MeetingBriefCard brief={meetingBrief} />
        )}

        {messages.map((msg) => {
          const roundLabel = isRoundSeparator(msg);
          if (roundLabel) {
            return (
              <div key={msg.id} className="flex items-center gap-4 py-3 px-6 my-1">
                <div className="flex-1 h-px bg-white/[0.04]" />
                <span className="text-[9px] text-white/15 tracking-[0.2em] uppercase shrink-0 font-medium">
                  {roundLabel}
                </span>
                <div className="flex-1 h-px bg-white/[0.04]" />
              </div>
            );
          }
          return <TranscriptEntry key={msg.id} message={msg} />;
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="shrink-0 px-6 py-2 border-t border-white/[0.03]">
          <span className="text-[11px] text-white/25 italic tracking-wide">
            {typingNames.join(', ')}{' '}
            {typingNames.length === 1 ? 'is responding' : 'are responding'}
            <span className="typing-dot inline-block ml-0.5">.</span>
            <span className="typing-dot inline-block">.</span>
            <span className="typing-dot inline-block">.</span>
          </span>
        </div>
      )}

      {/* Chairman input */}
      <div className="shrink-0 border-t border-white/[0.04] px-4 py-3 bg-[#0a0a12]/30">
        <div className="flex gap-2.5 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Address the board..."
              rows={1}
              className="w-full resize-none border border-white/[0.06] bg-white/[0.02] rounded-xl px-4 py-2.5
                         text-[13px] text-white/80 placeholder:text-white/15
                         focus:border-[#d4af37]/20 focus:bg-white/[0.03] focus:outline-none
                         transition-all duration-200 min-h-[40px] max-h-[120px]"
              aria-label="Chairman message input"
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            disabled={!input.trim()}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl
                       border border-[#d4af37]/20 bg-[#d4af37]/[0.06] text-[#d4af37]/70
                       hover:bg-[#d4af37]/[0.12] hover:text-[#d4af37]
                       disabled:opacity-15 disabled:cursor-not-allowed
                       transition-all duration-200"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
        <p className="text-[10px] text-white/10 mt-1.5 pl-1">
          Enter to send &middot; Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

// Meeting brief card
function MeetingBriefCard({ brief }: { brief: MeetingBrief }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mx-5 mb-3 border border-white/[0.04] rounded-xl bg-[#0e0e16] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.01] transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[#d4af37]/40" />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#d4af37]/40">
            Meeting Brief
          </span>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-[#d4af37]/70">
          {brief.objective}
        </span>
      </button>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="px-5 pb-4 space-y-3 border-t border-white/[0.03]"
        >
          <div className="pt-3" />
          {brief.background && (
            <BriefField icon={<FileText className="w-3 h-3" />} label="Background" value={brief.background} />
          )}
          {brief.keyQuestion && (
            <BriefField icon={<HelpCircle className="w-3 h-3" />} label="Key Question" value={brief.keyQuestion} highlight />
          )}
          {brief.constraints && (
            <BriefField icon={<AlertTriangle className="w-3 h-3" />} label="Constraints" value={brief.constraints} />
          )}
        </motion.div>
      )}
    </div>
  );
}

function BriefField({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-white/15">{icon}</span>
        <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/25">
          {label}
        </span>
      </div>
      <p className={`text-[12px] leading-relaxed pl-[18px] ${highlight ? 'text-white/60' : 'text-white/35'}`}>
        {value}
      </p>
    </div>
  );
}
