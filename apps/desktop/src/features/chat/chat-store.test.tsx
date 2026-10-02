import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  ConversationId,
  IsoDateTime,
  LlmRequestId,
  MessageId,
  MicroUsd,
  ModelKey,
  Vnd,
} from '@itstudio/schemas';
import { chatReducer, initialChatState } from './chat-store';

function requestIdFixture(value: string): LlmRequestId {
  return value as LlmRequestId;
}
function conversationIdFixture(value: string): ConversationId {
  return value as ConversationId;
}
function dateFixture(value: string): IsoDateTime {
  return value as IsoDateTime;
}
function modelFixture(value: string): ModelKey {
  return value as ModelKey;
}
function messageIdFixture(value: string): MessageId {
  return value as MessageId;
}

const requestId = requestIdFixture('00000000-0000-4000-8000-000000000001');
const otherRequest = requestIdFixture('00000000-0000-4000-8000-000000000004');
const conversationId = conversationIdFixture('00000000-0000-4000-8000-000000000002');
const date = dateFixture('2026-10-02T00:00:00.000Z');
const firstModel = modelFixture('openai/first');
const secondModel = modelFixture('anthropic/second');
const message: ChatMessage = {
  id: messageIdFixture('00000000-0000-4000-8000-000000000003'),
  conversationId,
  role: 'assistant',
  parts: [{ type: 'text', text: 'final' }],
  modelKey: modelFixture('openai/model'),
  createdAt: date,
};
const cost = { microUsd: 1 as MicroUsd, vnd: 1 as Vnd, usdText: '$0.0000', vndText: '1 ₫', fxAsOf: date };

describe('chatReducer', () => {
  it('loads messages and appends optimistic messages and streams', () => {
    const loaded = chatReducer(initialChatState, { type: 'load', messages: [message] });
    const streamed = chatReducer(chatReducer(loaded, { type: 'stream', requestId }), {
      type: 'delta',
      requestId,
      text: 'partial',
    });
    expect(streamed.bubbles.at(-1)).toMatchObject({ kind: 'stream', text: 'partial' });
    expect(chatReducer(streamed, { type: 'optimistic', message }).bubbles).toHaveLength(3);
  });

  it('ignores unknown ids and resets partial text on fallback', () => {
    const loaded = chatReducer(initialChatState, { type: 'load', messages: [message] });
    const stream = chatReducer(loaded, { type: 'stream', requestId });
    expect(chatReducer(stream, { type: 'delta', requestId: otherRequest, text: 'ignored' })).toBe(stream);
    const partial = chatReducer(stream, { type: 'delta', requestId, text: 'partial' });
    const fallback = chatReducer(partial, {
      type: 'router',
      event: { type: 'fallback', requestId, from: firstModel, to: secondModel, reason: 'rate_limited' },
    });
    expect(fallback.bubbles.at(-1)).toMatchObject({ kind: 'stream', text: '' });
    expect(fallback.fallbacks[requestId]).toMatchObject({ from: firstModel, to: secondModel, reason: 'rate_limited' });
    expect(
      chatReducer(stream, {
        type: 'router',
        event: { type: 'fallback', requestId: otherRequest, from: firstModel, to: secondModel, reason: 'timeout' },
      }),
    ).toBe(stream);
    expect(
      chatReducer(stream, { type: 'router', event: { type: 'circuit', modelKey: firstModel, status: 'open' } }),
    ).toBe(stream);
  });

  it('completes once and ignores events after completion', () => {
    const stream = chatReducer(chatReducer(initialChatState, { type: 'load', messages: [message] }), {
      type: 'stream',
      requestId,
    });
    const done = chatReducer(stream, { type: 'completed', requestId, message, cost });
    expect(done.bubbles.at(-1)).toMatchObject({ kind: 'message', message });
    expect(done.costs[requestId]).toEqual(cost);
    expect(chatReducer(done, { type: 'delta', requestId, text: 'late' })).toBe(done);
    expect(
      chatReducer(done, {
        type: 'router',
        event: { type: 'fallback', requestId, from: firstModel, to: secondModel, reason: 'timeout' },
      }),
    ).toBe(done);
    expect(chatReducer(done, { type: 'completed', requestId, message, cost })).toBe(done);
    expect(
      chatReducer(done, { type: 'failed', requestId, error: { code: 'INTERNAL', message: 'late', retryable: false } }),
    ).toBe(done);
  });

  it('marks a stream failed and ignores failures for unknown ids', () => {
    const stream = chatReducer(chatReducer(initialChatState, { type: 'load', messages: [message] }), {
      type: 'stream',
      requestId,
    });
    const error = { code: 'INTERNAL', message: 'failed', retryable: true, remediation: ['Try again.'] } as const;
    expect(chatReducer(stream, { type: 'failed', requestId, error }).bubbles.at(-1)).toMatchObject({
      kind: 'failed',
      error,
    });
    expect(chatReducer(initialChatState, { type: 'failed', requestId, error })).toBe(initialChatState);
  });

  it('keeps the exhaustive guard active for invalid runtime events', () => {
    const invalidEvent = { type: 'invalid' };
    // @ts-expect-error Intentionally supply an invalid event to exercise the runtime exhaustive guard.
    const result = chatReducer(initialChatState, invalidEvent);
    expect(result).toEqual(invalidEvent);
  });
});
