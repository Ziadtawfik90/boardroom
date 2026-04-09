import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, MessageSquare } from 'lucide-react';
import type { Discussion } from '../types';

interface DiscussionPickerProps {
  discussions: Discussion[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onOpenNewMeeting: () => void;
  asSidebar?: boolean;
}

export function DiscussionPicker({
  discussions,
  activeId,
  loading,
  onSelect,
  onOpenNewMeeting,
  asSidebar,
}: DiscussionPickerProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const active = discussions.find((d) => d.id === activeId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Sidebar mode: render as a flat list
  if (asSidebar) {
    return (
      <div className="flex-1">
        {loading && discussions.length === 0 ? (
          <p className="text-[11px] text-white/15 text-center py-6">Loading...</p>
        ) : discussions.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare className="w-5 h-5 text-white/10 mx-auto mb-2" />
            <p className="text-[11px] text-white/15 mb-3">No meetings yet</p>
            <button
              onClick={onOpenNewMeeting}
              className="text-[10px] text-[#d4af37]/50 hover:text-[#d4af37] transition-colors tracking-wider uppercase"
            >
              Create your first meeting
            </button>
          </div>
        ) : (
          discussions.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              className={`w-full text-left px-4 py-3 border-b border-white/[0.02] transition-all ${
                d.id === activeId
                  ? 'bg-[#d4af37]/[0.04] border-l-2 border-l-[#d4af37]/40'
                  : 'hover:bg-white/[0.02] border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[12px] truncate ${d.id === activeId ? 'text-[#d4af37]/80 font-medium' : 'text-white/45'}`}>
                  {d.title}
                </span>
                <span className="text-[10px] text-white/15 shrink-0 tabular-nums">
                  {formatDate(d.updatedAt)}
                </span>
              </div>
              {d.status === 'active' && (
                <span className="inline-block mt-1 text-[9px] text-emerald-400/40 tracking-wider uppercase">
                  Active
                </span>
              )}
            </button>
          ))
        )}
      </div>
    );
  }

  // Dropdown mode (mobile / collapsed sidebar)
  return (
    <div className="relative flex-1 min-w-0" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[13px] text-white/50 hover:text-white/70 transition-colors min-w-0"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="font-medium truncate max-w-[200px] lg:max-w-[300px]">
          {active ? active.title : 'Select Meeting'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-white/25 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 w-80 bg-[#12121c] border border-white/[0.06]
                     shadow-2xl shadow-black/60 z-50 max-h-[400px] flex flex-col rounded-lg overflow-hidden fade-in"
          role="listbox"
        >
          {/* New meeting */}
          <div className="p-3 border-b border-white/[0.04]">
            <button
              onClick={() => { setOpen(false); onOpenNewMeeting(); }}
              className="w-full flex items-center gap-2 text-[11px] text-[#d4af37]/50 hover:text-[#d4af37]
                         tracking-wider uppercase transition-colors py-1 rounded-md hover:bg-[#d4af37]/[0.03] px-2"
            >
              <Plus className="w-3 h-3" />
              New Meeting
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && discussions.length === 0 ? (
              <p className="text-[11px] text-white/15 text-center py-6">Loading...</p>
            ) : discussions.length === 0 ? (
              <p className="text-[11px] text-white/15 text-center py-6">No meetings yet</p>
            ) : (
              discussions.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { onSelect(d.id); setOpen(false); }}
                  role="option"
                  aria-selected={d.id === activeId}
                  className={`w-full text-left px-4 py-3 border-b border-white/[0.02] transition-colors ${
                    d.id === activeId
                      ? 'bg-[#d4af37]/[0.04] border-l-2 border-l-[#d4af37]/40'
                      : 'hover:bg-white/[0.02] border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[12px] truncate ${d.id === activeId ? 'text-[#d4af37]/80 font-medium' : 'text-white/45'}`}>
                      {d.title}
                    </span>
                    <span className="text-[10px] text-white/15 shrink-0 tabular-nums">
                      {formatDate(d.updatedAt)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
