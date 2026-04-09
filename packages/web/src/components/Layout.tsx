import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Wifi, WifiOff, Users,
} from 'lucide-react';
import type { Discussion, Message, Task, Agent, Sender } from '../types';
import { DiscussionPicker } from './DiscussionPicker';
import { NewMeetingForm } from './NewMeetingForm';
import { Transcript } from './Transcript';
import { AgentPanel } from './AgentPanel';
import { TaskPanel } from './TaskPanel';
import { StatusBar } from './StatusBar';

interface LayoutProps {
  discussions: Discussion[];
  discussionsLoading: boolean;
  connected: boolean;
  onSelectDiscussion: (id: string) => void;
  onCreateDiscussion: (title: string, topic?: string, extra?: { objective?: string; background?: string; keyQuestion?: string; constraints?: string }) => Promise<string>;
  onLogout: () => void;
  activeDiscussion: Discussion | null;
  messages: Message[];
  messagesLoading: boolean;
  hasMoreMessages: boolean;
  typingUsers: Set<Sender>;
  onSendMessage: (content: string) => void;
  onSendTyping: () => void;
  onLoadMore: () => void;
  agents: Agent[];
  tasks: Task[];
  tasksLoading: boolean;
  onApproveTask: (id: string) => void;
  onCancelTask: (id: string) => void;
}

