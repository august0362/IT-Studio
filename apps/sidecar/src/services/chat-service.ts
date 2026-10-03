import {
  ErrorCode,
  ModelCapability,
  type AppError,
  type ChatMessage,
  type Conversation,
  type ConversationId,
  type LlmRequest,
  type LlmRequestId,
  type ModelKey,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IChatRepository } from '../ports/chat-repository.js';
import type { RetrievalHit } from '@itstudio/schemas';
import type { Retriever } from './rag/retriever.js';
import type { SettingsService } from './settings-service.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { RpcNotificationMap } from '@itstudio/schemas';
import type { LlmRouter } from './llm-router.js';
import type { LedgerService } from './ledger-service.js';
import type { Logger } from 'pino';
import { estimateTokens } from '../domain/token-estimate.js';
import { chatMessageSchema, conversationSchema } from '../validation/chat.js';
import { isoDateTimeSchema, llmRequestIdSchema } from '../validation/brand.js';
import { renderTemplate } from '../domain/template.js';

const CHAT_TEMPLATE = `You are IT Studio's assistant. Be concise and accurate.
{{#rag}}Use the numbered knowledge blocks when relevant and cite them as [n]. If they do not contain the answer, say so before answering from general knowledge.
<context name="knowledge">{{numberedHits}}</context>{{/rag}}
{{#tools}}You may call tools: {{toolNames}}. Call generate_image only when the user asks for an image.{{/tools}}`;

const HISTORY_TOKEN_LIMIT = 12_000;
const HISTORY_MESSAGE_LIMIT = 20;

export interface ChatServiceDependencies {
  readonly repository: IChatRepository & {
    setRagEnabled(id: ConversationId, enabled: boolean, updatedAt: Conversation['updatedAt']): Promise<void>;
  };
  readonly router: Pick<LlmRouter, 'dispatch'>;
  readonly ledger: Pick<LedgerService, 'trackRequest' | 'recordedCost' | 'forgetRequest'>;
  readonly events: EventBus<RpcNotificationMap>;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: Logger;
  readonly retriever?: Pick<Retriever, 'query'>;
  readonly settings?: Pick<SettingsService, 'get'>;
}

export class ChatService {
  private readonly deps: ChatServiceDependencies;
  private readonly inFlight = new Map<
    LlmRequestId,
    { readonly conversationId: ConversationId; readonly controller: AbortController }
  >();
  private readonly busyConversations = new Set<ConversationId>();

  constructor(dependencies: ChatServiceDependencies) {
    this.deps = dependencies;
  }

  async listConversations(projectId: ProjectId): Promise<Result<readonly Conversation[]>> {
    return { ok: true, value: await this.deps.repository.listConversations(projectId) };
  }

