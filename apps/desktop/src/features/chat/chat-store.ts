import type { AppError, ChatMessage, LlmRequestId, ModelKey, MoneyDisplay, RouterEvent } from '@itstudio/schemas';

export interface FallbackInfo {
  readonly from: ModelKey;
  readonly to: ModelKey;
  readonly reason: string;
}

export type ChatBubble =
  | { readonly kind: 'message'; readonly message: ChatMessage; readonly requestId?: LlmRequestId }
  | { readonly kind: 'stream'; readonly requestId: LlmRequestId; readonly text: string }
  | { readonly kind: 'failed'; readonly requestId: LlmRequestId; readonly error: AppError };

export interface ChatState {
  readonly bubbles: readonly ChatBubble[];
  readonly costs: Readonly<Record<string, MoneyDisplay>>;
  readonly fallbacks: Readonly<Record<string, FallbackInfo>>;
  readonly completedRequests: readonly LlmRequestId[];
}

export type ChatEvent =
  | { readonly type: 'load'; readonly messages: readonly ChatMessage[] }
  | { readonly type: 'optimistic'; readonly message: ChatMessage }
  | { readonly type: 'stream'; readonly requestId: LlmRequestId }
  | { readonly type: 'delta'; readonly requestId: LlmRequestId; readonly text: string }
  | { readonly type: 'router'; readonly event: RouterEvent }
  | {
      readonly type: 'completed';
      readonly requestId: LlmRequestId;
      readonly message: ChatMessage;
      readonly cost: MoneyDisplay;
    }
  | { readonly type: 'failed'; readonly requestId: LlmRequestId; readonly error: AppError };

export const initialChatState: ChatState = { bubbles: [], costs: {}, fallbacks: {}, completedRequests: [] };

function isCompleted(state: ChatState, requestId: LlmRequestId): boolean {
  return state.completedRequests.includes(requestId);
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'load':
      return { ...initialChatState, bubbles: event.messages.map((message) => ({ kind: 'message', message })) };
    case 'optimistic':
      return { ...state, bubbles: [...state.bubbles, { kind: 'message', message: event.message }] };
    case 'stream':
      return { ...state, bubbles: [...state.bubbles, { kind: 'stream', requestId: event.requestId, text: '' }] };
    case 'delta': {
      if (isCompleted(state, event.requestId)) return state;
      const index = state.bubbles.findIndex(
        (bubble) => bubble.kind === 'stream' && bubble.requestId === event.requestId,
      );
      if (index === -1) return state;
      const bubbles = state.bubbles.map((bubble) => {
        if (bubble.kind !== 'stream' || bubble.requestId !== event.requestId) return bubble;
        return { ...bubble, text: bubble.text + event.text };
      });
      return { ...state, bubbles };
    }
    case 'router': {
      const routerEvent = event.event;
      if (routerEvent.type !== 'fallback') return state;
      if (isCompleted(state, routerEvent.requestId)) return state;
      const index = state.bubbles.findIndex(
        (bubble) => bubble.kind === 'stream' && bubble.requestId === routerEvent.requestId,
      );
      if (index === -1) return state;
      const bubbles = state.bubbles.map((bubble) => {
        if (bubble.kind !== 'stream' || bubble.requestId !== routerEvent.requestId) return bubble;
        return { ...bubble, text: '' };
      });
      return {
        ...state,
        bubbles,
        fallbacks: {
          ...state.fallbacks,
          [routerEvent.requestId]: { from: routerEvent.from, to: routerEvent.to, reason: routerEvent.reason },
        },
      };
    }
    case 'completed': {
      if (isCompleted(state, event.requestId)) return state;
      const bubbles = state.bubbles.map((bubble) =>
        bubble.kind === 'stream' && bubble.requestId === event.requestId
          ? { kind: 'message' as const, message: event.message, requestId: event.requestId }
          : bubble,
      );
      return {
        ...state,
        bubbles,
        costs: { ...state.costs, [event.requestId]: event.cost },
        completedRequests: [...state.completedRequests, event.requestId],
      };
    }
    case 'failed': {
      if (isCompleted(state, event.requestId)) return state;
      const index = state.bubbles.findIndex(
        (bubble) => bubble.kind === 'stream' && bubble.requestId === event.requestId,
      );
      if (index === -1) return state;
      const bubbles = state.bubbles.map((bubble) =>
        bubble.kind === 'stream' && bubble.requestId === event.requestId
          ? { kind: 'failed' as const, requestId: event.requestId, error: event.error }
          : bubble,
      );
      return { ...state, bubbles };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
