import type { OrchRole, OrchTransport, OrchUsage, Result } from '@itstudio/schemas';

export interface AgentEnvelope {
  readonly schemaVersion: string;
  readonly agentId: string;
  readonly roleId: OrchRole;
  readonly roleVersion: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly transportId: OrchTransport;
  readonly projectId: string;
  readonly orchestrationRunId: string;
  readonly taskId: string | null;
  readonly attemptId: string;
  readonly assignedWorktree: string | null;
  readonly allowedPaths: readonly string[];
  readonly approvedTools: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly reportingSchema: unknown;
  readonly budgetPolicy: unknown;
  readonly timeoutMs: number;
  readonly contextReferences: readonly string[];
}
export interface AgentOutput {
  readonly ack: unknown;
  readonly payload: unknown;
  readonly usage: OrchUsage;
}
export interface AgentEvent {
  readonly type: string;
  readonly data?: unknown;
}
export interface IAgentExecutionAdapter {
  readonly id: OrchTransport;
  probe(): Promise<{
    readonly status: 'available' | 'unavailable' | 'unsupported';
    readonly version?: string;
    readonly reason?: string;
  }>;
  capabilities(): {
    readonly roles: OrchRole[];
    readonly structuredOutput: boolean;
    readonly usage: boolean;
    readonly cancel: boolean;
  };
  run(
    envelope: AgentEnvelope,
    input: unknown,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<Result<AgentOutput>>;
}
