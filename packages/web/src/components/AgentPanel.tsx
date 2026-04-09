import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Clock, Monitor, CheckCircle2, Loader2, AlertCircle, Hourglass } from 'lucide-react';
import type { Agent, Sender, Task } from '../types';

const AGENT_COLORS: Record<string, { accent: string; bg: string; border: string; dot: string }> = {
  asus: { accent: '#4ade80', bg: 'bg-[#4ade80]/[0.03]', border: 'border-[#4ade80]/10', dot: 'bg-[#4ade80]' },
  water: { accent: '#a78bfa', bg: 'bg-[#a78bfa]/[0.03]', border: 'border-[#a78bfa]/10', dot: 'bg-[#a78bfa]' },
  steam: { accent: '#fb923c', bg: 'bg-[#fb923c]/[0.03]', border: 'border-[#fb923c]/10', dot: 'bg-[#fb923c]' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dotClass: string }> = {
  online: { label: 'Ready', color: 'text-emerald-400/70', dotClass: 'bg-emerald-400' },
  offline: { label: 'Offline', color: 'text-white/20', dotClass: 'bg-white/20' },
  busy: { label: 'Working', color: 'text-amber-400/70', dotClass: 'bg-amber-400' },
};

interface AgentCardProps {
  agent: Agent;
  isTyping: boolean;
  tasks: Task[];
  allTasks: Task[];
}

function AgentCard({ agent, isTyping, tasks, allTasks }: AgentCardProps) {
  const colors = AGENT_COLORS[agent.id] ?? { accent: '#6b7280', bg: 'bg-white/[0.02]', border: 'border-white/[0.06]', dot: 'bg-white/30' };
  const status = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.offline;

  const myTasks = tasks.filter((t) => t.assignee === agent.id);
  const running = myTasks.filter((t) => t.status === 'running');
  const pending = myTasks.filter((t) => t.status === 'pending' || t.status === 'approved');
  const done = myTasks.filter((t) => t.status === 'done');
  const failed = myTasks.filter((t) => t.status === 'failed');

  // Check what this agent is waiting on (blocked dependencies)
  const waitingOn: string[] = [];
  for (const task of pending) {
    if (task.dependencies && task.dependencies.length > 0) {
      for (const depId of task.dependencies) {
        const dep = allTasks.find((t) => t.id === depId);
        if (dep && dep.status !== 'done') {
          waitingOn.push(`${dep.assignee.toUpperCase()}: ${dep.title.slice(0, 30)}`);
        }
      }
    }
  }

  const isActive = isTyping || running.length > 0;
  const hasWork = myTasks.length > 0;

  return (
    <motion.div
      layout
      className={`border ${colors.border} ${colors.bg} rounded-lg p-3 transition-all duration-300 ${
        isActive ? 'shadow-lg' : ''
      }`}
      style={isActive ? { boxShadow: `0 0 20px ${colors.accent}08` } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold tracking-wider"
            style={{ backgroundColor: `${colors.accent}12`, color: colors.accent }}
          >
            {agent.name.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold tracking-wider" style={{ color: colors.accent }}>
              {agent.name}
            </span>
            <p className="text-[9px] text-white/20 truncate">{agent.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <span className={`block w-2 h-2 rounded-full ${status.dotClass} ${
              agent.status === 'online' ? 'animate-pulse' : ''
            }`} />
          </div>
          <span className={`text-[9px] tracking-wider ${status.color}`}>{status.label}</span>
        </div>
      </div>

      {/* Task summary pills */}
      {hasWork && (
        <div className="flex items-center gap-1.5 mt-2 mb-1.5">
          {done.length > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-emerald-500/10 text-emerald-400/70">
              <CheckCircle2 className="w-2.5 h-2.5" /> {done.length}
            </span>
          )}
          {running.length > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-cyan-500/10 text-cyan-400/70">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> {running.length}
            </span>
          )}
          {pending.length > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-amber-500/10 text-amber-400/70">
              <Hourglass className="w-2.5 h-2.5" /> {pending.length}
            </span>
          )}
          {failed.length > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-red-500/10 text-red-400/70">
              <AlertCircle className="w-2.5 h-2.5" /> {failed.length}
            </span>
          )}
        </div>
      )}

      {/* Typing indicator */}
      {isTyping && (
        <div className="mt-1.5 py-2 px-2.5 rounded-md bg-black/20 border-l-2" style={{ borderLeftColor: `${colors.accent}40` }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px] text-white/30 italic">Formulating response...</span>
          </div>
        </div>
      )}

      {/* Active task with progress */}
      {!isTyping && running.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {running.map((task) => (
            <div key={task.id} className="py-1.5 px-2.5 rounded-md bg-black/20 border-l-2 border-l-cyan-500/30">
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 text-cyan-400/60 animate-spin shrink-0" />
                <span className="text-[10px] text-cyan-400/70 truncate">{task.title}</span>
              </div>
              {task.progress > 0 && (
                <div className="mt-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-400/40 transition-all duration-500"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending tasks list */}
      {!isTyping && running.length === 0 && pending.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {pending.slice(0, 2).map((task) => (
            <div key={task.id} className="py-1 px-2.5 rounded-md bg-black/10">
              <div className="flex items-center gap-1.5">
                <Hourglass className="w-2.5 h-2.5 text-amber-400/40 shrink-0" />
                <span className="text-[9px] text-white/30 truncate">{task.title}</span>
              </div>
            </div>
          ))}
          {pending.length > 2 && (
            <span className="text-[8px] text-white/15 pl-2.5">+{pending.length - 2} more</span>
          )}
        </div>
      )}

      {/* Waiting on dependencies */}
      {waitingOn.length > 0 && (
        <div className="mt-1.5 py-1 px-2.5 rounded-md bg-amber-500/[0.03] border border-amber-500/10">
          <span className="text-[8px] text-amber-400/40 uppercase tracking-wider">Waiting on:</span>
          {waitingOn.slice(0, 2).map((dep, i) => (
            <p key={i} className="text-[9px] text-amber-400/30 truncate">{dep}</p>
          ))}
        </div>
      )}

      {/* Recently completed */}
      {!isTyping && running.length === 0 && pending.length === 0 && done.length > 0 && (
        <div className="mt-1.5 py-1 px-2.5 rounded-md bg-emerald-500/[0.03]">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400/40" />
            <span className="text-[9px] text-emerald-400/40">
              {done.length} task{done.length > 1 ? 's' : ''} completed
            </span>
          </div>
          <p className="text-[8px] text-white/15 mt-0.5 truncate">{done[done.length - 1]?.title}</p>
        </div>
      )}

      {/* Idle */}
      {!isTyping && !hasWork && agent.status === 'online' && (
        <div className="mt-1.5 py-1.5 px-2.5 opacity-30">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-white/30" />
            <span className="text-[10px] text-white/30">Standing by</span>
          </div>
        </div>
      )}

      {agent.status === 'offline' && !hasWork && (
        <div className="mt-1.5 py-1.5 px-2.5 opacity-20">
          <div className="flex items-center gap-1.5">
            <Monitor className="w-3 h-3 text-white/20" />
            <span className="text-[10px] text-white/20">Disconnected</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

interface AgentPanelProps {
  agents: Agent[];
  typingUsers: Set<Sender>;
  tasks: Task[];
}

export function AgentPanel({ agents, typingUsers, tasks }: AgentPanelProps) {
  const online = agents.filter((a) => a.status === 'online').length;

  return (
    <div className="h-full flex flex-col border-l border-white/[0.04] bg-[#0a0a12]">
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <span className="text-[10px] font-medium text-white/25 tracking-[0.2em] uppercase">
          Board Members
        </span>
        <span className="text-[10px] text-white/15 tabular-nums">
          {online}/{agents.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isTyping={typingUsers.has(agent.id as Sender)}
            tasks={tasks}
            allTasks={tasks}
          />
        ))}
      </div>
    </div>
  );
}
