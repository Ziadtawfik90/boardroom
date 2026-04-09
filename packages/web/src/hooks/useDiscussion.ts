import { useState, useEffect, useCallback, useRef } from 'react';
import { ws } from '../lib/ws';
import * as api from '../lib/api';
import type {
  Discussion,
  Message,
  Sender,
  MessageNewPayload,
  TypingIndicatorPayload,
  DiscussionCreatedPayload,
} from '../types';

export function useDiscussion(discussionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<Sender>>(new Set());
  const typingTimers = useRef<Map<Sender, ReturnType<typeof setTimeout>>>(new Map());

  // Load messages when discussion changes
  useEffect(() => {
    if (!discussionId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api.fetchMessages(discussionId).then((data) => {
      if (!cancelled) {
        setMessages(data.messages);
        setHasMore(data.hasMore);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [discussionId]);

  // Listen for new messages
  useEffect(() => {
    if (!discussionId) return;

    const offNew = ws.on('message.new', (env) => {
      const payload = env.payload as MessageNewPayload;
      if (payload.discussionId === discussionId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.message.id)) return prev;
          return [...prev, payload.message];
        });
      }
    });

    const offTyping = ws.on('message.typing.indicator', (env) => {
      const payload = env.payload as TypingIndicatorPayload;
      if (payload.discussionId !== discussionId) return;

      setTypingUsers((prev) => new Set(prev).add(payload.sender));

      // Clear after 3s
      const existing = typingTimers.current.get(payload.sender);
      if (existing) clearTimeout(existing);
      typingTimers.current.set(
        payload.sender,
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(payload.sender);
            return next;
          });
        }, 3000),
      );
    });

    return () => {
      offNew();
      offTyping();
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
    };
  }, [discussionId]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!discussionId) return;
      ws.send('message.send', { discussionId, content });
    },
    [discussionId],
  );

  const sendTyping = useCallback(() => {
    if (!discussionId) return;
    ws.send('message.typing', { discussionId });
  }, [discussionId]);

  const loadMore = useCallback(async () => {
    if (!discussionId || !hasMore || loading || messages.length === 0) return;
    const oldest = messages[0];
    setLoading(true);
    try {
      const data = await api.fetchMessages(discussionId, 50, oldest.id);
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [discussionId, hasMore, loading, messages]);

  return { messages, loading, hasMore, typingUsers, sendMessage, sendTyping, loadMore };
}

export function useDiscussionList() {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchDiscussions();
      setDiscussions(data.discussions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    const offCreated = ws.on('discussion.created', (env) => {
      const payload = env.payload as DiscussionCreatedPayload;
      const disc: Discussion = {
        ...payload.discussion,
        status: 'active',
        createdAt: env.timestamp,
        updatedAt: env.timestamp,
        closedAt: null,
      };
      setDiscussions((prev) => {
        if (prev.some((d) => d.id === disc.id)) return prev;
        return [disc, ...prev];
      });
    });

    const offClosed = ws.on('discussion.closed', (env) => {
      const { discussionId } = env.payload as { discussionId: string };
      setDiscussions((prev) =>
        prev.map((d) => (d.id === discussionId ? { ...d, status: 'closed' as const } : d)),
      );
    });

    return () => {
      offCreated();
      offClosed();
    };
  }, [load]);

  const create = useCallback(async (title: string, topic?: string, extra?: { objective?: string; background?: string; keyQuestion?: string; constraints?: string }) => {
    const result = await api.createDiscussion(title, topic, extra);
    return result.id;
  }, []);

  return { discussions, loading, create, refresh: load };
}
