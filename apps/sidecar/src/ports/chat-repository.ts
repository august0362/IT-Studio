import type { ChatMessage, Conversation, ConversationId, ProjectId } from '@itstudio/schemas';

export interface IChatRepository {
  listConversations(projectId: ProjectId): Promise<readonly Conversation[]>;
  getConversation(id: ConversationId): Promise<Conversation | null>;
  createConversation(conversation: Conversation): Promise<void>;
  updateTitle(id: ConversationId, title: string, updatedAt: Conversation['updatedAt']): Promise<void>;
  listMessages(id: ConversationId): Promise<readonly ChatMessage[]>;
  createMessage(message: ChatMessage): Promise<void>;
}