  async createConversation(projectId: ProjectId, title = 'New chat'): Promise<Result<Conversation>> {
    const now = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    const conversation = conversationSchema.parse({
      id: this.deps.ids.uuid(),
      projectId,
      title,
      ragEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.repository.createConversation(conversation);
    return { ok: true, value: conversation };
  }

  async getMessages(conversationId: ConversationId): Promise<Result<readonly ChatMessage[]>> {
    const conversation = await this.deps.repository.getConversation(conversationId);
    if (conversation === null)
      return fail(ErrorCode.NOT_FOUND, 'Conversation was not found.', ['Choose an existing conversation.']);
    return { ok: true, value: await this.deps.repository.listMessages(conversationId) };
  }

  async setRagEnabled(conversationId: ConversationId, enabled: boolean): Promise<Result<Conversation>> {
    const conversation = await this.deps.repository.getConversation(conversationId);
    if (conversation === null)
      return fail(ErrorCode.NOT_FOUND, 'Conversation was not found.', ['Choose an existing conversation.']);
    const updatedAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    await this.deps.repository.setRagEnabled(conversationId, enabled, updatedAt);
    return { ok: true, value: conversationSchema.parse({ ...conversation, ragEnabled: enabled, updatedAt }) };
  }

  async send(
    conversationId: ConversationId,
    text: string,
    modelOverride?: ModelKey,
  ): Promise<Result<{ readonly requestId: LlmRequestId; readonly userMessageId: ChatMessage['id'] }>> {
    const conversation = await this.deps.repository.getConversation(conversationId);
    if (conversation === null)
      return fail(ErrorCode.NOT_FOUND, 'Conversation was not found.', ['Choose an existing conversation.']);
    if (this.busyConversations.has(conversationId))
      return fail(ErrorCode.CONFLICT, 'This conversation already has a response in progress.', [
        'Wait for the current response to finish.',
      ]);
    this.busyConversations.add(conversationId);
    const createdAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    const userMessage = chatMessageSchema.parse({
      id: this.deps.ids.uuid(),
      conversationId,
      role: 'user',
      parts: [{ type: 'text', text }],
      createdAt,
    });
    const requestId = llmRequestIdSchema.parse(this.deps.ids.uuid());
    const controller = new AbortController();
    try {
      await this.deps.repository.createMessage(userMessage);
      this.inFlight.set(requestId, { conversationId, controller });
      void this.run(requestId, conversation, modelOverride, controller);
      return { ok: true, value: { requestId, userMessageId: userMessage.id } };
    } catch (error) {
      this.busyConversations.delete(conversationId);
      this.inFlight.delete(requestId);
      throw error;
    }
  }

  cancel(requestId: LlmRequestId): Promise<Result<{ readonly cancelled: boolean }>> {
    const active = this.inFlight.get(requestId);
    if (active === undefined) return Promise.resolve({ ok: true, value: { cancelled: false } });
    active.controller.abort();
    return Promise.resolve({ ok: true, value: { cancelled: true } });
  }

  private async run(
    requestId: LlmRequestId,
    conversation: Conversation,
    modelOverride: ModelKey | undefined,
    controller: AbortController,
  ): Promise<void> {
    try {
      const history = await this.deps.repository.listMessages(conversation.id);
      let hits: readonly RetrievalHit[] = [];
      if (conversation.ragEnabled && this.deps.retriever !== undefined && this.deps.settings !== undefined) {
        const configured = await this.deps.settings.get();
        const retrieval = configured.ok
          ? await this.deps.retriever.query({
              projectId: conversation.projectId,
              query: lastUserText(history),
              topK: configured.value.rag.defaultTopK,
              minScore: configured.value.rag.minScore,
            })
          : configured;
        if (retrieval.ok) hits = retrieval.value;
        else if (retrieval.error.code === ErrorCode.BUDGET_HARD_STOP) {
          this.deps.events.publish('chat.failed', { requestId, error: retrieval.error });
          return;
        } else {
          this.deps.logger.warn(
            {
              requestId,
              conversationId: conversation.id,
              projectId: conversation.projectId,
              error: retrieval.error.message,
            },
            'Chat RAG retrieval failed; continuing without knowledge context',
          );
        }
      }
      const systemPrompt = renderTemplate(CHAT_TEMPLATE, {
        rag: hits.length > 0,
        numberedHits: formatHits(hits),
        tools: false,
        toolNames: '',
      });
      const request: LlmRequest = {
        id: requestId,
        projectId: conversation.projectId,
        purpose: 'chat',
        messages: selectHistory(history),
        systemPrompt,
        requiredCapabilities: [ModelCapability.CHAT],
        stream: true,
        ...(modelOverride === undefined ? {} : { preferredModelKey: modelOverride }),
      };
      this.deps.ledger.trackRequest(request);
      const result = await this.deps.router.dispatch(request, {
        signal: controller.signal,
        onDelta: (textDelta) => {
          this.deps.events.publish('chat.delta', { requestId, textDelta });
        },
      });
      if (!result.ok) {
        this.deps.events.publish('chat.failed', { requestId, error: result.error });
        return;
      }
      const message = addCitations(result.value.message, hits);
      await this.deps.repository.createMessage(message);
      const firstUser = history.find((message) => message.role === 'user');
      if (conversation.title === 'New chat' && firstUser !== undefined) {
        const firstText = firstUser.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(' ');
        await this.deps.repository.updateTitle(
          conversation.id,
          firstText.slice(0, 60),
          isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
        );
      }
      const cost = await this.deps.ledger.recordedCost(requestId);
      if (cost === undefined) throw new Error('Completed request has no ledger cost');
      this.deps.events.publish('chat.completed', {
        requestId,
        message,
        cost,
      });
    } catch (error) {
      this.deps.logger.error({ requestId, conversationId: conversation.id, err: error }, 'Chat request failed');
      const chatError: AppError = {
        code: ErrorCode.INTERNAL,
        message: 'The chat response could not be completed.',
        retryable: true,
        remediation: ['Try sending your message again.'],
      };
      this.deps.events.publish('chat.failed', { requestId, error: chatError });
    } finally {
      this.deps.ledger.forgetRequest(requestId);
      this.inFlight.delete(requestId);
      this.busyConversations.delete(conversation.id);
    }
  }
}

function selectHistory(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  const candidates = messages.filter((message) => message.role !== 'system').slice(-HISTORY_MESSAGE_LIMIT);
  const selected: ChatMessage[] = [];
  let tokens = 0;
  for (const message of [...candidates].reverse()) {
    const messageTokens = message.parts.reduce(
      (sum, part) => sum + (part.type === 'text' ? estimateTokens(part.text) : 0),
      0,
    );
    if (selected.length > 0 && tokens + messageTokens > HISTORY_TOKEN_LIMIT) continue;
    selected.push(message);
    tokens += messageTokens;
  }
  return selected.reverse();
}

function lastUserText(messages: readonly ChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === 'user');
  return (
    message?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? ''
  );
}

function formatHits(hits: readonly RetrievalHit[]): string {
  return hits
    .map((hit, index) => {
      const section = hit.sectionPath.join(' › ');
      const title = section.length === 0 ? hit.documentTitle : `${hit.documentTitle} › ${section}`;
      return `[${String(index + 1)}] ${neutralize(title)}\n${neutralize(hit.text)}`;
    })
    .join('\n\n');
}

function neutralize(text: string): string {
  return text.replace(/<\/context>/giu, (match) => `<\\/${match.slice(2)}`);
}

function addCitations(message: ChatMessage, hits: readonly RetrievalHit[]): ChatMessage {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const cited = new Set<number>();
  const citations: RetrievalHit[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/gu)) {
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1 || index > hits.length || cited.has(index)) continue;
    const hit = hits[index - 1];
    if (hit !== undefined) {
      cited.add(index);
      citations.push(hit);
    }
  }
  return chatMessageSchema.parse({
    ...message,
    parts: [...message.parts, ...citations.map((hit) => ({ type: 'citation' as const, hit }))],
  });
}

function fail<T = never>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}
