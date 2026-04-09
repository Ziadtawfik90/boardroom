import { useState } from 'react';
import { Monitor, Wifi } from 'lucide-react';
import type { Agent } from '../types';

const AGENT_COLORS: Record<string, string> = {
  asus: '#4ade80',
  water: '#a78bfa',
  steam: '#fb923c',
};

const STATUS_DOT: Record<string, string> = {
  online: 'bg-emerald-400',
  offline: 'bg-white/15',
  busy: 'bg-amber-400',
};

interface AgentPillProps {
  agent: Agent;
}

function AgentPill({ agent }: AgentPillProps) {
  const [showPopover, setShowPopover] = useState(false);
  const dotColor = STATUS_DOT[agent.status] ?? STATUS_DOT.offline;
  const accentColor = AGENT_COLORS[agent.id] ?? '#6b7280';

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <button
        className="flex items-center gap-1.5 px-2 py-1 hover:bg-white/[0.03] transition-colors rounded-md"
        aria-label={`${agent.name}: ${agent.status}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${agent.status === 'online' ? 'animate-pulse' : ''}`} />
        <span className="text-[10px] font-medium tracking-wider uppercase" style={{ color: accentColor + '90' }}>
          {agent.name}
        </span>
      </button>

      {/* Popover */}
      {showPopover && (
        <div className="absolute top-full right-0 mt-2 w-52 bg-[#12121c] border border-white/[0.06]
                       shadow-2xl shadow-black/60 rounded-lg p-3 z-50 fade-in">
          <div className="flex items-center gap-2.5 mb-3">
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold tracking-wider"
              style={{ backgroundColor: accentColor + '15', color: accentColor }}
            >
              {agent.name.slice(0, 2)}
            </div>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: accentColor }}>{agent.name}</p>
              <p className="text-[10px] text-white/25">{agent.role}</p>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/[0.04] pt-2">
            <PopoverRow label="Status" value={agent.status} capitalize />
            <PopoverRow label="Host" value={agent.host} />
            {agent.currentTask && (
              <PopoverRow label="Task" value={agent.currentTask.title} accent />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PopoverRow({ label, value, capitalize, accent }: { label: string; value: string; capitalize?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[10px] text-white/20">{label}</span>
      <span className={`text-[10px] truncate ml-2 max-w-[120px] ${
        accent ? 'text-cyan-400/70' : 'text-white/40'
      } ${capitalize ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}

interface AgentStatusProps {
  agents: Agent[];
}

export function AgentStatus({ agents }: AgentStatusProps) {
  return (
    <div className="flex items-center gap-0.5">
      {agents.map((agent) => (
        <AgentPill key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
