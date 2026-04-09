import { v4 as uuidv4 } from 'uuid';
import type { Discussion, Message, Sender, MessageType } from '../../../shared/src/types.js';
import type { Queries } from '../db/queries.js';

export class DiscussionManager {
  constructor(private queries: Queries) {}

  create(title: string, topic: string | null, createdBy: Sender): Discussion {
    const id = uuidv4();
    return this.queries.insertDiscussion(id, title, topic, createdBy);
  }

  get(id: string): Discussion | null {
    return this.queries.getDiscussion(id);
  }

  getWithMessages(id: string): { discussion: Discussion; messages: Message[] } | null {
    const discussion = this.queries.getDiscussion(id);
    if (!discussion) return null;

    const messages = this.queries.getMessages(id);
    return { discussion, messages };
  }

  addMessage(
    discussionId: string,
    sender: Sender,
    content: string,
    type: MessageType = 'message',
    parentId: string | null = null,
    metadata: Record<string, unknown> | null = null,
  ): Message {
    const id = uuidv4();
    return this.queries.insertMessage(id, discussionId, sender, content, type, parentId, metadata);
  }

  close(id: string): void {
    this.queries.updateDiscussionStatus(id, 'closed');
  }

  archive(id: string): void {
    this.queries.updateDiscussionStatus(id, 'archived');
  }
}
