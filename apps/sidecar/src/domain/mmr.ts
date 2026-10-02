export interface MmrCandidate {
  readonly chunkId: string;
  readonly score: number;
  readonly vector: ArrayLike<number>;
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rerankMmr<T extends MmrCandidate>(candidates: readonly T[], topK: number, lambda = 0.7): readonly T[] {
  if (!Number.isInteger(topK) || topK <= 0 || candidates.length === 0) return [];
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) return [];
  const remaining = [...candidates].sort(
    (left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId),
  );
  const selected: T[] = [];
  while (remaining.length > 0 && selected.length < topK) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (candidate === undefined) continue;
      const redundancy = selected.reduce(
        (maximum, chosen) => Math.max(maximum, cosineSimilarity(candidate.vector, chosen.vector)),
        Number.NEGATIVE_INFINITY,
      );
      const value = lambda * candidate.score - (1 - lambda) * (selected.length === 0 ? 0 : redundancy);
      const bestCandidate = remaining[bestIndex];
      const winsTie = bestCandidate !== undefined && candidate.chunkId.localeCompare(bestCandidate.chunkId) < 0;
      if (value > bestValue || (value === bestValue && winsTie)) {
        bestIndex = index;
        bestValue = value;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    if (next !== undefined) selected.push(next);
  }
  return selected;
}
