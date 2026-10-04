import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId, SourceDocument } from '@itstudio/schemas';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { AddSourcesForm } from './AddSourcesForm';
import { DocumentTable } from './DocumentTable';
import { IngestProgress } from './IngestProgress';
import { TestQueryPanel } from './TestQueryPanel';
import type { ReactNode } from 'react';

const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
const document: SourceDocument = {
  id: '00000000-0000-4000-8000-000000000002' as SourceDocument['id'],
  projectId,
  title: 'guide.md',
  sourcePath: 'C:/workspace/guide.md',
  format: 'markdown',
  contentHash: 'a'.repeat(64) as SourceDocument['contentHash'],
  chunkCount: 2,
  embeddingModel: 'openai/text-embedding-3-small',
  ingestedAt: '2026-10-02T00:00:00.000Z' as SourceDocument['ingestedAt'],
  tags: ['manual'],
};

function renderWithClient(transport: FakeTransport, element: ReactNode): void {
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>{element}</RpcClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('knowledge components', () => {
  it('submits source paths and reports the returned ingest job', async () => {
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
        const call = request as { readonly id: number; readonly method: string };
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            result: {
              id: 'job-1',
              projectId,
              paths: ['guide.md'],
              status: 'queued',
              processedFiles: 0,
              totalFiles: 1,
              cost: 0,
            },
          }),
        );
      }
      return Promise.resolve();
    };
    const onStarted = vi.fn();
    renderWithClient(transport, <AddSourcesForm onStarted={onStarted} projectId={projectId} />);
    const paths = screen.getByLabelText('Workspace-relative file or folder paths (one per line)');
    fireEvent.change(paths, { target: { value: 'guide.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add sources' }));
    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledOnce();
      expect(transport.sent[0]).toContain('"paths":["guide.md"]');
    });
  });

  it('adds workspace sources and reports validation remediation inline', async () => {
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
        return Promise.resolve();
      const call = request as { readonly id: number; readonly method: string };
      if (call.method === 'rag.ingest')
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            error: {
              code: -32000,
              message: 'outside workspace',
              data: {
                code: 'VALIDATION',
                message: 'outside workspace',
                remediation: ['Choose an in-workspace path.'],
                retryable: false,
              },
            },
          }),
        );
      else
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            result: {
              id: 'j1',
              projectId,
              paths: ['guide.md'],
              status: 'queued',
              processedFiles: 0,
              totalFiles: 1,
              cost: 0,
            },
          }),
        );
      return Promise.resolve();
    };
    renderWithClient(transport, <AddSourcesForm onStarted={() => undefined} projectId={projectId} />);
    fireEvent.change(screen.getByLabelText('Workspace-relative file or folder paths (one per line)'), {
      target: { value: 'guide.md' },
    });
    fireEvent.change(screen.getByLabelText('Optional tags (comma separated)'), { target: { value: 'manual, docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add sources' }));
    await screen.findByText('outside workspace');
    expect(screen.getByText('Choose an in-workspace path.')).toBeVisible();
    expect(transport.sent[0]).toContain('"tags":["manual","docs"]');
  });

  it('renders ingestion status and confirms deletion before the RPC call', async () => {
    render(<IngestProgress jobs={[]} skippedUnchanged={2} />);
    expect(screen.getByText('Unchanged files skipped: 2')).toBeVisible();
    cleanup();
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
        const call = request as { readonly id: number; readonly method: string };
        transport.receive(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { deleted: true } }));
      }
      return Promise.resolve();
    };
    renderWithClient(
      transport,
      <DocumentTable
        documents={[document]}
        onChanged={() => undefined}
        onStarted={() => undefined}
        projectId={projectId}
        workspaceRoot="C:/workspace"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(transport.sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(transport.sent[0]).toContain('"method":"rag.deleteDocument"');
    });
  });

  it('highlights the ingest job selected by a workflow deep link', () => {
    render(<IngestProgress jobs={[]} selectedJobId="job-from-workflow" skippedUnchanged={0} />);
    expect(screen.getByText('Selected ingest job: job-from-workflow').parentElement).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('re-indexes a document using its workspace-relative source path', async () => {
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
        const call = request as { readonly id: number; readonly method: string };
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            result: {
              id: 'job-1',
              projectId,
              paths: ['guide.md'],
              status: 'queued',
              processedFiles: 0,
              totalFiles: 1,
              cost: 0,
            },
          }),
        );
      }
      return Promise.resolve();
    };
    renderWithClient(
      transport,
      <DocumentTable
        documents={[document]}
        onChanged={() => undefined}
        onStarted={() => undefined}
        projectId={projectId}
        workspaceRoot="C:/workspace"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Re-index' }));
    await waitFor(() => {
      expect(transport.sent[0]).toContain('"method":"rag.ingest"');
      expect(transport.sent[0]).toContain('"paths":["guide.md"]');
    });
  });

  it('submits a retrieval query and renders matching text and scores', async () => {
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
        const call = request as { readonly id: number; readonly method: string };
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            result:
              call.method === 'rag.query'
                ? [
                    {
                      chunkId: 'chunk-1',
                      documentId: document.id,
                      documentTitle: document.title,
                      sectionPath: ['Basics'],
                      text: 'Lantern stored north.',
                      score: 0.876,
                    },
                  ]
                : undefined,
          }),
        );
      }
      return Promise.resolve();
    };
    renderWithClient(
      transport,
      <TestQueryPanel defaultTopK={4} minScore={0.2} onReindexAll={() => undefined} projectId={projectId} />,
    );
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'where lantern?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search knowledge' }));
    expect(await screen.findByText(/Lantern stored north\./)).toBeVisible();
    expect(screen.getByText(/0\.88/)).toBeVisible();
    expect(transport.sent[0]).toContain('"topK":4');
  });

  it('offers full re-index when the query reports an embedding validation mismatch', async () => {
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
        const call = request as { readonly id: number; readonly method: string };
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            error: {
              code: -32000,
              message: 'Embedding model mismatch',
              data: {
                code: 'VALIDATION',
                message: 'Embedding model mismatch',
                remediation: ['Re-index the project.'],
                retryable: false,
              },
            },
          }),
        );
      }
      return Promise.resolve();
    };
    const onReindexAll = vi.fn();
    renderWithClient(
      transport,
      <TestQueryPanel defaultTopK={4} minScore={0.2} onReindexAll={onReindexAll} projectId={projectId} />,
    );
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'a query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search knowledge' }));
    expect(await screen.findByText(/Re-index required/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Re-index all documents' }));
    expect(onReindexAll).toHaveBeenCalledOnce();
  });
});
