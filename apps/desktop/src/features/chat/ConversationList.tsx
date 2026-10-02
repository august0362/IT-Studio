import type { Conversation } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreate,
}: {
  readonly conversations: readonly Conversation[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('chat.conversations')} className="w-64 shrink-0 border-r border-border p-3">
      <button className="mb-3 w-full rounded bg-primary px-3 py-2 text-primary-fg" onClick={onCreate} type="button">
        {t('chat.new')}
      </button>
      <ul className="space-y-1">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              aria-current={conversation.id === selectedId ? 'page' : undefined}
              className="w-full rounded px-3 py-2 text-left hover:bg-surface-alt"
              onClick={() => {
                onSelect(conversation.id);
              }}
              type="button"
            >
              {conversation.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
