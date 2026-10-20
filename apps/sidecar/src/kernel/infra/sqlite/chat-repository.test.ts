import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { ChatRepository } from './chat-repository.js';
import { ProjectRepository } from './project-repository.js';
import { projectIdSchema, conversationIdSchema, messageIdSchema, isoDateTimeSchema } from '../../validation/brand.js';
import { projectSchema } from '../../validation/projects.js';
import { chatMessageSchema, conversationSchema } from '../../validation/chat.js';

const database = openDatabase(':memory:');
afterEach(() => database.client.exec('DELETE FROM projects'));

describe('ChatRepository', () => {
  it('round trips conversations and messages, and rejects invalid stored JSON', async () => {
    const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const conversationId = conversationIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const messageId = messageIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const now = isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z');
    const projects = new ProjectRepository(database.db);
    await projects.create(
      projectSchema.parse({ id: projectId, name: 'Test', workspaceRoot: 'C:/test', createdAt: now, archived: false }),
    );
    const repository = new ChatRepository(database.db);
    const conversation = conversationSchema.parse({
      id: conversationId,
      projectId,
      title: 'New chat',
      ragEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createConversation(conversation);
    const message = chatMessageSchema.parse({
      id: messageId,
      conversationId,
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: now,
    });
    await repository.createMessage(message);
    expect(await repository.listConversations(projectId)).toEqual([conversation]);
    expect(await repository.listMessages(conversationId)).toEqual([message]);
    database.client.prepare('UPDATE messages SET parts_json = ? WHERE id = ?').run('{bad', messageId);
    expect(() => repository.listMessages(conversationId)).toThrow('Stored chat parts JSON is invalid');
  });
});
