import { beforeEach, describe, expect, it } from 'vitest';
import type { IVectorStore, VectorChunkRow } from '../../ports/vector-store.js';

const projectId = '10000000-0000-4000-8000-000000000001';
const documentA = '20000000-0000-4000-8000-000000000001';
const documentB = '20000000-0000-4000-8000-000000000002';
const chunkA = '30000000-0000-4000-8000-000000000001';
const chunkB = '30000000-0000-4000-8000-000000000002';
const chunkC = '30000000-0000-4000-8000-000000000003';

export function vectorStoreContract(name: string, store: IVectorStore): void {
  describe(`${name} vector store contract`, () => {
    beforeEach(async () => {
      const dropped = await store.dropTable(projectId);
      expect(dropped.ok).toBe(true);
    });

    it('orders by cosine score, applies minScore and topK, and replaces duplicate chunk ids', async () => {
      const initial = await store.upsertChunks(projectId, [
        { ...row(chunkA, documentA, [1, 0], 'near'), tags: ['chosen'] },
        row(chunkB, documentB, [0, 1], 'far'),
        row(chunkC, documentA, [0.8, 0.2], 'middle'),
      ]);
      expect(initial.ok).toBe(true);
      expect((await store.upsertChunks(projectId, [row(chunkB, documentB, [1, 0], 'replaced')])).ok).toBe(true);
      const result = await store.search(projectId, [1, 0], { topK: 2, minScore: 0.8 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.map((hit) => hit.chunkId)).toEqual([chunkA, chunkB]);
        expect(result.value.map((hit) => hit.vector)).toEqual([
          [1, 0],
          [1, 0],
        ]);
      }
      const count = await store.count(projectId);
      expect(count).toEqual({ ok: true, value: 3 });
      const replaced = await store.search(projectId, [1, 0], { topK: 3, minScore: 0 });
      expect(replaced.ok && replaced.value.find((hit) => hit.chunkId === chunkB)?.text).toBe('replaced');
      const tagged = await store.search(projectId, [1, 0], { topK: 3, minScore: 0, tagFilter: ['chosen'] });
      expect(tagged.ok && tagged.value.map((hit) => hit.chunkId)).toEqual([chunkA]);
    });

    it('deletes all chunks belonging to one document and filters by document ids', async () => {
      expect(
        (await store.upsertChunks(projectId, [row(chunkA, documentA, [1, 0]), row(chunkB, documentB, [1, 0])])).ok,
      ).toBe(true);
      const filtered = await store.search(projectId, [1, 0], { topK: 5, minScore: 0, documentIds: [documentB] });
      expect(filtered.ok && filtered.value.map((hit) => hit.documentId)).toEqual([documentB]);
      expect((await store.deleteByDocument(projectId, documentA)).ok).toBe(true);
      expect(await store.count(projectId)).toEqual({ ok: true, value: 1 });
    });

    it('handles empty tables and rejects dimension mismatches and malicious ids', async () => {
      expect(await store.search(projectId, [1, 0], { topK: 4, minScore: 0 })).toEqual({ ok: true, value: [] });
      expect((await store.upsertChunks(projectId, [row(chunkA, documentA, [1, 0])])).ok).toBe(true);
      const mismatch = await store.upsertChunks(projectId, [row(chunkB, documentA, [1, 0, 0])]);
      expect(mismatch.ok).toBe(false);
      if (!mismatch.ok) {
        expect(mismatch.error.code).toBe('VALIDATION');
        expect(mismatch.error.message.includes('re-index required')).toBe(true);
      }
      const queryMismatch = await store.search(projectId, [1, 0, 0], { topK: 2, minScore: 0 });
      expect(queryMismatch).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
      const malicious = await store.search(projectId, [1, 0], { topK: 2, minScore: 0, documentIds: ["' OR 1=1 --"] });
      expect(malicious).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
      const badRow: VectorChunkRow = { ...row(chunkC, documentA, [1, 0]), chunkId: "'; DROP TABLE chunks --" };
      expect(await store.upsertChunks(projectId, [badRow])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    });
  });
}

function row(chunkId: string, documentId: string, vector: number[], text = chunkId): VectorChunkRow {
  return { chunkId, documentId, projectId, ordinal: Number(chunkId.at(-1)), text, sectionPath: ['Section'], vector };
}
