import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CostPurpose, type ProjectId } from '@itstudio/schemas';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { sourceDocumentSchema } from '../../src/validation/rag.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { LanceDbVectorStore } from '../../src/infra/lancedb/vector-store.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('RAG ingest integration', () => {
  it('TC-M5-001 indexes supported files, reports progress, and meters embeddings', async () => {
    const { projectId, workspace, progress } = await createProject();
    await mkdir(resolve(workspace, 'docs'));
    await writeFile(resolve(workspace, 'docs', 'guide.md'), '# Guide\n\nFixture markdown.', 'utf8');
    await writeFile(resolve(workspace, 'docs', 'example.ts'), 'export const fixture = true;', 'utf8');
    await writeFile(resolve(workspace, 'docs', 'broken.pdf'), 'not a pdf', 'utf8');

    const jobId = await ingest(projectId, 'docs');
    await waitFor(() => progress.some((event) => event.id === jobId && event.status === 'indexed'));
    const docs = await listDocuments(projectId);
    expect(docs).toHaveLength(2);
    expect(progress.some((event) => event.id === jobId && event.status === 'parsing')).toBe(true);
    expect(progress.some((event) => event.id === jobId && event.status === 'failed')).toBe(false);
    const ledger = await sidecar?.call('ledger.query', { projectId, purposes: [CostPurpose.EMBEDDING], limit: 100 });
    expect(z.object({ items: z.array(z.unknown()).min(1) }).safeParse(ledger?.result).success).toBe(true);
  }, 60_000);

  it('TC-M5-002 deletes document metadata and its vectors', async () => {
    const { projectId, workspace } = await createProject();
    await writeFile(resolve(workspace, 'guide.md'), '# Guide\n\nDelete this document.', 'utf8');
    await ingestAndWait(projectId, 'guide.md');
    const [document] = await listDocuments(projectId);
    if (document === undefined) throw new Error('Expected an indexed document.');
    const vectors = new LanceDbVectorStore(resolve(sidecar?.dataDir ?? '', 'lancedb'));
    const before = await vectors.count(projectId);
    expect(before.ok && before.value).toBeGreaterThan(0);
    expect((await sidecar?.call('rag.deleteDocument', { documentId: document.id }))?.result).toEqual({ deleted: true });
    expect(await vectors.count(projectId)).toEqual({ ok: true, value: 0 });
    expect(await listDocuments(projectId)).toHaveLength(0);
  }, 60_000);

  it('TC-M5-003 re-ingests unchanged content without adding embedding ledger rows', async () => {
    const { projectId, workspace } = await createProject();
    await writeFile(resolve(workspace, 'guide.md'), '# Guide\n\nUnchanged content.', 'utf8');
    await ingestAndWait(projectId, 'guide.md');
    const before = await embeddingLedgerCount(projectId);
    const statuses = progressFor(sidecar);
    const jobId = await ingest(projectId, 'guide.md');
    await waitFor(() => statuses.some((event) => event.id === jobId && event.status === 'indexed'));
    expect(statuses.some((event) => event.id === jobId && event.status === 'skipped_unchanged')).toBe(true);
    expect(await embeddingLedgerCount(projectId)).toBe(before);
  }, 60_000);

  it('TC-M5-004 re-ingests changed content under the same document id with replaced chunks', async () => {
    const { projectId, workspace } = await createProject();
    const path = resolve(workspace, 'guide.md');
    await writeFile(path, '# Guide\n\nOriginal content.', 'utf8');
    await ingestAndWait(projectId, 'guide.md');
    const [before] = await listDocuments(projectId);
    if (before === undefined) throw new Error('Expected an indexed document.');
    const vectors = new LanceDbVectorStore(resolve(sidecar?.dataDir ?? '', 'lancedb'));
    const oldCount = await vectors.count(projectId);
    await writeFile(path, '# Guide\n\nRevised content with a different number of words.', 'utf8');
    await ingestAndWait(projectId, 'guide.md');
    const [after] = await listDocuments(projectId);
    const newCount = await vectors.count(projectId);
    expect(after?.id).toBe(before.id);
    expect(after?.contentHash).not.toBe(before.contentHash);
    expect(newCount.ok).toBe(true);
    if (newCount.ok && after !== undefined) expect(newCount.value).toBe(after.chunkCount);
    if (oldCount.ok) expect(oldCount.value).toBeGreaterThan(0);
  }, 60_000);

  it('TC-M5-005 fails an all-invalid ingest with the first file error', async () => {
    const { projectId, workspace, progress } = await createProject();
    await mkdir(resolve(workspace, 'bad'));
    await writeFile(resolve(workspace, 'bad', 'broken.pdf'), 'invalid pdf', 'utf8');
    await writeFile(resolve(workspace, 'bad', 'binary.md'), new Uint8Array([65, 0, 66]));
    const jobId = await ingest(projectId, 'bad');
    await waitFor(() => progress.some((event) => event.id === jobId && event.status === 'failed'));
    const failed = progress.find((event) => event.id === jobId && event.status === 'failed');
    const failedError = z
      .object({ code: z.literal('VALIDATION'), remediation: z.array(z.string()).min(1) })
      .safeParse(failed?.error);
    expect(failedError.success).toBe(true);
    expect(await listDocuments(projectId)).toHaveLength(0);
  }, 60_000);

  it('TC-M5-007 queues jobs in project order while allowing another project to finish', async () => {
    const { projectId, workspace, progress } = await createProject();
    await writeFile(resolve(workspace, 'first.md'), '# First\n\nFirst queued file.', 'utf8');
    await writeFile(resolve(workspace, 'second.md'), '# Second\n\nSecond queued file.', 'utf8');
    const secondWorkspace = resolve(sidecar?.dataDir ?? '', 'second-workspace');
    await mkdir(secondWorkspace);
    await writeFile(resolve(secondWorkspace, 'other.md'), '# Other\n\nIndependent project.', 'utf8');
    const secondProjectId = projectSchema.parse(
      (await sidecar?.call('project.create', { name: 'Independent project', workspaceRoot: secondWorkspace }))?.result,
    ).id;

    const first = await ingest(projectId, 'first.md');
    const second = await ingest(projectId, 'second.md');
    const independent = await ingest(secondProjectId, 'other.md');
    await waitFor(
      () =>
        progress.some((event) => event.id === first && event.status === 'indexed') &&
        progress.some((event) => event.id === second && event.status === 'indexed') &&
        progress.some((event) => event.id === independent && event.status === 'indexed'),
    );
    const firstParsing = progress.findIndex((event) => event.id === first && event.status === 'parsing');
    const secondParsing = progress.findIndex((event) => event.id === second && event.status === 'parsing');
    expect(firstParsing).toBeGreaterThanOrEqual(0);
    expect(secondParsing).toBeGreaterThan(firstParsing);
    expect(await listDocuments(projectId)).toHaveLength(2);
  }, 60_000);

  it('TC-M5-034 rejects traversal and absolute paths outside the workspace before queueing', async () => {
    const { projectId, workspace, progress } = await createProject();
    const outside = resolve(sidecar?.dataDir ?? '', 'outside.md');
    await writeFile(outside, '# Outside', 'utf8');
    const traversal = await sidecar?.call('rag.ingest', { projectId, paths: ['../outside.md'] });
    const absolute = await sidecar?.call('rag.ingest', { projectId, paths: [outside] });
    expect(traversal?.error?.data).toMatchObject({ code: 'VALIDATION' });
    expect(absolute?.error?.data).toMatchObject({ code: 'VALIDATION' });
    expect(progress.filter((event) => event.status === 'queued')).toHaveLength(0);
    expect(await listDocuments(projectId)).toHaveLength(0);
    expect(workspace).toContain('rag-workspace');
  });

  it('TC-M5-035 indexes Unicode names and paths longer than 260 characters', async () => {
    const { projectId, workspace } = await createProject();
    const deepPath = resolve(
      workspace,
      'Tiếng Việt',
      ...Array.from({ length: 9 }, (_, index) => `nested-${String(index)}-long-directory-name`),
      'đường-dẫn-dài.md',
    );
    await mkdir(resolve(deepPath, '..'), { recursive: true });
    await writeFile(deepPath, '# Xin chào\n\nNội dung tiếng Việt.', 'utf8');
    expect(deepPath.length).toBeGreaterThan(260);
    await ingestAndWait(projectId, 'Tiếng Việt');
    const docs = await listDocuments(projectId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourcePath).toBe(deepPath);
    expect(docs[0]?.title).toBe('Xin chào');
  }, 60_000);
});