export function Layout({
  discussions,
  discussionsLoading,
  connected,
  onSelectDiscussion,
  onCreateDiscussion,
  onLogout,
  activeDiscussion,
  messages,
  messagesLoading,
  hasMoreMessages,
  typingUsers,
  onSendMessage,
  onSendTyping,
  onLoadMore,
  agents,
  tasks,
  tasksLoading,
  onApproveTask,
  onCancelTask,
}: LayoutProps) {
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'approved').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const totalActive = pendingCount + runningCount;
  const onlineCount = agents.filter((a) => a.status === 'online').length;

  return (
    <div className="h-screen flex flex-col bg-[#08080d] text-gray-100">
      {/* Top bar */}
      <header className="shrink-0 border-b border-white/[0.04] bg-[#08080d]/80 backdrop-blur-sm relative z-30">
        <div className="flex items-center justify-between px-3 h-12">
          {/* Left: Brand + controls */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Sidebar toggle */}
            <button
              onClick={() => setLeftCollapsed(!leftCollapsed)}
              className="p-1.5 text-white/20 hover:text-white/50 transition-colors hidden lg:flex"
              aria-label="Toggle sidebar"
            >
              {leftCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>

            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-[#d4af37]/[0.08] border border-[#d4af37]/15 flex items-center justify-center">
                <div className="grid grid-cols-2 gap-[2px]">
                  <div className="w-1 h-1 rounded-[1px] bg-[#4ade80]/50" />
                  <div className="w-1 h-1 rounded-[1px] bg-[#a78bfa]/50" />
                  <div className="w-1 h-1 rounded-[1px] bg-[#fb923c]/50" />
                  <div className="w-1 h-1 rounded-[1px] bg-[#d4af37]/50" />
                </div>
              </div>
              <span className="text-[11px] font-medium text-white/40 tracking-[0.2em] uppercase hidden sm:block">
                Boardroom
              </span>
            </div>

            <div className="w-px h-4 bg-white/[0.04] hidden sm:block" />

            {/* Connection indicator */}
            <div className="flex items-center gap-1.5">
              {connected ? (
                <Wifi className="w-3 h-3 text-emerald-400/60" />
              ) : (
                <WifiOff className="w-3 h-3 text-red-400/60" />
              )}
              <span className="text-[10px] text-white/20 tracking-wider hidden sm:block">
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          {/* Center: Discussion title (mobile: compact view) */}
          <div className="flex-1 flex items-center justify-center px-4 min-w-0 lg:hidden">
            {activeDiscussion && (
              <span className="text-xs text-white/50 truncate">{activeDiscussion.title}</span>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            {/* Agent count */}
            <div className="flex items-center gap-1.5 px-2 py-1 text-white/20">
              <Users className="w-3 h-3" />
              <span className="text-[10px] tracking-wider">
                {onlineCount}/{agents.length}
              </span>
            </div>

            {/* Tasks button */}
            <button
              onClick={() => setTaskPanelOpen(true)}
              className="relative flex items-center gap-1.5 px-2.5 py-1.5
                         text-[10px] text-white/25 hover:text-white/50 transition-colors
                         tracking-[0.15em] uppercase rounded-md hover:bg-white/[0.02]"
              aria-label="Open tasks panel"
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tasks</span>
              {tasks.length > 0 && (
                <span className="flex items-center gap-1 ml-1">
                  {pendingCount > 0 && (
                    <span className="min-w-[16px] h-4 bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center rounded-full px-1">
                      {pendingCount}
                    </span>
                  )}
                  {runningCount > 0 && (
                    <span className="min-w-[16px] h-4 bg-cyan-500 text-[9px] font-bold text-black flex items-center justify-center rounded-full px-1">
                      {runningCount}
                    </span>
                  )}
                  {doneCount > 0 && (
                    <span className="min-w-[16px] h-4 bg-emerald-500/60 text-[9px] font-bold text-black flex items-center justify-center rounded-full px-1">
                      {doneCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="min-w-[16px] h-4 bg-red-500 text-[9px] font-bold text-white flex items-center justify-center rounded-full px-1">
                      {failedCount}
                    </span>
                  )}
                </span>
              )}
            </button>

            {/* Right panel toggle */}
            <button
              onClick={() => setRightCollapsed(!rightCollapsed)}
              className="p-1.5 text-white/20 hover:text-white/50 transition-colors hidden lg:flex"
              aria-label="Toggle agent panel"
            >
              {rightCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
            </button>

            <div className="w-px h-4 bg-white/[0.04]" />

            {/* Logout */}
            <button
              onClick={onLogout}
              className="p-1.5 text-white/15 hover:text-white/40 transition-colors"
              aria-label="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main 3-panel layout */}
      <main className="flex-1 flex min-h-0">
        {/* Left sidebar: Discussion list */}
        <AnimatePresence initial={false}>
          {!leftCollapsed && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 border-r border-white/[0.04] bg-[#0a0a12] overflow-hidden hidden lg:flex flex-col"
            >
              <div className="flex flex-col h-full w-[280px]">
                {/* Sidebar header */}
                <div className="shrink-0 px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
                  <span className="text-[10px] font-medium text-white/25 tracking-[0.2em] uppercase">
                    Meetings
                  </span>
                  <button
                    onClick={() => setNewMeetingOpen(true)}
                    className="flex items-center gap-1 text-[10px] text-[#d4af37]/50 hover:text-[#d4af37] transition-colors
                               tracking-wider uppercase px-2 py-1 rounded-md hover:bg-[#d4af37]/[0.04]"
                  >
                    <Plus className="w-3 h-3" />
                    New
                  </button>
                </div>

                {/* Discussion list */}
                <div className="flex-1 overflow-y-auto">
                  <DiscussionPicker
                    discussions={discussions}
                    activeId={activeDiscussion?.id ?? null}
                    loading={discussionsLoading}
                    onSelect={onSelectDiscussion}
                    onOpenNewMeeting={() => setNewMeetingOpen(true)}
                    asSidebar
                  />
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Center: Transcript */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile discussion picker (shown when sidebar is hidden) */}
          <div className="lg:hidden shrink-0 border-b border-white/[0.04] px-3 py-2 flex items-center gap-2">
            <DiscussionPicker
              discussions={discussions}
              activeId={activeDiscussion?.id ?? null}
              loading={discussionsLoading}
              onSelect={onSelectDiscussion}
              onOpenNewMeeting={() => setNewMeetingOpen(true)}
            />
            <button
              onClick={() => setNewMeetingOpen(true)}
              className="shrink-0 p-1.5 text-[#d4af37]/40 hover:text-[#d4af37] transition-colors rounded-md hover:bg-[#d4af37]/[0.04]"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {activeDiscussion ? (
            <Transcript
              messages={messages}
              typingUsers={typingUsers}
              loading={messagesLoading}
              hasMore={hasMoreMessages}
              onSendMessage={onSendMessage}
              onSendTyping={onSendTyping}
              onLoadMore={onLoadMore}
              discussionTitle={activeDiscussion.title}
              discussionTopic={activeDiscussion.topic ?? null}
            />
          ) : (
            <EmptyState onNewMeeting={() => setNewMeetingOpen(true)} agents={agents} />
          )}
        </div>

        {/* Right sidebar: Agent panel */}
        <AnimatePresence initial={false}>
          {!rightCollapsed && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 overflow-hidden hidden lg:flex"
            >
              <div className="w-[260px]">
                <AgentPanel
                  agents={agents}
                  typingUsers={typingUsers}
                  tasks={tasks}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>

      {/* Status bar */}
      <StatusBar
        connected={connected}
        agents={agents}
        tasks={tasks}
        typingUsers={typingUsers}
      />

      {/* Task panel (slide-over) */}
      <TaskPanel
        tasks={tasks}
        loading={tasksLoading}
        onApprove={onApproveTask}
        onCancel={onCancelTask}
        open={taskPanelOpen}
        onClose={() => setTaskPanelOpen(false)}
        discussionId={activeDiscussion?.id ?? null}
      />

      {/* New meeting form modal */}
      <NewMeetingForm
        open={newMeetingOpen}
        onClose={() => setNewMeetingOpen(false)}
        onCreate={onCreateDiscussion}
      />
    </div>
  );
}

// Empty state when no discussion is selected
function EmptyState({ onNewMeeting, agents }: { onNewMeeting: () => void; agents: Agent[] }) {
  const onlineAgents = agents.filter((a) => a.status === 'online');

  return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-sm w-full px-6 text-center"
      >
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <div className="grid grid-cols-3 gap-1.5">
            {agents.slice(0, 3).map((agent) => (
              <div
                key={agent.id}
                className={`w-3 h-3 rounded-full ${
                  agent.status === 'online' ? 'animate-pulse' : 'opacity-30'
                }`}
                style={{
                  backgroundColor: agent.id === 'asus' ? '#4ade80' : agent.id === 'water' ? '#a78bfa' : '#fb923c',
                  opacity: agent.status === 'online' ? 0.6 : 0.15,
                }}
              />
            ))}
          </div>
        </div>

        <h2 className="text-sm font-medium text-white/50 mb-1.5">
          No active meeting
        </h2>
        <p className="text-[12px] text-white/20 mb-6 leading-relaxed">
          {onlineAgents.length > 0
            ? `${onlineAgents.length} agent${onlineAgents.length > 1 ? 's' : ''} online and ready`
            : 'Waiting for agents to connect'}
        </p>

        <button
          onClick={onNewMeeting}
          className="group w-full flex items-center justify-center gap-2 border border-[#d4af37]/20 bg-[#d4af37]/[0.04] px-5 py-3
                     text-[11px] font-medium text-[#d4af37]/80 tracking-[0.15em] uppercase rounded-lg
                     hover:bg-[#d4af37]/[0.08] hover:border-[#d4af37]/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.04)]
                     transition-all duration-300"
        >
          <Plus className="w-3.5 h-3.5" />
          New Board Meeting
        </button>
      </motion.div>
    </div>
  );
}
