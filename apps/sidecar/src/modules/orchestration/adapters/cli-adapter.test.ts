import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEnvelope } from '../../../ports/agent-execution.js';
import type { IProcessRunner, ProcessRunInput } from '../../../ports/process-runner.js';
import { agentAcknowledgement } from '../prompts.js';
import { CliAgentAdapter, parseClaudeOutput, parseCodexUsage } from './cli-adapter.js';

const envelope: AgentEnvelope = {
  schemaVersion: '1',
  agentId: 'r',
  roleId: 'reviewer',
  roleVersion: '1',
  modelId: 'mock',
  providerId: 'mock',
  transportId: 'claude-cli',
  projectId: 'p',
  orchestrationRunId: 'run',
  taskId: 'T1',
  attemptId: 'a1',
  assignedWorktree: null,
  allowedPaths: ['src/**'],
  approvedTools: [],
  forbiddenActions: ['write-to-disk'],
  objective: 'Review',
  requirements: [],
  acceptanceCriteria: [],
  reportingSchema: {},
  budgetPolicy: {},
  timeoutMs: 5000,
  contextReferences: [],
};
const verdict = { verdict: 'pass', findings: [], summary: 'ok' };

function runner(handler: (input: ProcessRunInput) => Promise<{ exitCode: number; stdout: string; stderr?: string }>) {
  const calls: ProcessRunInput[] = [];
  const fake: IProcessRunner = {
    run: async (input) => {
      calls.push(input);
      const out = await handler(input);
      return {
        ok: true,
        value: {
          exitCode: out.exitCode,
          timedOut: false,
          durationMs: 1,
          stdoutTail: out.stdout,
          stderrTail: out.stderr ?? '',
        },
      };
    },
  };
  return { fake, calls };
}

describe('CliAgentAdapter', () => {
  it('runs claude read-only with the prompt on stdin, outside IT Studio, and returns ack, payload and usage', async () => {
    // Agent writes the ack with reordered keys and a fenced payload.
    const result = `{"attemptId":"a1","taskId":"T1","roleId":"reviewer","ack":true,"allowedPaths":["src/**"]}\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``;
    const { fake, calls } = runner(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          type: 'result',
          is_error: false,
          result,
          usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 },
        }),
      }),
    );
    const output = await new CliAgentAdapter('claude', fake).run(
      envelope,
      { diff: '' },
      new AbortController().signal,
      () => undefined,
    );
    expect(output).toEqual({
      ok: true,
      value: {
        ack: agentAcknowledgement(envelope),
        payload: verdict,
        usage: {
          inputTokens: 12,
          outputTokens: 7,
          cachedInputTokens: 3,
          reasoningTokens: null,
          source: 'cli',
          costMicroUsd: null,
          billing: 'subscription',
        },
      },
    });
    const call = calls[0];
    expect(call?.executable).toBe('claude');
    expect(call?.args.slice(0, 4)).toEqual(['-p', '--output-format', 'json', '--disallowedTools']);
    expect(call?.args[4]).toContain('Bash');
    expect(call?.stdin).toContain('Acknowledgement:');
    expect(call?.cwd).not.toBe(process.cwd());
    expect(call?.cwd).toMatch(/itstudio-orch-/u);
  });

  it('passes the configured model and the assigned worktree to codex and reads the final message file', async () => {
    const { fake, calls } = runner(async (input) => {
      const file = input.args[input.args.indexOf('-o') + 1] ?? '';
      await writeFile(file, `${JSON.stringify(agentAcknowledgement(envelope))}\n${JSON.stringify(verdict)}`);
      return {
        exitCode: 0,
        stdout: '{"type":"turn.completed","usage":{"input_tokens":5,"cached_input_tokens":1,"output_tokens":2}}',
      };
    });
    const output = await new CliAgentAdapter('codex', fake).run(
      { ...envelope, modelId: 'gpt-5.3-codex', assignedWorktree: 'C:/wt/T1' },
      {},
      new AbortController().signal,
      () => undefined,
    );
    expect(output.ok && output.value.payload).toEqual(verdict);
    expect(output.ok && output.value.usage.inputTokens).toBe(5);
    const call = calls[0];
    expect(call?.cwd).toBe('C:/wt/T1');
    expect(call?.args.slice(0, 9)).toEqual([
      'exec',
      '-C',
      'C:/wt/T1',
      '-m',
      'gpt-5.3-codex',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--json',
    ]);
    expect(call?.args.at(-1)).toBe('-');
  });

  it('rejects a wrong acknowledgement, a missing payload and a failed exit', async () => {
    const wrongAck = runner(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          result: `${JSON.stringify({ ...agentAcknowledgement(envelope), taskId: 'T2' })}\n{}`,
        }),
      }),
    );
    expect(
      await new CliAgentAdapter('claude', wrongAck.fake).run(envelope, {}, new AbortController().signal, vi.fn()),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const noPayload = runner(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({ result: JSON.stringify(agentAcknowledgement(envelope)) }),
      }),
    );
    expect(
      await new CliAgentAdapter('claude', noPayload.fake).run(envelope, {}, new AbortController().signal, vi.fn()),
    ).toMatchObject({ ok: false, error: { message: 'CLI returned no payload JSON.' } });
    const failed = runner(() => Promise.resolve({ exitCode: 2, stdout: '', stderr: 'not logged in' }));
    const failure = await new CliAgentAdapter('claude', failed.fake).run(
      envelope,
      {},
      new AbortController().signal,
      vi.fn(),
    );
    expect(failure).toMatchObject({ ok: false, error: { code: 'COMMAND_FAILED' } });
    expect(!failure.ok && failure.error.message).toContain('not logged in');
  });

  it('parses CLI outputs defensively', () => {
    expect(parseClaudeOutput('garbage')).toMatchObject({ ok: false });
    expect(parseClaudeOutput(JSON.stringify({ result: 'quota', is_error: true }))).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_FAILED' },
    });
    expect(parseCodexUsage('no events')).toMatchObject({ inputTokens: null, source: 'cli', billing: 'subscription' });
  });
});
