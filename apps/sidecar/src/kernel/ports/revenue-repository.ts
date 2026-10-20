import type { ProjectId, RevenueEntry } from '@itstudio/schemas';

export interface RevenueRange {
  readonly projectId: ProjectId;
  readonly from: string;
  readonly to: string;
}

export interface IRevenueRepository {
  insert(entry: RevenueEntry): Promise<void>;
  list(range: RevenueRange): Promise<readonly RevenueEntry[]>;
}
