import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Task } from '../types';

const AGENT_COLORS: Record<string, string> = {
  asus: '#4ade80',
  water: '#a78bfa',
  steam: '#fb923c',
};

interface Notification {
  id: string;
  type: 'completed' | 'failed' | 'started' | 'extracted';
  agent: string;
  title: string;
  detail?: string;
  timestamp: number;
}

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { subscribe } = useWebSocket();

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'timestamp'>) => {
    const id = crypto.randomUUID();
    setNotifications((prev) => [{ ...n, id, timestamp: Date.now() }, ...prev].slice(0, 8));
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((x) => x.id !== id));
    }, 8000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    const offs = [
      subscribe('task.completed', (env) => {
        const payload = env.payload as { taskId: string; result?: { output?: string } };
        // We don't have the full task here — just show agent + taskId
        addNotification({
          type: 'completed',
          agent: env.sender,
          title: 'Task completed',
          detail: typeof payload.result?.output === 'string' ? payload.result.output.slice(0, 80) : undefined,
        });
      }),
      subscribe('task.failed', (env) => {
        const payload = env.payload as { taskId: string; error: string };
        addNotification({
          type: 'failed',
          agent: env.sender,
          title: 'Task failed',
          detail: payload.error.slice(0, 80),
        });
      }),
      subscribe('task.accepted', (env) => {
        addNotification({
          type: 'started',
          agent: env.sender,
          title: 'Started working',
        });
      }),
      subscribe('message.new', (env) => {
        const payload = env.payload as { message?: { type: string; content: string; sender: string } };
        const msg = payload?.message;
        if (msg?.type === 'system' && msg.content.includes('task(s)')) {
          addNotification({
            type: 'extracted',
            agent: 'system',
            title: 'Tasks extracted',
            detail: msg.content.slice(0, 100),
          });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [subscribe, addNotification]);

  const icons: Record<string, React.ReactNode> = {
    completed: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    failed: <AlertCircle className="w-4 h-4 text-red-400" />,
    started: <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />,
    extracted: <CheckCircle2 className="w-4 h-4 text-amber-400" />,
  };

  const borderColors: Record<string, string> = {
    completed: 'border-l-emerald-500/40',
    failed: 'border-l-red-500/40',
    started: 'border-l-cyan-500/40',
    extracted: 'border-l-amber-500/40',
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-4 z-50 flex flex-col gap-2 w-[280px]">
      <AnimatePresence mode="popLayout">
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`bg-[#12121a] border border-white/[0.06] border-l-2 ${borderColors[n.type]} rounded-lg p-3 shadow-xl backdrop-blur-sm`}
          >
            <div className="flex items-start gap-2.5">
              {icons[n.type]}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {n.agent !== 'system' && (
                    <span
                      className="text-[9px] font-bold tracking-wider"
                      style={{ color: AGENT_COLORS[n.agent] ?? '#6b7280' }}
                    >
                      {n.agent.toUpperCase()}
                    </span>
                  )}
                  <span className="text-[10px] text-white/60">{n.title}</span>
                </div>
                {n.detail && (
                  <p className="text-[9px] text-white/25 mt-0.5 line-clamp-2">{n.detail}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(n.id)}
                className="text-white/15 hover:text-white/40 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
