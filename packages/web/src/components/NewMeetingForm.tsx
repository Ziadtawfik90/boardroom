import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lightbulb, Scale, Vote, Megaphone } from 'lucide-react';
import type { MeetingBrief } from '../types';

const OBJECTIVES: Array<{
  value: MeetingBrief['objective'];
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { value: 'brainstorm', label: 'Brainstorm', description: 'Generate ideas and explore', icon: <Lightbulb className="w-4 h-4" /> },
  { value: 'evaluate', label: 'Evaluate', description: 'Assess and weigh trade-offs', icon: <Scale className="w-4 h-4" /> },
  { value: 'decide', label: 'Decide', description: 'Reach a concrete decision', icon: <Vote className="w-4 h-4" /> },
  { value: 'inform', label: 'Inform', description: 'Share context and align', icon: <Megaphone className="w-4 h-4" /> },
];

interface NewMeetingFormProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, topic?: string, extra?: { objective?: string; background?: string; keyQuestion?: string; constraints?: string; workspacePath?: string }) => Promise<string>;
}

export function NewMeetingForm({ open, onClose, onCreate }: NewMeetingFormProps) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState<MeetingBrief['objective']>('brainstorm');
  const [background, setBackground] = useState('');
  const [keyQuestion, setKeyQuestion] = useState('');
  const [constraints, setConstraints] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setTitle('');
    setObjective('brainstorm');
    setBackground('');
    setKeyQuestion('');
    setConstraints('');
    setWorkspacePath('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await onCreate(title.trim(), undefined, {
        objective,
        background: background.trim(),
        keyQuestion: keyQuestion.trim(),
        constraints: constraints.trim(),
        workspacePath: workspacePath.trim() || undefined,
      });
      resetForm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          role="dialog"
          aria-modal="true"
          aria-label="New meeting briefing"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-[#0e0e16] border border-white/[0.06] rounded-xl shadow-2xl shadow-black/60
                       max-h-[90vh] flex flex-col overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/[0.04]">
              <div className="flex items-center gap-2.5">
                <div className="w-0.5 h-4 rounded-full bg-[#d4af37]/30" />
                <h2 className="text-[12px] font-medium uppercase tracking-[0.2em] text-[#d4af37]/60">
                  New Meeting
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 text-white/20 hover:text-white/50 transition-colors rounded-md hover:bg-white/[0.03]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Title */}
              <FormField label="Title">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What's on the agenda?"
                  autoFocus
                  className="w-full border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-2.5
                             text-sm text-white/80 placeholder:text-white/15
                             focus:border-[#d4af37]/20 focus:outline-none transition-colors"
                />
              </FormField>

              {/* Objective */}
              <FormField label="Objective">
                <div className="grid grid-cols-2 gap-2">
                  {OBJECTIVES.map((obj) => (
                    <button
                      key={obj.value}
                      type="button"
                      onClick={() => setObjective(obj.value)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-all ${
                        objective === obj.value
                          ? 'border-[#d4af37]/25 bg-[#d4af37]/[0.04]'
                          : 'border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={objective === obj.value ? 'text-[#d4af37]/60' : 'text-white/15'}>
                          {obj.icon}
                        </span>
                        <span className={`text-[11px] font-medium tracking-wider uppercase ${
                          objective === obj.value ? 'text-[#d4af37]/80' : 'text-white/35'
                        }`}>
                          {obj.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/20 pl-6">{obj.description}</span>
                    </button>
                  ))}
                </div>
              </FormField>

              {/* Background */}
              <FormField label="Background" optional>
                <textarea
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  placeholder="What the board needs to know"
                  rows={3}
                  className="w-full border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-2.5
                             text-sm text-white/80 placeholder:text-white/15
                             focus:border-[#d4af37]/20 focus:outline-none transition-colors resize-none"
                />
              </FormField>

              {/* Key Question */}
              <FormField label="Key Question" optional>
                <input
                  type="text"
                  value={keyQuestion}
                  onChange={(e) => setKeyQuestion(e.target.value)}
                  placeholder="The specific question for the board"
                  className="w-full border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-2.5
                             text-sm text-white/80 placeholder:text-white/15
                             focus:border-[#d4af37]/20 focus:outline-none transition-colors"
                />
              </FormField>

              {/* Working Directory */}
              <FormField label="Working Directory" optional>
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="/mnt/d/AI/my-project or leave blank for auto"
                  className="w-full border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-2.5
                             text-sm text-white/80 placeholder:text-white/15 font-mono
                             focus:border-[#d4af37]/20 focus:outline-none transition-colors"
                />
              </FormField>

              {/* Constraints */}
              <FormField label="Constraints" optional>
                <input
                  type="text"
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder="Budget, timeline, non-negotiables"
                  className="w-full border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-2.5
                             text-sm text-white/80 placeholder:text-white/15
                             focus:border-[#d4af37]/20 focus:outline-none transition-colors"
                />
              </FormField>

              {/* Submit */}
              <button
                type="submit"
                disabled={!title.trim() || submitting}
                className="w-full flex items-center justify-center gap-2 border border-[#d4af37]/25 bg-[#d4af37]/[0.06]
                           px-5 py-3 text-[11px] font-medium text-[#d4af37]/80 tracking-[0.15em] uppercase rounded-lg
                           hover:bg-[#d4af37]/[0.1] hover:border-[#d4af37]/35
                           disabled:opacity-15 disabled:cursor-not-allowed transition-all duration-200"
              >
                {submitting ? 'Convening...' : 'Start Meeting'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FormField({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[10px] font-medium text-white/25 mb-2 tracking-[0.15em] uppercase">
        {label}
        {optional && <span className="text-white/10 normal-case tracking-normal">(optional)</span>}
      </label>
      {children}
    </div>
  );
}
