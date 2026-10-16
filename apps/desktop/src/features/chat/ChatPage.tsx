import {
  type AppError,
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
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ErrorPanel } from '../../components/ErrorPanel';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../components/ui/Icon';
import { Button } from '../../components/ui/primitives';
import { RpcCallError } from '../../rpc/rpc-client';
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
import { useNavigationIntent } from '../../state/navigation-intent';
import { WebChatMenu } from './WebChatMenu';
import type { ShellRoute } from '../../shell/MainNav';

interface ChatPageProps {
  readonly projectId: ProjectId | null;
  readonly onNavigate?: (route: ShellRoute) => void;
}

export function ChatPage(props: ChatPageProps): JSX.Element {
  return <ProjectChatPage key={props.projectId} {...props} />;
}

function ProjectChatPage({ projectId, onNavigate = () => undefined }: ChatPageProps): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [conversationId, setConversationId] = useState<Conversation['id'] | null>(null);
  const [draft, setDraft] = useState('');
  const [modelSelection, setModelSelection] = useState<{ readonly value: ModelKey | undefined } | null>(null);
  const [activeRequest, setActiveRequest] = useState<LlmRequestId | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<AppError | null>(null);
  const [stopBeforeAck, setStopBeforeAck] = useState(false);
  const stopBeforeAckRef = useRef({ requested: false });
  const [fallback, setFallback] = useState<FallbackDecisionRequest | null>(null);
  const conversationsQuery = useQuery<readonly Conversation[]>({
    queryKey: ['chat.listConversations', { projectId }],
    queryFn: () => (projectId === null ? Promise.resolve([]) : rpc.call('chat.listConversations', { projectId })),
    enabled: projectId !== null,
  });
  const modelsQuery = useRpcQuery('models.list', {});
  const imagesQuery = useQuery({
    queryKey: ['images.list', { projectId }],
    queryFn: () => (projectId === null ? Promise.resolve([]) : rpc.call('images.list', { projectId })),
    enabled: projectId !== null,
  });
  const [routerConfig, setRouterConfig] = useState<RouterConfig | null>(null);
  const selectedModel = modelSelection === null ? (routerConfig?.lockedModelKey ?? undefined) : modelSelection.value;
  const conversations = useMemo(
    () => [...(conversationsQuery.data ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [conversationsQuery.data],
  );
  const navigationIntent = useNavigationIntent((state) => state.intent);
  const clearNavigationIntent = useNavigationIntent((state) => state.clearIntent);
  const names = useMemo(
    () => Object.fromEntries((modelsQuery.data ?? []).map((model) => [model.key, model.displayName])),
    [modelsQuery.data],
  );

  useEffect(() => {
    if (navigationIntent?.kind !== 'conversation') return;
    const selected = conversations.find((conversation) => conversation.id === navigationIntent.id);
    if (selected === undefined) return;
    const timer = window.setTimeout(() => {
      setConversationId(selected.id);
      clearNavigationIntent();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [clearNavigationIntent, conversations, navigationIntent]);

  useNotification('chat.delta', (event) => {
    dispatch({ type: 'delta', requestId: event.requestId, text: event.textDelta });
  });
  useNotification('chat.completed', (event) => {
    dispatch({ type: 'completed', requestId: event.requestId, message: event.message, cost: event.cost });
    setActiveRequest((current) => (current === event.requestId ? null : current));
    void queryClient.invalidateQueries({ queryKey: ['chat.listConversations', { projectId }] });
    void queryClient.invalidateQueries({ queryKey: ['images.list', { projectId }] });
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
    if (conversationId === null || projectId === null || draft.trim().length === 0 || activeRequest !== null || sending)
      return;
    if (
      !conversations.some((conversation) => conversation.id === conversationId && conversation.projectId === projectId)
    )
      return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    setSendError(null);
    setStopBeforeAck(false);
    stopBeforeAckRef.current = { requested: false };
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
      if (stopBeforeAckRef.current.requested) {
        dispatch({ type: 'stopped', requestId: result.requestId });
        void rpc.call('chat.cancel', { requestId: result.requestId }).catch(showSendError);
      } else setActiveRequest(result.requestId);
    } catch (cause: unknown) {
      setDraft(text);
      showSendError(cause);
    } finally {
      setSending(false);
    }
  }

  function showSendError(cause: unknown): void {
    setSendError(
      cause instanceof RpcCallError
        ? cause.appError
        : {
            code: 'INTERNAL',
            message: t('chat.requestError'),
            retryable: true,
            remediation: [t('projects.tryAgain')],
          },
    );
  }

  function stop(): void {
    if (activeRequest === null) {
      stopBeforeAckRef.current.requested = true;
      setStopBeforeAck(true);
      return;
    }
    dispatch({ type: 'stopped', requestId: activeRequest });
    setActiveRequest(null);
    void rpc.call('chat.cancel', { requestId: activeRequest }).catch(showSendError);
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
        <PageHeader icon="chat" title={t('chat.heading')} subtitle={t('character.chat')} />
        <EmptyState
          icon="chat"
          description={t('chat.pickProject')}
          action={
            <Button
              tone="primary"
              onClick={() => {
                onNavigate('projects');
              }}
            >
              <Icon name="projects" />
              {t('nav.projects')}
            </Button>
          }
        />
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
        <PageHeader
          icon="chat"
          title={active?.title ?? t('chat.heading')}
          subtitle={t('character.chat')}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <WebChatMenu
                onEdit={() => {
                  onNavigate('settings-web-chat');
                }}
                projectId={projectId}
              />
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
            </div>
          }
        />
        {conversationId === null ? (
          <div className="m-4 grid flex-1 place-items-center overflow-auto">
            <EmptyState
              icon="chat"
              description={t('chat.chooseConversation')}
              action={
                <Button
                  tone="primary"
                  onClick={() => {
                    void createConversation();
                  }}
                >
                  <Icon name="plus" />
                  {t('character.startChat')}
                </Button>
              }
            />
          </div>
        ) : (
          <MessageList
            bubbles={state.bubbles}
            costs={state.costs}
            fallbacks={state.fallbacks}
            images={imagesQuery.data ?? []}
            models={modelsQuery.data ?? []}
            pending={sending && !stopBeforeAck}
          />
        )}
        {conversationId !== null ? (
          <Composer
            busy={activeRequest !== null || sending}
            onChange={setDraft}
            onSend={() => {
              void send();
            }}
            onStop={stop}
            value={draft}
          />
        ) : null}
        {sendError !== null ? <ErrorPanel error={sendError} /> : null}
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
