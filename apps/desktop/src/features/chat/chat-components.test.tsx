import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelCapability } from '@itstudio/schemas';
import type {
  ChatMessage,
  ConversationId,
  FallbackDecisionRequest,
  IsoDateTime,
  ImageAsset,
  LlmRequestId,
  MessageId,
  MicroUsd,
  ModelKey,
  RetrievalHit,
} from '@itstudio/schemas';
import '../../i18n';
import { Composer } from './Composer';
import { FallbackModal } from './FallbackModal';
import { MessageList } from './MessageList';
import type { ChatBubble, FallbackInfo } from './chat-store';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

function asRequestId(value: string): LlmRequestId {
  return value as LlmRequestId;
}
function asConversationId(value: string): ConversationId {
  return value as ConversationId;
}
function asMessageId(value: string): MessageId {
  return value as MessageId;
}
function asModelKey(value: string): ModelKey {
  return value as ModelKey;
}
function asDate(value: string): IsoDateTime {
  return value as IsoDateTime;
}
function asMicroUsd(value: number): MicroUsd {
  return value as MicroUsd;
}

const requestId = asRequestId('00000000-0000-4000-8000-000000000001');
const candidate = asModelKey('openai/next');
const fallbackRequest: FallbackDecisionRequest = {
  requestId,
  failedModel: asModelKey('openai/failed'),
  reason: 'rate_limited',
  candidates: [{ modelKey: candidate, estimatedCostMicroUsd: asMicroUsd(3) }],
  expiresAt: asDate('2026-10-03T00:00:00.000Z'),
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('chat components', () => {
  it('sends on Enter and keeps Shift+Enter for a newline', () => {
    const onSend = vi.fn();
    render(<Composer busy={false} onChange={vi.fn()} onSend={onSend} onStop={vi.fn()} value="hello" />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('routes fallback modal actions to the matching decision and cancels on Escape', () => {
    const onDecision = vi.fn();
    render(
      <FallbackModal
        names={{ [candidate]: 'Next model' }}
        onDecision={onDecision}
        onExpire={vi.fn()}
        request={fallbackRequest}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(onDecision).toHaveBeenLastCalledWith({ requestId, action: 'use_model', modelKey: candidate });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same' }));
    expect(onDecision).toHaveBeenLastCalledWith({ requestId, action: 'retry_same' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecision).toHaveBeenLastCalledWith({ requestId, action: 'abort' });
    expect(screen.getByText('—')).toBeVisible();
  });

  it('expires the fallback dialog at expiresAt', async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const request = { ...fallbackRequest, expiresAt: asDate(new Date(Date.now() + 1000).toISOString()) };
    render(<FallbackModal names={{}} onDecision={vi.fn()} onExpire={onExpire} request={request} />);
    await vi.advanceTimersByTimeAsync(1500);
    expect(onExpire).toHaveBeenCalled();
  });

  it('shows the fallback badge and keeps model HTML inert', () => {
    const message: ChatMessage = {
      id: asMessageId('00000000-0000-4000-8000-000000000003'),
      conversationId: asConversationId('00000000-0000-4000-8000-000000000002'),
      role: 'assistant',
      parts: [{ type: 'text', text: '<img src=x onerror=alert(1)>answer' }],
      modelKey: candidate,
      createdAt: asDate('2026-10-02T00:00:00.000Z'),
    };
    const bubbles: readonly ChatBubble[] = [{ kind: 'message', message, requestId }];
    const fallbacks: Readonly<Record<string, FallbackInfo>> = {
      [requestId]: { from: asModelKey('openai/old'), to: candidate, reason: 'rate_limited' },
    };
    render(
      <MessageList
        bubbles={bubbles}
        costs={{}}
        fallbacks={fallbacks}
        images={[]}
        models={[
          {
            key: candidate,
            provider: 'openai',
            providerModelId: 'next',
            displayName: 'Next model',
            capabilities: [ModelCapability.CHAT],
            contextWindowTokens: 1000,
            maxOutputTokens: 100,
            enabled: true,
          },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Answered by Next model (fallback from openai/old: rate limited)',
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('answer')).toBeVisible();
  });

  it('opens a plain text citation popover from its numbered chip', () => {
    const hit: RetrievalHit = {
      chunkId: '00000000-0000-4000-8000-000000000005' as RetrievalHit['chunkId'],
      documentId: '00000000-0000-4000-8000-000000000006' as RetrievalHit['documentId'],
      documentTitle: 'Guide',
      sectionPath: ['Setup'],
      text: '<script>plain text</script>',
      score: 0.9,
    };
    const message: ChatMessage = {
      id: asMessageId('00000000-0000-4000-8000-000000000003'),
      conversationId: asConversationId('00000000-0000-4000-8000-000000000002'),
      role: 'assistant',
      parts: [{ type: 'citation', hit }],
      createdAt: asDate('2026-10-02T00:00:00.000Z'),
    };
    render(<MessageList bubbles={[{ kind: 'message', message }]} costs={{}} fallbacks={{}} images={[]} models={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Citation 1' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Guide › Setup');
    expect(screen.getByText('<script>plain text</script>')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders image content from the local asset and opens its lightbox', () => {
    const asset: ImageAsset = {
      id: '00000000-0000-4000-8000-000000000007' as ImageAsset['id'],
      projectId: '00000000-0000-4000-8000-000000000008' as ImageAsset['projectId'],
      provider: 'openai_dalle3',
      prompt: 'A garden',
      revisedPrompt: 'A garden at sunrise',
      size: '1024x1024',
      mimeType: 'image/png',
      localPath: 'C:/app/images/project/image.png',
      cost: asMicroUsd(10),
      createdAt: asDate('2026-10-02T00:00:00.000Z'),
    };
    const message: ChatMessage = {
      id: asMessageId('00000000-0000-4000-8000-000000000003'),
      conversationId: asConversationId('00000000-0000-4000-8000-000000000002'),
      role: 'assistant',
      parts: [{ type: 'image', assetId: asset.id, mimeType: asset.mimeType }],
      createdAt: asDate('2026-10-02T00:00:00.000Z'),
    };
    render(
      <MessageList bubbles={[{ kind: 'message', message }]} costs={{}} fallbacks={{}} images={[asset]} models={[]} />,
    );
    expect(screen.getByAltText('A garden at sunrise')).toHaveAttribute(
      'src',
      'asset://C:/app/images/project/image.png',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open image: A garden at sunrise' }));
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeVisible();
  });
});
