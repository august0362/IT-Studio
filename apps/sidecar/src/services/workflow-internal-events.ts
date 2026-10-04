import type {
  CommandRunId,
  ImageProviderId,
  ModelKey,
  PipelineRunId,
  ProjectId,
  WorkspaceRelativePath,
} from '@itstudio/schemas';

export type WorkflowInternalEvent =
  | {
      readonly type: 'retriever';
      readonly phase: 'started' | 'completed';
      readonly projectId: ProjectId;
      readonly hitCount?: number;
      readonly topScore?: number;
      readonly durationMs?: number;
    }
  | {
      readonly type: 'command';
      readonly phase: 'started' | 'finished';
      readonly projectId?: ProjectId;
      readonly pipelineRunId?: PipelineRunId;
      readonly commandRunId: CommandRunId;
      readonly executable: string;
      readonly argCount: number;
      readonly exitCode?: number | null;
      readonly durationMs?: number;
      readonly timedOut?: boolean;
    }
  | {
      readonly type: 'vscode';
      readonly phase: 'sent' | 'acked';
      readonly projectId: ProjectId;
      readonly action: 'reveal' | 'show_diff' | 'transaction' | 'notify';
      readonly path?: WorkspaceRelativePath;
    }
  | {
      readonly type: 'image';
      readonly phase: 'started' | 'completed' | 'failed';
      readonly projectId: ProjectId;
      readonly provider: ImageProviderId;
      readonly count: number;
      readonly cost?: number;
    }
  | {
      readonly type: 'embedding';
      readonly projectId: ProjectId;
      readonly modelKey: ModelKey;
      readonly chunkCount: number;
      readonly cost: number;
    };

export interface WorkflowInternalEventBus {
  publish(event: WorkflowInternalEvent): void;
  subscribe(handler: (event: WorkflowInternalEvent) => void): () => void;
}
