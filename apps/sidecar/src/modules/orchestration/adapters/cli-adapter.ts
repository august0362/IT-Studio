import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ErrorCode, OrchRole, OrchTransport, type OrchUsage, type Result } from '@itstudio/schemas';
import type { IProcessRunner } from '../../../kernel/ports/process-runner.js';
import type {
  AgentEnvelope,
  AgentEvent,
  AgentOutput,
  IAgentExecutionAdapter,
} from '../../../kernel/ports/agent-execution.js';
import { agentAcknowledgement, buildAgentPrompt, extractJsonObjects } from '../prompts.js';

const unknownUsage: OrchUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown',
  costMicroUsd: null,
  billing: 'unknown',
};
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Tools a Claude Code agent may never use here: IT Studio applies changes itself. */
const CLAUDE_DISALLOWED_TOOLS = 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch';
type Cli = 'claude' | 'codex';
const probes = new Map<string, { until: number; result: Awaited<ReturnType<IAgentExecutionAdapter['probe']>> }>();

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

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function cliUsage(usage: Record<string, unknown>, input: string, cached: string, output: string, reasoning?: string) {
  return {
    inputTokens: count(usage[input]),
    outputTokens: count(usage[output]),
    cachedInputTokens: count(usage[cached]),
    reasoningTokens: reasoning === undefined ? null : count(usage[reasoning]),
    source: 'cli' as const,
    costMicroUsd: null,
    billing: 'subscription' as const,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Claude Code `--output-format json` prints one result object whose `result` holds the agent text. */
export function parseClaudeOutput(
  stdout: string,
): Result<{ readonly objects: readonly unknown[]; readonly usage: OrchUsage }> {
  const outer = extractJsonObjects(stdout).find((value) => isRecord(value) && typeof value.result === 'string');
  if (!isRecord(outer) || typeof outer.result !== 'string')
    return {
      ok: false,
      error: { code: ErrorCode.VALIDATION, message: 'Claude CLI returned no result.', retryable: false },
    };
  if (outer.is_error === true)
    return {
      ok: false,
      error: {
        code: ErrorCode.COMMAND_FAILED,
        message: `Claude CLI reported an error: ${outer.result.slice(0, 300)}`,
        retryable: false,
      },
    };
  const usage = isRecord(outer.usage)
    ? cliUsage(outer.usage, 'input_tokens', 'cache_read_input_tokens', 'output_tokens')
    : { ...unknownUsage, source: 'cli' as const, billing: 'subscription' as const };
  return { ok: true, value: { objects: extractJsonObjects(outer.result), usage } };
}

/** Codex `exec --json` prints JSONL events; the last `turn.completed` carries the token usage. */
export function parseCodexUsage(stdout: string): OrchUsage {
  let usage: OrchUsage = { ...unknownUsage, source: 'cli', billing: 'subscription' };
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.includes('turn.completed')) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event) && event.type === 'turn.completed' && isRecord(event.usage))
        usage = cliUsage(
          event.usage,
          'input_tokens',
          'cached_input_tokens',
          'output_tokens',
          'reasoning_output_tokens',
        );
    } catch {
      /* Not an event line. */
    }
  }
  return usage;
}

function hasModel(modelId: string): boolean {
  return modelId.length > 0 && modelId !== 'mock';
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
      timeoutMs: 15_000,
    });
    const help = await this.runner.run({
      executable: this.cli,
      args: this.cli === 'claude' ? ['--help'] : ['exec', '--help'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 15_000,
    });
    if (!version.ok || version.value.exitCode !== 0 || !help.ok || help.value.exitCode !== 0)
      return this.cache({ status: 'unavailable', reason: `${this.cli} version/help probe failed.` });
    const flags =
      this.cli === 'claude'
        ? ['-p', '--output-format', '--model', '--disallowedTools']
        : ['-C', '-m', '--json', '-o', '--sandbox', '--skip-git-repo-check'];
    const missing = flags.filter((flag) => !help.value.stdoutTail.includes(flag));
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
    const prompt = buildAgentPrompt(envelope, input, { withAck: true });
    // Never run an agent inside IT Studio's own directory: without a worktree it gets an empty scratch folder.
    const scratch = envelope.assignedWorktree === null ? await mkdtemp(join(tmpdir(), 'itstudio-orch-')) : undefined;
    const cwd = envelope.assignedWorktree ?? scratch ?? tmpdir();
    const outputFile = this.cli === 'codex' ? join(tmpdir(), `itstudio-codex-${randomUUID()}.txt`) : undefined;
    const model = hasModel(envelope.modelId) ? envelope.modelId : undefined;
    const args =
      this.cli === 'claude'
        ? [
            '-p',
            '--output-format',
            'json',
            ...(model === undefined ? [] : ['--model', model]),
            '--disallowedTools',
            CLAUDE_DISALLOWED_TOOLS,
          ]
        : [
            'exec',
            '-C',
            cwd,
            ...(model === undefined ? [] : ['-m', model]),
            '--sandbox',
            'read-only',
            '--skip-git-repo-check',
            '--json',
            '-o',
            outputFile ?? '',
            '-',
          ];
    onEvent({ type: 'started' });
    try {
      const result = await this.runner.run({
        executable: this.cli,
        args,
        cwd,
        env: process.env,
        timeoutMs: envelope.timeoutMs,
        signal,
        stdin: prompt,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      if (!result.ok) return result;
      if (result.value.timedOut)
        return {
          ok: false,
          error: { code: ErrorCode.PROVIDER_TIMEOUT, message: `${this.cli} did not finish in time.`, retryable: true },
        };
      if (result.value.exitCode !== 0)
        return {
          ok: false,
          error: {
            code: ErrorCode.COMMAND_FAILED,
            message: `${this.cli} exited with code ${String(result.value.exitCode)}: ${result.value.stderrTail.trim().slice(-300)}`,
            retryable: false,
          },
        };
      let objects: readonly unknown[];
      let usage: OrchUsage;
      if (this.cli === 'claude') {
        const parsed = parseClaudeOutput(result.value.stdoutTail);
        if (!parsed.ok) return parsed;
        objects = parsed.value.objects;
        usage = parsed.value.usage;
      } else {
        let lastMessage: string;
        try {
          lastMessage = await readFile(outputFile ?? '', 'utf8');
        } catch {
          return {
            ok: false,
            error: { code: ErrorCode.VALIDATION, message: 'Codex CLI wrote no final message.', retryable: false },
          };
        }
        objects = extractJsonObjects(lastMessage);
        usage = parseCodexUsage(result.value.stdoutTail);
      }
      const ackIndex = objects.findIndex((value) => isRecord(value) && value.ack === true);
      const ack = objects[ackIndex];
      if (ackIndex < 0 || !ackMatches(ack, envelope))
        return {
          ok: false,
          error: {
            code: ErrorCode.VALIDATION,
            message: 'Agent acknowledgement did not match its assignment.',
            retryable: false,
          },
        };
      const payload = objects[ackIndex + 1];
      if (payload === undefined)
        return {
          ok: false,
          error: { code: ErrorCode.VALIDATION, message: 'CLI returned no payload JSON.', retryable: false },
        };
      onEvent({ type: 'completed' });
      // Return the canonical acknowledgement: the agent may have reordered its keys.
      return { ok: true, value: { ack: agentAcknowledgement(envelope), payload, usage } };
    } finally {
      if (outputFile !== undefined) await rm(outputFile, { force: true }).catch(() => undefined);
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
