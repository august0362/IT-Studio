import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostPurpose } from '@itstudio/schemas';
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
  it('TC-M5-001 ingests, meters, skips unchanged content, and TC-M5-002 deletes vectors and metadata', async () => {
    sidecar = await startSidecar();
    const workspace = resolve(sidecar.dataDir, 'rag-workspace');
    await mkdir(workspace);
    const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/rag');
    await cp(fixtureDir, resolve(workspace, 'docs'), { recursive: true });
    await writeFile(
      resolve(workspace, 'docs', 'example.ts'),
      "export function ragFixture(): string { return 'fixture code'; }\n",
      'utf8',
    );
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'RAG integration', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const embeddingProvider = providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider: embeddingProvider, apiKey: 'integration-only-fake-key' });
    const progress: { readonly id: string; readonly status: string }[] = [];
    sidecar.notifications.on('notification', (value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'method' in value &&
        value.method === 'rag.progress' &&
        'params' in value &&
        typeof value.params === 'object' &&
        value.params !== null &&
        'id' in value.params &&
        'status' in value.params &&
        typeof value.params.id === 'string' &&
        typeof value.params.status === 'string'
      )
        progress.push({ id: value.params.id, status: value.params.status });
    });
    const ingest = await sidecar.call('rag.ingest', { projectId, paths: ['docs'] });
    expect(ingest.error).toBeUndefined();
    const job = z.object({ id: z.string() }).parse(ingest.result);
    await waitFor(() => progress.some((event) => event.id === job.id && event.status === 'indexed'));
    const listed = await sidecar.call('rag.listDocuments', { projectId });
    expect(listed.error).toBeUndefined();
    const docs = z
      .array(z.unknown())
      .parse(listed.result)
      .map((document) => sourceDocumentSchema.parse(document));
    expect(docs).toHaveLength(2);
    const vectorStore = new LanceDbVectorStore(resolve(sidecar.dataDir, 'lancedb'));
    const beforeDelete = await vectorStore.count(projectId);
    expect(beforeDelete.ok && beforeDelete.value).toBeGreaterThan(0);
    const ledgerBefore = await sidecar.call('ledger.query', {
      projectId,
      purposes: [CostPurpose.EMBEDDING],
      limit: 100,
    });
    const ledgerRowsBefore = z.object({ items: z.array(z.unknown()) }).parse(ledgerBefore.result).items;
    expect(ledgerRowsBefore.length).toBeGreaterThan(0);

    const second = await sidecar.call('rag.ingest', { projectId, paths: ['docs'] });
    const secondJob = z.object({ id: z.string() }).parse(second.result);
    await waitFor(() => progress.some((event) => event.id === secondJob.id && event.status === 'indexed'));
    const ledgerAfter = await sidecar.call('ledger.query', {
      projectId,
      purposes: [CostPurpose.EMBEDDING],
      limit: 100,
    });
    expect(z.object({ items: z.array(z.unknown()) }).parse(ledgerAfter.result).items).toHaveLength(
      ledgerRowsBefore.length,
    );

    const documentToDelete = docs[0];
    if (documentToDelete === undefined) throw new Error('Expected at least one indexed document.');
    const deletion = await sidecar.call('rag.deleteDocument', { documentId: documentToDelete.id });
    expect(deletion.result).toEqual({ deleted: true });
    const afterDelete = await vectorStore.count(projectId);
    expect(afterDelete.ok && afterDelete.value).toBeLessThan(beforeDelete.ok ? beforeDelete.value : 0);
    const remaining = await sidecar.call('rag.listDocuments', { projectId });
    expect(remaining.result).toHaveLength(1);
  }, 60_000);
});
