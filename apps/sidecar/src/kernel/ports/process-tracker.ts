import type {
  ProcessId,
  ProcessKind,
  ProcessModule,
  ProcessRecord,
  ProcessStatus,
  ProjectId,
  Result,
  RpcMethodMap,
  ModelKey,
  ProviderId,
  GenerateImageArgs,
} from '@itstudio/schemas';

/** Private replay data. Never includes credentials, file contents or page content. */
export type ProcessOperation =
  | { readonly kind: 'chat'; readonly params: RpcMethodMap['chat.send']['params'] }
  | { readonly kind: 'code_pipeline'; readonly params: RpcMethodMap['pipeline.start']['params'] }
  | { readonly kind: 'knowledge_ingest'; readonly params: RpcMethodMap['rag.ingest']['params'] }
  | { readonly kind: 'image'; readonly params: { readonly projectId: ProjectId; readonly args: GenerateImageArgs } }
  | { readonly kind: 'price_update'; readonly params: { readonly projectId: ProjectId; readonly modelKey: ModelKey } }
  | { readonly kind: 'key_verify'; readonly params: { readonly provider: ProviderId } };

export interface ProcessInit {
  readonly title: string;
  readonly projectId?: ProjectId;
  readonly ref?: ProcessRecord['ref'];
  readonly operation?: ProcessOperation;
  readonly cancel?: () => Promise<Result<unknown>>;
  readonly retryOf?: ProcessId;
}
export interface IProcessTracker {
  start(kind: ProcessKind, init: ProcessInit): ProcessId | undefined;
  module(id: ProcessId | undefined, moduleId: string, patch: Partial<Omit<ProcessModule, 'id' | 'label'>>): void;
  status(id: ProcessId | undefined, status: ProcessStatus, reason?: string): void;
  end(id: ProcessId | undefined, result?: string): void;
  annotate(id: ProcessId | undefined, patch: Pick<Partial<ProcessRecord>, 'ref' | 'costText'>): void;
  find(kind: ProcessKind, refId: string): ProcessId | undefined;
}
export const NO_PROCESS_TRACKER: IProcessTracker = {
  start: () => undefined,
  module: () => undefined,
  status: () => undefined,
  end: () => undefined,
  annotate: () => undefined,
  find: () => undefined,
};

export interface StoredProcess {
  readonly process: ProcessRecord;
  readonly sequence: number;
  readonly operation?: ProcessOperation;
}
export interface IProcessRepository {
  load(): readonly StoredProcess[];
  save(records: readonly StoredProcess[], removed: readonly ProcessId[]): void;
}
