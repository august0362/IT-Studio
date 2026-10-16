import { ErrorCode, OrchRole, OrchTransport, type OrchUsage, type Result } from '@itstudio/schemas';
import type { IProcessRunner } from '../../../ports/process-runner.js';
import type { AgentEnvelope, AgentEvent, AgentOutput, IAgentExecutionAdapter } from '../../../ports/agent-execution.js';

const unknownUsage: OrchUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown',
  costMicroUsd: null,
  billing: 'unknown',
};
type Cli = 'claude' | 'codex';
const probes = new Map<string, { until: number; result: Awaited<ReturnType<IAgentExecutionAdapter['probe']>> }>();
function parseObjects(text: string): readonly unknown[] {
  const values: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null) values.push(value);
    } catch {
      /* CLI logs may not be JSON. */
    }
  }
  if (values.length === 0) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === 'object' && value !== null) values.push(value);
    } catch {
      /* handled below */
    }
  }
  return values;
}
function ackMatches(ack: unknown, envelope: AgentEnvelope): boolean {
  if (typeof ack !== 'object' || ack === null) return false;
  const value = ack as Record<string, unknown>;
  return (
    value.ack === true &&
    value.roleId === envelope.roleId &&
    value.taskId === envelope.taskId &&
    value.attemptId === envelope.attemptId &&
    JSON.stringify(value.allowedPaths) === JSON.stringify(envelope.allowedPaths)
  );
}
export class CliAgentAdapter implements IAgentExecutionAdapter {
  readonly id: OrchTransport;
  private readonly runner: IProcessRunner;
  private readonly cli: Cli;
  constructor(cli: Cli, runner: IProcessRunner) {
    this.cli = cli;
    this.runner = runner;
    this.id = cli === 'claude' ? OrchTransport.CLAUDE_CLI : OrchTransport.CODEX_CLI;
  }
  async probe(): Promise<{
    readonly status: 'available' | 'unavailable' | 'unsupported';
    readonly version?: string;
    readonly reason?: string;
  }> {
    const cached = probes.get(this.cli);
    if (cached !== undefined && cached.until > Date.now()) return cached.result;
    const where = await this.runner.run({
      executable: 'where.exe',
      args: [this.cli],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
    });
    if (!where.ok || where.value.exitCode !== 0)
      return this.cache({ status: 'unavailable', reason: `${this.cli} was not found on PATH.` });
    const version = await this.runner.run({
      executable: this.cli,
      args: ['--version'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
    });
    const help = await this.runner.run({
      executable: this.cli,
      args: ['--help'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
    });
    if (!version.ok || version.value.exitCode !== 0 || !help.ok || help.value.exitCode !== 0)
      return this.cache({ status: 'unavailable', reason: `${this.cli} version/help probe failed.` });
    const flags = this.cli === 'claude' ? ['-p', '--output-format', '--model'] : ['exec', '-C', '-m', '--json', '-o'];
    const missing = flags.filter((flag) => !(version.value.stdoutTail + help.value.stdoutTail).includes(flag));
    if (missing.length)
      return this.cache({
        status: 'unsupported',
        version: version.value.stdoutTail.trim(),
        reason: `Required CLI flags missing: ${missing.join(', ')}.`,
      });
    return this.cache({ status: 'available', version: version.value.stdoutTail.trim() });
  }
  private cache(result: Awaited<ReturnType<IAgentExecutionAdapter['probe']>>) {
    probes.set(this.cli, { result, until: Date.now() + 300_000 });
    return result;
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
    const prompt = `Return first an acknowledgement JSON, then the payload JSON. Acknowledgement must exactly match: ${JSON.stringify({ ack: true, roleId: envelope.roleId, taskId: envelope.taskId, attemptId: envelope.attemptId, allowedPaths: envelope.allowedPaths })}\nEnvelope: ${JSON.stringify(envelope)}\nInput: ${JSON.stringify(input)}`;
    const args =
      this.cli === 'claude'
        ? [
            '-p',
            prompt,
            '--output-format',
            'json',
            '--model',
            envelope.modelId,
            ...(envelope.roleId === 'supervisor' ? ['--disallowedTools', 'Edit,Bash'] : []),
          ]
        : ['exec', '-C', envelope.assignedWorktree ?? process.cwd(), '-m', envelope.modelId, '--json', '-o', ''];
    if (this.cli === 'codex') args[args.length - 1] = prompt;
    onEvent({ type: 'started' });
    const result = await this.runner.run({
      executable: this.cli,
      args,
      cwd: envelope.assignedWorktree ?? process.cwd(),
      env: process.env,
      timeoutMs: envelope.timeoutMs,
      signal,
    });
    if (!result.ok) return result;
    if (result.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: `${this.cli} exited unsuccessfully.`, retryable: false },
      };
    const objects = parseObjects(result.value.stdoutTail);
    const ack = objects[0];
    const payload = objects[1];
    if (!ackMatches(ack, envelope))
      return {
        ok: false,
        error: {
          code: ErrorCode.VALIDATION,
          message: 'Agent acknowledgement did not match its assignment.',
          retryable: false,
        },
      };
    if (payload === undefined)
      return {
        ok: false,
        error: { code: ErrorCode.VALIDATION, message: 'CLI returned no payload JSON.', retryable: false },
      };
    onEvent({ type: 'completed' });
    return { ok: true, value: { ack, payload, usage: unknownUsage } };
  }
}
