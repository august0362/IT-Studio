import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { VSCodeSettingsPage } from './VSCodeSettingsPage';
import { i18n } from '../../../i18n';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

describe('VSC-01 VS Code settings', () => {
  it.each([
    ['closeWithStudio', 'Close VS Code when IT Studio quits', true],
    ['closeWithProject', 'Close VS Code when a project closes', true],
    ['closeManuallyOpened', 'Also close VS Code windows I opened myself for that project', false],
  ] as const)('persists %s through RPC and shows the saved value', async (key, label, initial) => {
    const settings = {
      vscode: {
        autoLaunch: true,
        codeExecutable: null,
        showDiffBeforeValidate: true,
        revealChangedFiles: true,
        closeWithStudio: true,
        closeWithProject: true,
        closeManuallyOpened: false,
      },
    };
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
        return Promise.resolve();
      if (request.method === 'settings.update') settings.vscode[key] = !initial;
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: settings }));
      return Promise.resolve();
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RpcClientProvider client={new RpcClient(transport)}>
          <VSCodeSettingsPage />
        </RpcClientProvider>
      </QueryClientProvider>,
    );
    const toggle = await screen.findByRole('checkbox', { name: new RegExp(label) });
    expect(toggle).toHaveProperty('checked', initial);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveProperty('checked', !initial);
    });
    expect(
      transport.sent.filter((line) => line.includes('settings.update')).map((line) => JSON.parse(line) as unknown),
    ).toEqual([expect.objectContaining({ params: { patch: { vscode: { [key]: !initial } } } })]);
    expect(screen.getByText(/IT Studio never closes VS Code windows by force/)).toBeVisible();
  });
});
