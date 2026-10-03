import { ImageProviderId } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import '../../../i18n';
import { ImagesSettingsPage } from './ImagesSettingsPage';

afterEach(cleanup);

const settings = {
  activeProjectId: null,
  image: {
    enabled: false,
    providerOrder: [
      ImageProviderId.OPENAI_DALLE3,
      ImageProviderId.FLUX_TOGETHER,
      ImageProviderId.FLUX_REPLICATE,
      ImageProviderId.MIDJOURNEY_PROXY,
    ],
  },
};

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const method = String(request.method);
    const result =
      method === 'settings.get'
        ? settings
        : method === 'secrets.status'
          ? []
          : method === 'settings.update' &&
              'params' in request &&
              typeof request.params === 'object' &&
              request.params !== null &&
              'patch' in request.params
            ? { ...settings, image: (request.params.patch as { image: typeof settings.image }).image }
            : {};
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={new RpcClient(transport)}>
        <ImagesSettingsPage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

describe('ImagesSettingsPage', () => {
  it('saves the enable toggle and supports keyboard provider reorder', async () => {
    const transport = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Enable image generation' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"enabled":true'))).toBe(true);
    });
    const reorder = screen.getByRole('button', { name: 'Reorder OpenAI DALL·E 3' });
    fireEvent.keyDown(reorder, { key: ' ', code: 'Space' });
    fireEvent.keyDown(reorder, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(reorder, { key: ' ', code: 'Space' });
    await waitFor(() => {
      const updates = transport.sent.filter((line) => line.includes('settings.update'));
      expect(updates.at(-1)).toContain('flux_together');
    });
    expect(screen.getByRole('link', { name: 'API Keys' })).toHaveAttribute('href', '#settings-api-keys');
  });
});
