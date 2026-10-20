import { vi } from 'vitest';
import { processIdSchema } from '../validation/brand.js';
import { NO_PROCESS_TRACKER, type IProcessTracker } from '../ports/process-tracker.js';

export function createProcessProbe() {
  const start = vi.fn<IProcessTracker['start']>(() => processIdSchema.parse('10000000-0000-4000-8000-000000000001'));
  const module = vi.fn<IProcessTracker['module']>();
  const status = vi.fn<IProcessTracker['status']>();
  const end = vi.fn<IProcessTracker['end']>();
  const annotate = vi.fn<IProcessTracker['annotate']>();
  const tracker: IProcessTracker = { ...NO_PROCESS_TRACKER, start, module, status, end, annotate };
  return { tracker, start, module, status, end, annotate };
}
