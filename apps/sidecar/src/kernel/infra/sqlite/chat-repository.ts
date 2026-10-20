import { asc, eq } from 'drizzle-orm';
import type { ChatMessage, Conversation, ConversationId, ProjectId } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { conversations, messages } from './schema.js';
import type { IChatRepository } from '../../ports/chat-repository.js';
import { chatMessageSchema, conversationSchema } from '../../validation/chat.js';

export class ChatRepository implements IChatRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  listConversations(projectId: ProjectId): Promise<readonly Conversation[]> {
    return Promise.resolve(
      this.db.select().from(conversations).where(eq(conversations.projectId, projectId)).all().map(toConversation),
    );
  }

  getConversation(id: ConversationId): Promise<Conversation | null> {
    const row = this.db.select().from(conversations).where(eq(conversations.id, id)).get();
    return Promise.resolve(row === undefined ? null : toConversation(row));
  }

  createConversation(conversation: Conversation): Promise<void> {
    this.db
      .insert(conversations)
      .values({
        id: conversation.id,
        projectId: conversation.projectId,
        title: conversation.title,
        ragEnabled: conversation.ragEnabled ? 1 : 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      .run();
    return Promise.resolve();
  }

  updateTitle(id: ConversationId, title: string, updatedAt: Conversation['updatedAt']): Promise<void> {
    this.db.update(conversations).set({ title, updatedAt }).where(eq(conversations.id, id)).run();
    return Promise.resolve();
  }

  setRagEnabled(id: ConversationId, ragEnabled: boolean, updatedAt: Conversation['updatedAt']): Promise<void> {
    this.db
      .update(conversations)
      .set({ ragEnabled: ragEnabled ? 1 : 0, updatedAt })
      .where(eq(conversations.id, id))
      .run();
    return Promise.resolve();
  }

  listMessages(id: ConversationId): Promise<readonly ChatMessage[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt))
        .all()
        .map(toMessage),
    );
  }

  createMessage(message: ChatMessage): Promise<void> {
    this.db
      .insert(messages)
      .values({
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        partsJson: JSON.stringify(message.parts),
        modelKey: message.modelKey ?? null,
        usageJson: message.usage === undefined ? null : JSON.stringify(message.usage),
        createdAt: message.createdAt,
      })
      .run();
    return Promise.resolve();
  }
}

function toConversation(row: typeof conversations.$inferSelect): Conversation {
  return conversationSchema.parse({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    ragEnabled: row.ragEnabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function parseStoredJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error(`Stored chat ${field} JSON is invalid`, { cause });
  }
}

function toMessage(row: typeof messages.$inferSelect): ChatMessage {
  return chatMessageSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    parts: parseStoredJson(row.partsJson, 'parts'),
    ...(row.modelKey === null ? {} : { modelKey: row.modelKey }),
    ...(row.usageJson === null ? {} : { usage: parseStoredJson(row.usageJson, 'usage') }),
    createdAt: row.createdAt,
  });
}
