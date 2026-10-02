export interface DiffEntry {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

/** An insertion-ordered LRU store used by the virtual diff documents. */
export class DiffContentStore {
  private readonly entries = new Map<string, DiffEntry>();
  private readonly capacity: number;

  public constructor(capacity = 20) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Diff capacity must be a positive integer');
    this.capacity = capacity;
  }

  public set(id: string, entry: DiffEntry): void {
    this.entries.delete(id);
    this.entries.set(id, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  public get(id: string): DiffEntry | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  public get size(): number {
    return this.entries.size;
  }
}
