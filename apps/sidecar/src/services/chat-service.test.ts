import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { type ChatMessage, type LlmRequest, type RpcNotificationMap } from '@itstudio/schemas';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { EventBus } from '../rpc/event-bus.js';
import type { IChatRepository } from '../ports/chat-repository.js';
import { chatMessageSchema, conversationSchema } from '../validation/chat.js';
import { conversationIdSchema, isoDateTimeSchema, messageIdSchema, projectIdSchema } from '../validation/brand.js';
import { ChatService } from './chat-service.js';
import { microUsd } from '../domain/money.js';
import { vndSchema } from '../validation/brand.js';

const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const conversationId = conversationIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const now = isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z');
const conversation = conversationSchema.parse({
  id: conversationId,
  projectId,
  title: 'New chat',
  ragEnabled: false,
  createdAt: now,
  updatedAt: now,
});
const created: ChatMessage[] = [];
const updatedTitles: string[] = [];
let capturedRequest: LlmRequest | undefined;
let removeListeners: (() => void) | undefined;

function makeService() {
  const repository: IChatRepository = {
    listConversations: () => Promise.resolve([conversation]),
    getConversation: () => Promise.resolve(conversation),
    createConversation: () => Promise.resolve(),
    updateTitle: (_id, title) => {
      updatedTitles.push(title);
      return Promise.resolve();
    },
    listMessages: () => Promise.resolve([...created]),
    createMessage: (message) => {
      created.push(message);
      return Promise.resolve();
    },
  };
  const assistant = chatMessageSchema.parse({
    id: messageIdSchema.parse('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    conversationId,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hello back' }],
    modelKey: 'openai/test-model',
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    createdAt: now,
  });
  const events = new EventBus<RpcNotificationMap>();
  removeListeners = events.subscribe('chat.completed', () => undefined);
  const service = new ChatService({
    repository,
    router: {
      dispatch: (request, options) => {
        capturedRequest = request;
        options?.onDelta?.('Hello');
        return Promise.resolve({
          ok: true,
          value: {
            requestId: request.id,
            modelKey: 'openai/test-model',
            message: assistant,
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
            costMicroUsd: microUsd(0),
            finishReason: 'stop',
            attempts: [],
            latencyMs: 1,
          },
        });
      },
    },
    ledger: {
      trackRequest: () => undefined,
      forgetRequest: () => undefined,
      recordedCost: () =>
        Promise.resolve({
          microUsd: microUsd(0),
          vnd: vndSchema.parse(0),
          usdText: '$0.00',
          vndText: '0 â‚«',
          fxAsOf: now,
        }),
    },
    events,
    ids: {
      uuid: (() => {
        const values = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
        return () => values.shift() ?? 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      })(),
    },
    clock: createFakeClock(new Date(now)),
    logger: createLogger({ streams: [new PassThrough()] }),
  });
  return { service, events };
}

afterEach(() => {
  created.length = 0;
  updatedTitles.length = 0;
  capturedRequest = undefined;
  removeListeners?.();
});

describe('ChatService', () => {
  it('persists the user turn before returning, streams deltas, builds chat context, and auto-titles on completion', async () => {
    const { service, events } = makeService();
    const deltas: string[] = [];
    let complete: (() => void) | undefined;
    events.subscribe('chat.delta', ({ textDelta }) => deltas.push(textDelta));
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    events.subscribe('chat.completed', () => complete?.());
    const sent = await service.send(conversationId, 'First message');
    expect(sent.ok).toBe(true);
    expect(created[0]?.role).toBe('user');
    await completed;
    expect(deltas).toEqual(['Hello']);
    expect(capturedRequest?.purpose).toBe('chat');
    expect(capturedRequest?.stream).toBe(true);
    expect(typeof capturedRequest?.systemPrompt).toBe('string');
    expect(capturedRequest?.messages).toHaveLength(1);
    expect(updatedTitles).toEqual(['First message']);
    expect(created.map((message) => message.role)).toEqual(['user', 'assistant']);
  });
});
