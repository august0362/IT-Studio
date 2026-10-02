import type { ChatMessage, MoneyDisplay, ModelDescriptor, ModelKey } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { Money } from '../../components/Money';
import { SafeMarkdown } from '../../components/SafeMarkdown';
import type { ChatBubble, FallbackInfo } from './chat-store';
import { useState } from 'react';

function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function MessageList({
  bubbles,
  costs,
  fallbacks,
  models,
}: {
  readonly bubbles: readonly ChatBubble[];
  readonly costs: Readonly<Record<string, MoneyDisplay>>;
  readonly fallbacks: Readonly<Record<string, FallbackInfo>>;
  readonly models: readonly ModelDescriptor[];
}): JSX.Element {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const atBottomRef = useRef(true);
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list !== null && atBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [bubbles]);
  function modelName(key: ModelKey | undefined): string | null {
    if (key === undefined) return null;
    return models.find((model) => model.key === key)?.displayName ?? key;
  }
  return (
    <ol
      aria-label={t('chat.messages')}
      className="min-h-0 flex-1 space-y-4 overflow-auto p-4"
      onScroll={(event) => {
        const list = event.currentTarget;
        atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      }}
      ref={listRef}
    >
      {bubbles.map((bubble, index) => {
        if (bubble.kind === 'failed')
          return (
            <li key={bubble.requestId}>
              <ErrorPanel error={bubble.error} />
            </li>
          );
        if (bubble.kind === 'stream')
          return (
            <li aria-live="polite" className="rounded bg-surface p-3" key={bubble.requestId}>
              <SafeMarkdown source={bubble.text} />
            </li>
          );
        const { message } = bubble;
        const requestId = bubble.requestId ?? message.id;
        const fallback = fallbacks[requestId];
        const text = messageText(message);
        const name = modelName(message.modelKey);
        return (
          <li
            className={`max-w-3xl rounded p-3 ${message.role === 'user' ? 'ml-auto bg-surface-alt' : 'bg-surface'}`}
            key={`${message.id}-${index.toString()}`}
          >
            {message.role === 'assistant' ? (
              <SafeMarkdown source={text} />
            ) : (
              <p className="whitespace-pre-wrap">{text}</p>
            )}
            {message.role === 'assistant'
              ? message.parts
                  .filter((part) => part.type === 'citation')
                  .map((part, citationIndex) => (
                    <span
                      className="relative mr-2 inline-block"
                      key={`${part.hit.chunkId}-${citationIndex.toString()}`}
                    >
                      <button
                        aria-expanded={openCitation === part.hit.chunkId}
                        aria-label={t('chat.citation', { number: citationIndex + 1 })}
                        className="mt-2 rounded-full border border-border px-2 py-1 text-xs"
                        onClick={() => {
                          setOpenCitation(openCitation === part.hit.chunkId ? null : part.hit.chunkId);
                        }}
                        type="button"
                      >
                        [{citationIndex + 1}]
                      </button>
                      {openCitation === part.hit.chunkId ? (
                        <span
                          className="absolute left-0 top-full z-10 mt-1 block w-72 rounded border border-border bg-surface p-3 text-sm shadow-lg"
                          role="dialog"
                        >
                          <strong>
                            {part.hit.documentTitle} › {part.hit.sectionPath.join(' › ')}
                          </strong>
                          <span className="mt-2 block whitespace-pre-wrap">{part.hit.text}</span>
                        </span>
                      ) : null}
                    </span>
                  ))
              : null}
            {message.role === 'assistant' && name !== null ? (
              <p className="mt-2 text-xs text-text-muted">{t('chat.modelName', { name })}</p>
            ) : null}
            {message.role === 'assistant' && fallback !== undefined ? (
              <p className="mt-2 rounded border border-border px-2 py-1 text-sm" role="status">
                {t('chat.fallbackBadge', {
                  to: modelName(fallback.to) ?? fallback.to,
                  from: modelName(fallback.from) ?? fallback.from,
                  reason: t(`chat.reason.${fallback.reason}`),
                })}
              </p>
            ) : null}
            {message.role === 'assistant' && costs[requestId] !== undefined ? <Money value={costs[requestId]} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
