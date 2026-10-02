import { IngestStatus, type IngestJob } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { findIngestJob, ingestReducer, initialIngestState } from './ingest-store';

const job = (overrides: Partial<IngestJob> = {}): IngestJob => ({
  id: 'job-1' as IngestJob['id'],
  projectId: 'p-1' as IngestJob['projectId'],
  paths: ['doc.md'],
  status: IngestStatus.QUEUED,
  processedFiles: 0,
  totalFiles: 1,
  cost: 0 as IngestJob['cost'],
  ...overrides,
});

describe('ingestReducer', () => {
  it.each([
    ['progress', [job(), job({ status: IngestStatus.EMBEDDING, processedFiles: 1 })], IngestStatus.EMBEDDING],
    ['unknown job', [job({ id: 'other' as IngestJob['id'] })], IngestStatus.QUEUED],
    [
      'terminal indexed',
      [job({ status: IngestStatus.INDEXED }), job({ status: IngestStatus.FAILED })],
      IngestStatus.INDEXED,
    ],
    [
      'terminal failed',
      [job({ status: IngestStatus.FAILED }), job({ status: IngestStatus.EMBEDDING })],
      IngestStatus.FAILED,
    ],
    [
      'terminal skipped',
      [job({ status: IngestStatus.SKIPPED_UNCHANGED }), job({ status: IngestStatus.INDEXED })],
      IngestStatus.SKIPPED_UNCHANGED,
    ],
    [
      'out of order events',
      [
        job({ status: IngestStatus.EMBEDDING, processedFiles: 1 }),
        job({ status: IngestStatus.PARSING, processedFiles: 0 }),
      ],
      IngestStatus.EMBEDDING,
    ],
    [
      'older stage at the same processed count',
      [
        job({ status: IngestStatus.CHUNKING, processedFiles: 0 }),
        job({ status: IngestStatus.PARSING, processedFiles: 0 }),
      ],
      IngestStatus.CHUNKING,
    ],
  ])('handles %s', (_name, events, expected) => {
    const result = events.reduce(ingestReducer, initialIngestState);
    expect(Object.values(result.jobs)[0]?.status).toBe(expected);
  });

  it('counts skipped unchanged once and ignores unknown lookups', () => {
    const skipped = job({ status: IngestStatus.SKIPPED_UNCHANGED });
    const state = ingestReducer(ingestReducer(initialIngestState, skipped), skipped);
    expect(state.skippedUnchanged).toBe(1);
    expect(findIngestJob(state, skipped.id)).toEqual(skipped);
    expect(findIngestJob(state, 'missing' as IngestJob['id'])).toBeUndefined();
  });
});
