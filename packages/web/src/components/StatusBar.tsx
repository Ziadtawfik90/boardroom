import { Circle, Activity, Clock, CheckCircle2 } from 'lucide-react';
import type { Agent, Sender, Task } from '../types';

interface StatusBarProps {
  connected: boolean;
  agents: Agent[];
  tasks: Task[];
  typingUsers: Set<Sender>;
}

export function StatusBar({ connected, agents, tasks, typingUsers }: StatusBarProps) {
  const onlineCount = agents.filter((a) => a.status === 'online').length;
  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'approved');
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const typingNames = Array.from(typingUsers)
    .filter((s) => s !== 'user')
    .map((s) => s.toUpperCase());

  return (
    <div className="shrink-0 border-t border-white/[0.03] bg-[#08080d] px-4 py-1.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 text-[10px] text-white/15">
        {/* Connection */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="tracking-wider">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <span className="text-white/[0.06]">&middot;</span>

        {/* Agents */}
        <span className="tracking-wider">
          {onlineCount} agent{onlineCount !== 1 ? 's' : ''}
        </span>

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <>
            <span className="text-white/[0.06]">&middot;</span>
            <span className="tracking-wider text-cyan-500/40">
              {activeTasks.length} active
            </span>
          </>
        )}

        {/* Pending */}
        {pendingTasks.length > 0 && (
          <>
            <span className="text-white/[0.06]">&middot;</span>
            <span className="tracking-wider text-amber-500/40">
              {pendingTasks.length} pending
            </span>
          </>
        )}

        {/* Done */}
        {doneTasks.length > 0 && (
          <>
            <span className="text-white/[0.06]">&middot;</span>
            <span className="tracking-wider text-emerald-500/30">
              {doneTasks.length} done
            </span>
          </>
        )}
      </div>

      {/* Right: who is typing */}
      <div className="text-[10px] text-white/15 tracking-wider">
        {typingNames.length > 0 && (
          <span className="text-white/25">
            {typingNames.join(', ')} responding
          </span>
        )}
      </div>
    </div>
  );
}
