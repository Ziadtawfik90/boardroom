import { useState } from 'react';
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import type { Task } from '../types';
import { ExecutionLog } from './ExecutionLog';

const STATUS_STYLES: Record<string, { border: string; text: string; badge: string }> = {
  pending: { border: 'border-amber-500/10', text: 'text-amber-400/60', badge: 'bg-amber-500/10 text-amber-400/70' },
  approved: { border: 'border-blue-500/10', text: 'text-blue-400/60', badge: 'bg-blue-500/10 text-blue-400/70' },
  running: { border: 'border-cyan-500/10', text: 'text-cyan-400/60', badge: 'bg-cyan-500/10 text-cyan-400/70' },
  done: { border: 'border-emerald-500/10', text: 'text-emerald-400/60', badge: 'bg-emerald-500/10 text-emerald-400/70' },
  failed: { border: 'border-red-500/10', text: 'text-red-400/60', badge: 'bg-red-500/10 text-red-400/70' },
  cancelled: { border: 'border-white/[0.04]', text: 'text-white/25', badge: 'bg-white/[0.04] text-white/30' },
};

const ASSIGNEE_COLORS: Record<string, string> = {
  asus: '#4ade80',
  water: '#a78bfa',
  steam: '#fb923c',
};

interface TaskCardProps {
  task: Task;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}

export function TaskCard({ task, onApprove, onCancel }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const style = STATUS_STYLES[task.status] ?? STATUS_STYLES.pending;
  const showActions = task.status === 'pending';
  const showProgress = task.status === 'running';
  const showLog = task.status === 'running' || task.status === 'done' || task.status === 'failed';
  const assigneeColor = ASSIGNEE_COLORS[task.assignee] ?? '#6b7280';

  return (
    <div className={`border ${style.border} bg-[#0a0a12] rounded-lg p-3`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] font-medium text-white/60 truncate">{task.title}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-medium tracking-wider" style={{ color: assigneeColor + '90' }}>
              {task.assignee.toUpperCase()}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${style.badge} tracking-wider uppercase`}>
              {task.status}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-[11px] text-white/20 mt-2 line-clamp-2 leading-relaxed">{task.description}</p>
      )}

      {/* Progress bar */}
      {showProgress && (
        <div className="mt-3">
          <div className="flex justify-between text-[9px] text-white/20 mb-1">
            <span className="tracking-wider uppercase">Progress</span>
            <span className="tabular-nums">{task.progress}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400/40 transition-all duration-500"
              style={{ width: `${task.progress}%` }}
              role="progressbar"
              aria-valuenow={task.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {task.status === 'failed' && task.error && (
        <p className="text-[11px] text-red-400/70 mt-2 bg-red-500/[0.04] border border-red-500/10
                      rounded-md p-2 font-mono leading-relaxed">
          {task.error}
        </p>
      )}

      {/* Actions */}
      {showActions && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onApprove(task.id)}
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium py-1.5
                       border border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400/70
                       hover:bg-emerald-500/[0.08] rounded-md tracking-wider uppercase transition-colors"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => onCancel(task.id)}
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium py-1.5
                       border border-white/[0.04] text-white/25 hover:text-white/40
                       hover:border-white/[0.08] rounded-md tracking-wider uppercase transition-colors"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        </div>
      )}

      {/* Expandable log */}
      {showLog && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/40
                       transition-colors tracking-wider uppercase"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? 'Hide log' : 'Show log'}
          </button>
          {expanded && (
            <div className="mt-2">
              <ExecutionLog taskId={task.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
