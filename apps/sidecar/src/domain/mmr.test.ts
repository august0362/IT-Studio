import { describe, expect, it } from 'vitest';
import { cosineSimilarity, rerankMmr, type MmrCandidate } from './mmr.js';

const candidates: readonly MmrCandidate[] = [
  { chunkId: 'b', score: 0.9, vector: [1, 0] },
  { chunkId: 'a', score: 0.9, vector: [1, 0] },
  { chunkId: 'c', score: 0.8, vector: [0, 1] },
];

describe('rerankMmr', () => {
  it('uses relevance order at lambda 1 and stable chunk id ties', () => {
    expect(rerankMmr(candidates, 4, 1).map((item) => item.chunkId)).toEqual(['a', 'b', 'c']);
    expect(rerankMmr(candidates, 8, 1)).toHaveLength(3);
  });

  it('maximizes diversity after the first relevant item at lambda 0', () => {
    expect(rerankMmr(candidates, 3, 0).map((item) => item.chunkId)).toEqual(['a', 'c', 'b']);
  });

  it('pushes duplicate vectors down and handles invalid arguments', () => {
    expect(rerankMmr(candidates, 2, 0.7).map((item) => item.chunkId)).toEqual(['a', 'c']);
    expect(rerankMmr(candidates, 0)).toEqual([]);
    expect(rerankMmr(candidates, 2, 2)).toEqual([]);
    expect(rerankMmr([], 2)).toEqual([]);
  });

  it('handles cosine edge cases and deterministically resolves MMR score ties', () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0], [1])).toBe(0);
    expect(cosineSimilarity({ length: 1 }, [1])).toBe(0);
    expect(cosineSimilarity([1], { length: 1 })).toBe(0);
    const tied: readonly MmrCandidate[] = [
      { chunkId: 'z', score: 2, vector: [1, 0] },
      { chunkId: 'b', score: 1, vector: [1, 0] },
      { chunkId: 'a', score: 0, vector: [0, 1] },
    ];
    expect(rerankMmr(tied, 2, 0.5).map((item) => item.chunkId)).toEqual(['z', 'a']);
    const tiedWithLargerId: readonly MmrCandidate[] = [
      { chunkId: 'x', score: 2, vector: [1, 0] },
      { chunkId: 'a', score: 1, vector: [1, 0] },
      { chunkId: 'z', score: 0, vector: [0, 1] },
    ];
    expect(rerankMmr(tiedWithLargerId, 2, 0.5).map((item) => item.chunkId)).toEqual(['x', 'a']);
    const sparse: MmrCandidate[] = [];
    sparse.length = 1;
    expect(rerankMmr(sparse, 1)).toEqual([]);
    const sparseWithUnrankable: MmrCandidate[] = [];
    sparseWithUnrankable.length = 2;
    sparseWithUnrankable[1] = { chunkId: 'unrankable', score: Number.NEGATIVE_INFINITY, vector: [1] };
    expect(rerankMmr(sparseWithUnrankable, 1)).toMatchObject([{ chunkId: 'unrankable' }]);
  });
});
