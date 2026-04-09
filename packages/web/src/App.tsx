import { useState, useEffect, useCallback } from 'react';
import { isAuthenticated, logout as doLogout } from './lib/auth';
import { useWebSocket } from './hooks/useWebSocket';
import { useDiscussion, useDiscussionList } from './hooks/useDiscussion';
import { useTasks } from './hooks/useTasks';
import { useAgents } from './hooks/useAgents';
import { LoginForm } from './components/LoginForm';
import { Layout } from './components/Layout';
import { Notifications } from './components/Notifications';
import type { Discussion } from './types';

export function App() {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(
    () => localStorage.getItem('boardroom_active_discussion'),
  );
  const [activeDiscussion, setActiveDiscussion] = useState<Discussion | null>(null);

  // Only mount hooks after auth
  if (!authed) {
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  return (
    <AuthedApp
      activeDiscussionId={activeDiscussionId}
      activeDiscussion={activeDiscussion}
      setActiveDiscussionId={setActiveDiscussionId}
      setActiveDiscussion={setActiveDiscussion}
      onLogout={() => {
        doLogout();
        setAuthed(false);
      }}
    />
  );
}

interface AuthedAppProps {
  activeDiscussionId: string | null;
  activeDiscussion: Discussion | null;
  setActiveDiscussionId: (id: string | null) => void;
  setActiveDiscussion: (d: Discussion | null) => void;
  onLogout: () => void;
}

function AuthedApp({
  activeDiscussionId,
  activeDiscussion,
  setActiveDiscussionId,
  setActiveDiscussion,
  onLogout,
}: AuthedAppProps) {
  const { connected } = useWebSocket();
  const { discussions, loading: discussionsLoading, create: createDiscussion } = useDiscussionList();
  const {
    messages,
    loading: messagesLoading,
    hasMore,
    typingUsers,
    sendMessage,
    sendTyping,
    loadMore,
  } = useDiscussion(activeDiscussionId);
  const { tasks, loading: tasksLoading, approve, cancel } = useTasks(activeDiscussionId);
  const { agents } = useAgents();

  // Keep activeDiscussion in sync
  useEffect(() => {
    if (activeDiscussionId) {
      const found = discussions.find((d) => d.id === activeDiscussionId) ?? null;
      setActiveDiscussion(found);
    } else {
      setActiveDiscussion(null);
    }
  }, [activeDiscussionId, discussions, setActiveDiscussion]);

  const handleSelectDiscussion = useCallback(
    (id: string) => {
      setActiveDiscussionId(id);
      localStorage.setItem('boardroom_active_discussion', id);
    },
    [setActiveDiscussionId],
  );

  const handleCreateDiscussion = useCallback(
    async (title: string, topic?: string, extra?: { objective?: string; background?: string; keyQuestion?: string; constraints?: string }) => {
      const id = await createDiscussion(title, topic, extra);
      setActiveDiscussionId(id);
      localStorage.setItem('boardroom_active_discussion', id);
      return id;
    },
    [createDiscussion, setActiveDiscussionId],
  );

  return (
    <>
      <Layout
        discussions={discussions}
        discussionsLoading={discussionsLoading}
        connected={connected}
        onSelectDiscussion={handleSelectDiscussion}
        onCreateDiscussion={handleCreateDiscussion}
        onLogout={onLogout}
        activeDiscussion={activeDiscussion}
        messages={messages}
        messagesLoading={messagesLoading}
        hasMoreMessages={hasMore}
        typingUsers={typingUsers}
        onSendMessage={sendMessage}
        onSendTyping={sendTyping}
        onLoadMore={loadMore}
        agents={agents}
        tasks={tasks}
        tasksLoading={tasksLoading}
        onApproveTask={approve}
        onCancelTask={cancel}
      />
      <Notifications />
    </>
  );
}
