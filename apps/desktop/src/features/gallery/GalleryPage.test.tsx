import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import type { Project, ProjectId } from '@itstudio/schemas';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import '../../i18n';
import { GalleryPage } from './GalleryPage';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

afterEach(cleanup);

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const asset = {
    id: 'asset-1',
    projectId: 'project-1',
    provider: 'openai_dalle3',
    prompt: 'A quiet garden',
    size: '1024x1024',
    mimeType: 'image/png',
    localPath: 'C:/app/images/project-1/asset-1.png',
    cost: 1000,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const method = String(request.method);
    const result =
      method === 'images.list'
        ? [asset]
        : method === 'images.delete'
          ? { deleted: true }
          : method === 'fx.get'
            ? { usdToVnd: 25000, asOf: '2026-10-01T00:00:00.000Z', source: 'auto' }
            : {};
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <GalleryPage
          projectId={'project-1' as ProjectId}
          projects={[
            {
              id: 'project-1' as ProjectId,
              name: 'Project',
              workspaceRoot: 'C:/project',
              createdAt: '2026-01-01T00:00:00.000Z' as Project['createdAt'],
              archived: false,
            },
          ]}
        />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport };
}

describe('GalleryPage', () => {
  it('lists local images and confirms deletion while cancel leaves the asset intact', async () => {
    const { transport } = setup();
    expect(await screen.findByAltText('A quiet garden')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(transport.sent.some((line) => line.includes('images.delete'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('images.delete'))).toBe(true);
    });
  });
});
