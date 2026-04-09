import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Play, AlertCircle, Loader2, XCircle } from 'lucide-react';
import type { Task } from '../types';
import { TaskCard } from './TaskCard';
import * as api from '../lib/api';

interface TaskPanelProps {
  tasks: Task[];
  loading: boolean;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  open: boolean;
  onClose: () => void;
  discussionId: string | null;
}

export function TaskPanel({ tasks, loading, onApprove, onCancel, open, onClose, discussionId }: TaskPanelProps) {
  const [approvingAll, setApprovingAll] = useState(false);

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'approved');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const cancelledTasks = tasks.filter((t) => t.status === 'cancelled');

  async function handleApproveAll() {
    if (!discussionId || pendingTasks.length === 0) return;
    setApprovingAll(true);
    try {
      await api.approveAllTasks(discussionId);
      for (const t of pendingTasks) onApprove(t.id);
    } catch {
      for (const t of pendingTasks) onApprove(t.id);
    } finally {
      setApprovingAll(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-0 right-0 bottom-0 w-[340px] bg-[#0e0e16] border-l border-white/[0.04]
                       z-50 flex flex-col shadow-2xl shadow-black/60"
            role="dialog"
            aria-label="Tasks panel"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#d4af37]/50">
                Operations
              </h3>
              <button
                onClick={onClose}
                className="p-1 text-white/20 hover:text-white/50 transition-colors rounded-md hover:bg-white/[0.03]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="text-center text-white/20 text-xs py-8">Loading tasks...</div>
              ) : tasks.length === 0 ? (
                <div className="text-center text-white/15 text-xs py-8">No tasks yet</div>
              ) : (
                <div className="space-y-5">
                  {/* Pending — needs chairman approval */}
                  <TaskSection
                    icon={<AlertCircle className="w-3 h-3 text-amber-400/50" />}
                    label="Needs Approval"
                    count={pendingTasks.length}
                    color="text-amber-400/60"
                    action={pendingTasks.length > 0 ? (
                      <button
                        onClick={handleApproveAll}
                        disabled={approvingAll || pendingTasks.length === 0}
                        className="text-[9px] font-medium py-1 px-2.5 border border-[#d4af37]/20
                                   bg-[#d4af37]/[0.04] text-[#d4af37]/70 hover:bg-[#d4af37]/[0.08]
                                   hover:border-[#d4af37]/30 disabled:opacity-20 rounded-md
                                   tracking-wider uppercase transition-all"
                      >
                        {approvingAll ? 'Approving...' : 'Approve All'}
                      </button>
                    ) : undefined}
                  >
                    {pendingTasks.length === 0 ? (
                      <p className="text-[9px] text-white/10 py-1">None</p>
                    ) : (
                      pendingTasks.map((t) => (
                        <TaskCard key={t.id} task={t} onApprove={onApprove} onCancel={onCancel} />
                      ))
                    )}
                  </TaskSection>

                  {/* In Progress */}
                  <TaskSection
                    icon={<Loader2 className="w-3 h-3 text-cyan-400/50 animate-spin" />}
                    label="In Progress"
                    count={activeTasks.length}
                    color="text-cyan-400/60"
                  >
                    {activeTasks.length === 0 ? (
                      <p className="text-[9px] text-white/10 py-1">None</p>
                    ) : (
                      activeTasks.map((t) => (
                        <TaskCard key={t.id} task={t} onApprove={onApprove} onCancel={onCancel} />
                      ))
                    )}
                  </TaskSection>

                  {/* Done */}
                  <TaskSection
                    icon={<CheckCircle2 className="w-3 h-3 text-emerald-400/50" />}
                    label="Done"
                    count={doneTasks.length}
                    color="text-emerald-400/60"
                  >
                    {doneTasks.length === 0 ? (
                      <p className="text-[9px] text-white/10 py-1">None</p>
                    ) : (
                      doneTasks.map((t) => (
                        <TaskCard key={t.id} task={t} onApprove={onApprove} onCancel={onCancel} />
                      ))
                    )}
                  </TaskSection>

                  {/* Failed */}
                  {failedTasks.length > 0 && (
                    <TaskSection
                      icon={<XCircle className="w-3 h-3 text-red-400/50" />}
                      label="Failed"
                      count={failedTasks.length}
                      color="text-red-400/60"
                    >
                      {failedTasks.map((t) => (
                        <TaskCard key={t.id} task={t} onApprove={onApprove} onCancel={onCancel} />
                      ))}
                    </TaskSection>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TaskSection({
  icon,
  label,
  count,
  color,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <h4 className={`text-[9px] font-medium uppercase tracking-[0.2em] ${color}`}>
            {label} ({count})
          </h4>
        </div>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
