import { useEffect, useRef, useState } from 'react';
import { ws } from '../lib/ws';
import * as api from '../lib/api';
import type { TaskProgressPayload } from '../types';

interface ExecutionLogProps {
  taskId: string;
}

interface LogEntry {
  level: string;
  message: string;
  createdAt: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-white/30',
  warn: 'text-amber-400/60',
  error: 'text-red-400/60',
  debug: 'text-white/15',
};

export function ExecutionLog({ taskId }: ExecutionLogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.fetchTask(taskId).then((task) => {
      if (!cancelled && task.logs) {
        setLogs(task.logs);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    const off = ws.on('task.progress', (env) => {
      const payload = env.payload as TaskProgressPayload;
      if (payload.taskId === taskId && payload.log) {
        setLogs((prev) => [
          ...prev,
          { level: 'info', message: payload.log, createdAt: env.timestamp },
        ]);
      }
    });
    return off;
  }, [taskId]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="max-h-48 overflow-y-auto bg-[#08080d] border border-white/[0.04] rounded-md p-3
                 font-mono text-[11px] leading-5"
      role="log"
      aria-label="Execution log"
    >
      {logs.length === 0 && (
        <span className="text-white/15">No log output yet...</span>
      )}
      {logs.map((entry, i) => (
        <div key={i} className={LEVEL_COLORS[entry.level] ?? 'text-white/25'}>
          {entry.message}
        </div>
      ))}
    </div>
  );
}