async function createProject(): Promise<{
  readonly projectId: ProjectId;
  readonly workspace: string;
  readonly progress: { readonly id: string; readonly status: string; readonly error?: unknown }[];
}> {
  sidecar = await startSidecar();
  const workspace = resolve(sidecar.dataDir, 'rag-workspace');
  await mkdir(workspace);
  const projectId = projectSchema.parse(
    (await sidecar.call('project.create', { name: 'RAG integration', workspaceRoot: workspace })).result,
  ).id;
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const provider = providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]);
  await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-fake-key' });
  const progress = progressFor(sidecar);
  return { projectId, workspace, progress };
}

function progressFor(
  harness: SidecarHarness | undefined,
): { readonly id: string; readonly status: string; readonly error?: unknown }[] {
  const progress: { readonly id: string; readonly status: string; readonly error?: unknown }[] = [];
  harness?.notifications.on('notification', (value: unknown) => {
    const parsed = z
      .object({
        method: z.string(),
        params: z.object({ id: z.string(), status: z.string(), error: z.unknown().optional() }),
      })
      .safeParse(value);
    if (parsed.success && parsed.data.method === 'rag.progress') progress.push(parsed.data.params);
  });
  return progress;
}

async function ingest(projectId: ProjectId, path: string): Promise<string> {
  const response = await sidecar?.call('rag.ingest', { projectId, paths: [path] });
  if (response?.error !== undefined) throw new Error(response.error.message);
  return z.object({ id: z.string() }).parse(response?.result).id;
}

async function ingestAndWait(projectId: ProjectId, path: string): Promise<void> {
  const events = progressFor(sidecar);
  const id = await ingest(projectId, path);
  await waitFor(() => events.some((event) => event.id === id && event.status === 'indexed'));
}

async function listDocuments(projectId: ProjectId) {
  const result = await sidecar?.call('rag.listDocuments', { projectId });
  if (result?.error !== undefined) throw new Error(result.error.message);
  return z.array(sourceDocumentSchema).parse(result?.result);
}

async function embeddingLedgerCount(projectId: ProjectId): Promise<number> {
  const result = await sidecar?.call('ledger.query', { projectId, purposes: [CostPurpose.EMBEDDING], limit: 100 });
  return z.object({ items: z.array(z.unknown()) }).parse(result?.result).items.length;
}
