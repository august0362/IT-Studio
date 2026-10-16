import { OrchRole, OrchTransport, type OrchUsage, type Result } from '@itstudio/schemas';
import type { AgentEnvelope, AgentEvent, AgentOutput, IAgentExecutionAdapter } from '../../../ports/agent-execution.js';
export type MockScript = (input: unknown, envelope: AgentEnvelope) => Promise<unknown>;
const usage: OrchUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown',
  costMicroUsd: null,
  billing: 'unknown',
};
export class MockAgentAdapter implements IAgentExecutionAdapter {
  readonly id = OrchTransport.MOCK;
  private readonly scripts: Partial<Record<(typeof OrchRole)[keyof typeof OrchRole], MockScript>>;
  constructor(scripts: Partial<Record<(typeof OrchRole)[keyof typeof OrchRole], MockScript>> = {}) {
    this.scripts = scripts;
  }
  probe() {
    return Promise.resolve({ status: 'available' as const, version: 'scripted-mock' });
  }
  capabilities() {
    return {
      roles: [OrchRole.SUPERVISOR, OrchRole.WORKER, OrchRole.REVIEWER],
      structuredOutput: true,
      usage: false,
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
    const payload = (await this.scripts[envelope.roleId]?.(input, envelope)) ?? {};
    if (signal.aborted)
      return { ok: false, error: { code: 'CANCELLED', message: 'Mock attempt cancelled.', retryable: false } };
    return {
      ok: true,
      value: {
        ack: {
          ack: true,
          roleId: envelope.roleId,
          taskId: envelope.taskId,
          attemptId: envelope.attemptId,
          allowedPaths: envelope.allowedPaths,
        },
        payload,
        usage,
      },
    };
  }
}
