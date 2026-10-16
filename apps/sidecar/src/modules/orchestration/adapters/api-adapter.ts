import { OrchRole, OrchTransport, type OrchUsage, type Result } from '@itstudio/schemas';
import type { AgentEnvelope, AgentEvent, AgentOutput, IAgentExecutionAdapter } from '../../../ports/agent-execution.js';

export interface ApiAgentRequest {
  readonly envelope: AgentEnvelope;
  readonly input: unknown;
  readonly signal: AbortSignal;
}
export class ApiAgentAdapter implements IAgentExecutionAdapter {
  readonly id = OrchTransport.API;
  constructor(
    private readonly dispatch: (
      request: ApiAgentRequest,
    ) => Promise<Result<{ readonly payload: unknown; readonly usage: OrchUsage }>>,
  ) {}
  probe() {
    return Promise.resolve({ status: 'available' as const });
  }
  capabilities() {
    return {
      roles: [OrchRole.SUPERVISOR, OrchRole.WORKER, OrchRole.REVIEWER],
      structuredOutput: true,
      usage: true,
      cancel: true,
    };
  }
  async run(
    envelope: AgentEnvelope,
    input: unknown,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ): Promise<Result<AgentOutput>> {
    onEvent({ type: 'started' });
    const result = await this.dispatch({ envelope, input, signal });
    if (!result.ok) return result;
    const ack = {
      ack: true,
      roleId: envelope.roleId,
      taskId: envelope.taskId,
      attemptId: envelope.attemptId,
      allowedPaths: envelope.allowedPaths,
    };
    onEvent({ type: 'completed' });
    return { ok: true, value: { ack, payload: result.value.payload, usage: result.value.usage } };
  }
}
