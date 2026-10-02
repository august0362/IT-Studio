import {
  type ChatMessage,
  type Conversation,
  type FallbackDecision,
  type FallbackDecisionRequest,
  type LlmRequestId,
  type ModelKey,
  type ProjectId,
  type RouterConfig,
} from '@itstudio/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { useNotification } from '../../hooks/use-notification';
import { useRpcClient } from '../../rpc/rpc-context';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { FallbackModal } from './FallbackModal';
import { MessageList } from './MessageList';
import { ModelPicker } from './ModelPicker';
import { chatReducer, initialChatState } from './chat-store';

export function ChatPage({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [conversationId, setConversationId] = useState<Conversation['id'] | null>(null);
  const [draft, setDraft] = useState('');
  const [modelSelection, setModelSelection] = useState<{ readonly value: ModelKey | undefined } | null>(null);
  const [activeRequest, setActiveRequest] = useState<LlmRequestId | null>(null);
  const [fallback, setFallback] = useState<FallbackDecisionRequest | null>(null);
  const conversationsQuery = useQuery<readonly Conversation[]>({
    queryKey: ['chat.listConversations', { projectId }],
    queryFn: () => (projectId === null ? Promise.resolve([]) : rpc.call('chat.listConversations', { projectId })),
    enabled: projectId !== null,
  });
  const modelsQuery = useRpcQuery('models.list', {});
  const [routerConfig, setRouterConfig] = useState<RouterConfig | null>(null);
  const selectedModel = modelSelection === null ? (routerConfig?.lockedModelKey ?? undefined) : modelSelection.value;
  const conversations = useMemo(
    () => [...(conversationsQuery.data ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [conversationsQuery.data],
  );
  const names = useMemo(
    () => Object.fromEntries((modelsQuery.data ?? []).map((model) => [model.key, model.displayName])),
    [modelsQuery.data],
  );

  useNotification('chat.delta', (event) => {
    dispatch({ type: 'delta', requestId: event.requestId, text: event.textDelta });
  });
  useNotification('chat.completed', (event) => {
    dispatch({ type: 'completed', requestId: event.requestId, message: event.message, cost: event.cost });
    setActiveRequest((current) => (current === event.requestId ? null : current));
    void queryClient.invalidateQueries({ queryKey: ['chat.listConversations', { projectId }] });
  });
  useNotification('chat.failed', (event) => {
    dispatch({ type: 'failed', requestId: event.requestId, error: event.error });
    setActiveRequest((current) => (current === event.requestId ? null : current));
  });
  useNotification('router.event', (event) => {
    dispatch({ type: 'router', event });
  });
  useNotification('router.fallbackRequired', setFallback);

  useEffect(() => {
    if (conversationId === null) {
      dispatch({ type: 'load', messages: [] });
      return;
    }
    let current = true;
    void rpc
      .call('chat.getMessages', { conversationId })
      .then((messages) => {
        if (current) dispatch({ type: 'load', messages });
      })
      .catch(() => {
        if (current) dispatch({ type: 'load', messages: [] });
      });
    return () => {
      current = false;
    };
  }, [conversationId, rpc]);

  useEffect(() => {
    void rpc
      .call('router.getConfig', {})
      .then(setRouterConfig)
      .catch(() => {
        setRouterConfig(null);
      });
  }, [rpc]);

  async function createConversation(): Promise<void> {
    if (projectId === null) return;
    const conversation = await rpc.call('chat.createConversation', { projectId });
    queryClient.setQueryData<readonly Conversation[]>(['chat.listConversations', { projectId }], (current) => [
      conversation,
      ...(current ?? []).filter((item) => item.id !== conversation.id),
    ]);
    setConversationId(conversation.id);
  }

  async function send(): Promise<void> {
    if (conversationId === null || projectId === null || draft.trim().length === 0 || activeRequest !== null) return;
    const text = draft.trim();
    setDraft('');
    try {
      const result = await rpc.call('chat.send', {
        conversationId,
        text,
        ...(selectedModel === undefined ? {} : { modelOverride: selectedModel }),
      });
      const userMessage: ChatMessage = {
        id: result.userMessageId,
        conversationId,
        role: 'user',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString() as ChatMessage['createdAt'],
      };
      dispatch({ type: 'optimistic', message: userMessage });
      dispatch({ type: 'stream', requestId: result.requestId });
      setActiveRequest(result.requestId);
    } catch {
      setDraft(text);
    }
  }

  async function decideFallback(decision: FallbackDecision): Promise<void> {
    await rpc.call('router.resolveFallback', decision);
    setFallback(null);
  }

  async function lockModel(locked: boolean): Promise<void> {
    const config = await rpc.call('router.getConfig', {});
    const next = { ...config, lockedModelKey: locked ? (selectedModel ?? null) : null };
    const saved = await rpc.call('router.updateConfig', { config: next });
    setRouterConfig(saved);
  }

  async function changeModel(model: ModelKey | undefined): Promise<void> {
    setModelSelection({ value: model });
    if (routerConfig?.lockedModelKey !== null && routerConfig?.lockedModelKey !== undefined) {
      const saved = await rpc.call('router.updateConfig', {
        config: { ...routerConfig, lockedModelKey: model ?? null },
      });
      setRouterConfig(saved);
    }
  }

  if (projectId === null) {
    return (
      <section aria-label={t('chat.heading')} className="rounded border border-border bg-surface p-6">
        <h1 className="mb-2 text-xl">{t('chat.heading')}</h1>
        <p>{t('chat.pickProject')}</p>
      </section>
    );
  }
  const active = conversations.find((conversation) => conversation.id === conversationId);
  return (
    <section
      aria-label={t('chat.heading')}
      className="flex h-[calc(100vh-12rem)] min-h-96 overflow-hidden rounded border border-border bg-surface"
    >
      <ConversationList
        conversations={conversations}
        onCreate={() => void createConversation()}
        onSelect={(id) => {
          const selected = conversations.find((conversation) => conversation.id === id);
          if (selected !== undefined) setConversationId(selected.id);
        }}
        selectedId={conversationId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border p-3">
          <h1 className="truncate font-semibold">{active?.title ?? t('chat.heading')}</h1>
          {active !== undefined ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                aria-label={t('chat.useKnowledge')}
                checked={active.ragEnabled}
                onChange={(event) => {
                  void rpc
                    .call('chat.setRagEnabled', { conversationId: active.id, enabled: event.target.checked })
                    .then((updated) => {
                      queryClient.setQueryData<readonly Conversation[]>(
                        ['chat.listConversations', { projectId }],
                        (current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
                      );
                    });
                }}
                type="checkbox"
              />
              {t('chat.useKnowledge')}
            </label>
          ) : null}
          <ModelPicker
            config={routerConfig}
            models={modelsQuery.data ?? []}
            onChange={(model) => {
              void changeModel(model);
            }}
            onLock={(locked) => void lockModel(locked)}
            value={selectedModel}
          />
        </header>
        {conversationId === null ? (
          <div className="grid flex-1 place-items-center p-6 text-text-muted">{t('chat.chooseConversation')}</div>
        ) : (
          <MessageList
            bubbles={state.bubbles}
            costs={state.costs}
            fallbacks={state.fallbacks}
            models={modelsQuery.data ?? []}
          />
        )}
        {conversationId !== null ? (
          <Composer
            busy={activeRequest !== null}
            onChange={setDraft}
            onSend={() => {
              void send();
            }}
            onStop={() => {
              if (activeRequest !== null) void rpc.call('chat.cancel', { requestId: activeRequest });
            }}
            value={draft}
          />
        ) : null}
      </div>
      {fallback !== null ? (
        <FallbackModal
          onDecision={(decision) => void decideFallback(decision)}
          onExpire={() => {
            setFallback(null);
          }}
          names={names}
          request={fallback}
        />
      ) : null}
    </section>
  );
}
