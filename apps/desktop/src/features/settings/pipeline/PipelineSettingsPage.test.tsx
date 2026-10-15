import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { PipelineSettingsPage } from './PipelineSettingsPage';
import { i18n } from '../../../i18n';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

describe('PSTUDIO-01 pipeline settings', () => {
  it('shows the default-off toggle, saves it, and renders the saved value', async () => {
    const settings = {
      pipeline: {
        autoClarify: false,
        roleAssignment: { pm: ['openai/a'], coder: ['openai/a'], reviewer: ['openai/a'] },
        validationCommands: [],
        maxFixAttempts: 1,
      },
    };
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
        return Promise.resolve();
      if (request.method === 'settings.update') settings.pipeline.autoClarify = true;
      transport.receive(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'models.list' ? [] : settings }),
      );
      return Promise.resolve();
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RpcClientProvider client={new RpcClient(transport)}>
          <PipelineSettingsPage />
        </RpcClientProvider>
      </QueryClientProvider>,
    );
    const toggle = await screen.findByRole('checkbox', {
      name: 'Auto-answer clarifying questions with the recommendation',
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await screen.findByText('Settings saved.');
    expect(toggle).toBeChecked();
    const update = transport.sent.find((line) => line.includes('settings.update'));
    expect(update).toBeDefined();
    const request: unknown = JSON.parse(update ?? '{}');
    expect(request).toMatchObject({ params: { patch: { pipeline: { autoClarify: true } } } });
  });
});
