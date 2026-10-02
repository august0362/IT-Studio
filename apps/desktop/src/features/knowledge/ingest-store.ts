import { IngestStatus, type IngestJob, type IngestJobId } from '@itstudio/schemas';

export interface IngestState {
  readonly jobs: Readonly<Record<string, IngestJob>>;
  readonly skippedUnchanged: number;
}

export const initialIngestState: IngestState = { jobs: {}, skippedUnchanged: 0 };

const terminal = new Set<IngestJob['status']>([
  IngestStatus.INDEXED,
  IngestStatus.FAILED,
  IngestStatus.SKIPPED_UNCHANGED,
]);
const stage: Readonly<Record<IngestJob['status'], number>> = {
  [IngestStatus.QUEUED]: 0,
  [IngestStatus.PARSING]: 1,
  [IngestStatus.CHUNKING]: 2,
  [IngestStatus.EMBEDDING]: 3,
  [IngestStatus.INDEXED]: 4,
  [IngestStatus.FAILED]: 4,
  [IngestStatus.SKIPPED_UNCHANGED]: 4,
};

export function ingestReducer(state: IngestState, job: IngestJob): IngestState {
  const previous = state.jobs[job.id];
  if (previous !== undefined && terminal.has(previous.status)) return state;
  if (previous !== undefined && job.processedFiles < previous.processedFiles) return state;
  if (previous !== undefined && stage[job.status] < stage[previous.status]) return state;
  const skipped = job.status === IngestStatus.SKIPPED_UNCHANGED && previous?.status !== IngestStatus.SKIPPED_UNCHANGED;
  return {
    jobs: { ...state.jobs, [job.id]: job },
    skippedUnchanged: state.skippedUnchanged + (skipped ? 1 : 0),
  };
}

export function findIngestJob(state: IngestState, id: IngestJobId): IngestJob | undefined {
  return state.jobs[id];
}
