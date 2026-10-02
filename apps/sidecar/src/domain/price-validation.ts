import type { ModelKey, PriceEntry, PriceTable } from '@itstudio/schemas';

const MAX_RATE = 1_000_000_000;
const RATE_FIELDS = [
  'inputPerMTokMicroUsd',
  'outputPerMTokMicroUsd',
  'cachedInputPerMTokMicroUsd',
  'perImageMicroUsd',
] as const;

export interface PriceValidationResult {
  readonly valid: boolean;
  readonly entries: readonly PriceEntry[];
  readonly deltas: readonly {
    readonly modelKey: ModelKey;
    readonly field: keyof PriceEntry;
    readonly percent: number;
  }[];
  readonly unknownModels: readonly ModelKey[];
  readonly changed: boolean;
}

export function validatePriceEntries(
  provider: string,
  proposed: readonly PriceEntry[],
  current: PriceTable,
  knownModels: ReadonlySet<ModelKey>,
  maxChangePercent: number,
  preservedModels: ReadonlySet<ModelKey> = new Set(),
): PriceValidationResult {
  const currentByKey = new Map(current.entries.map((entry) => [entry.modelKey, entry]));
  const accepted: PriceEntry[] = [];
  const deltas: PriceValidationResult['deltas'][number][] = [];
  const unknownModels: ModelKey[] = [];
  let valid = true;
  let changed = false;
  const seen = new Set<ModelKey>();

  for (const item of proposed) {
    const entry = item;
    if (
      !Number.isInteger(entry.inputPerMTokMicroUsd) ||
      entry.inputPerMTokMicroUsd < 0 ||
      !Number.isInteger(entry.outputPerMTokMicroUsd) ||
      entry.outputPerMTokMicroUsd < 0 ||
      !Number.isInteger(entry.cachedInputPerMTokMicroUsd) ||
      entry.cachedInputPerMTokMicroUsd < 0 ||
      (entry.perImageMicroUsd !== undefined &&
        (!Number.isInteger(entry.perImageMicroUsd) || entry.perImageMicroUsd < 0)) ||
      entry.inputPerMTokMicroUsd > MAX_RATE ||
      entry.outputPerMTokMicroUsd > MAX_RATE ||
      entry.cachedInputPerMTokMicroUsd > MAX_RATE ||
      (entry.perImageMicroUsd ?? 0) > MAX_RATE
    ) {
      valid = false;
      continue;
    }
    if (!knownModels.has(entry.modelKey)) {
      unknownModels.push(entry.modelKey);
      continue;
    }
    if (entry.modelKey.split('/')[0] !== provider) continue;
    if (seen.has(entry.modelKey)) {
      valid = false;
      continue;
    }
    seen.add(entry.modelKey);
    if (preservedModels.has(entry.modelKey)) continue;

    accepted.push(entry);
    const previous = currentByKey.get(entry.modelKey);
    if (previous === undefined || !sameEntry(previous, entry)) changed = true;
    for (const field of RATE_FIELDS) {
      const newRate = entry[field] ?? 0;
      const oldRate = previous?.[field] ?? 0;
      const percent = oldRate === 0 ? (newRate === 0 ? 0 : 100) : ((newRate - oldRate) / oldRate) * 100;
      if (newRate !== oldRate) deltas.push({ modelKey: entry.modelKey, field, percent });
      if (Math.abs(percent) > maxChangePercent) valid = false;
    }
  }

  return { valid, entries: accepted, deltas, unknownModels, changed };
}

function sameEntry(left: PriceEntry, right: PriceEntry): boolean {
  return (
    left.modelKey === right.modelKey &&
    left.inputPerMTokMicroUsd === right.inputPerMTokMicroUsd &&
    left.outputPerMTokMicroUsd === right.outputPerMTokMicroUsd &&
    left.cachedInputPerMTokMicroUsd === right.cachedInputPerMTokMicroUsd &&
    left.perImageMicroUsd === right.perImageMicroUsd &&
    left.freeTier === right.freeTier &&
    left.sourceUrl === right.sourceUrl
  );
}
