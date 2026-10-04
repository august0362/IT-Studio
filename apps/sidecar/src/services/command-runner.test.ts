import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessRunInput, IProcessRunner } from '../ports/process-runner.js';
import { NodeFileSystem } from '../infra/node-file-system.js';
import { NodeProcessRunner } from '../infra/node-process-runner.js';
import { CommandRunner } from './command-runner.js';
import type { WorkflowInternalEvent } from './workflow-internal-events.js';

describe('CommandRunner', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('uses the real project root and maps command output into CommandRun', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-'));
    let received: ProcessRunInput | undefined;
    const activity: WorkflowInternalEvent[] = [];
    const processRunner: IProcessRunner = {
      run: (input) => {
        received = input;
        return Promise.resolve({
          ok: true,
          value: {
            exitCode: 1,
            timedOut: false,
            durationMs: 12,
            stdoutTail: 'src/a.ts(2,3): error TS1234: failure',
            stderrTail: '',
          },
        });
      },
    };
    const commandRunner = new CommandRunner({
      processRunner,
      fileSystem: new NodeFileSystem(),
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
      env: { PATH: 'safe' },
      internalEvents: { publish: (event) => activity.push(event), subscribe: () => () => undefined },
    });
    const result = await commandRunner.run(directory, {
      kind: 'typecheck',
      executable: 'node',
      args: ['node_modules/typescript/bin/tsc', '--token=private-test-secret'],
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { exitCode: 1, diagnostics: [{ path: 'src/a.ts', code: 'TS1234' }] },
    });
    expect(received?.cwd).toBe(
      await new NodeFileSystem().realpath(directory).then((real) => (real.ok ? real.value : '')),
    );
    expect(activity).toMatchObject([
      { type: 'command', phase: 'started', executable: 'node', argCount: 2 },
      {
        type: 'command',
        phase: 'finished',
        executable: 'node',
        argCount: 2,
        exitCode: 1,
        timedOut: false,
        durationMs: 12,
      },
    ]);
    expect(JSON.stringify(activity)).not.toContain('--token=private-test-secret');
  });

  it('rejects a project root that is a file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-'));
    const file = join(directory, 'file.txt');
    const fs = await import('node:fs/promises');
    await fs.writeFile(file, 'x');
    const commandRunner = new CommandRunner({
      processRunner: {
        run: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'INTERNAL', message: 'unused', retryable: false },
          }),
      },
      fileSystem: new NodeFileSystem(),
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
    });
    expect(
      await commandRunner.run(file, { kind: 'typecheck', executable: 'node', args: [], timeoutMs: 1000 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('covers all validation output parsers and the fallback diagnostic', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-parsers-'));
    const outputs = ['unparsed tsc output', '[]', '{"testResults":[]}'];
    const runner = new CommandRunner({
      processRunner: {
        run: (input) =>
          Promise.resolve({
            ok: true as const,
            value: {
              exitCode: 0,
              timedOut: false,
              durationMs: 1,
              stdoutTail: outputs[input.args[0] === 'lint' ? 1 : input.args[0] === 'test' ? 2 : 0] ?? '',
              stderrTail: '',
            },
          }),
      },
      fileSystem: new NodeFileSystem(),
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
      env: {},
    });
    const base = { executable: 'node' as const, timeoutMs: 1000 };
    const typecheck = await runner.run(directory, { ...base, kind: 'typecheck', args: ['typecheck'] });
    expect(typecheck).toMatchObject({
      ok: true,
      value: { diagnostics: [{ source: 'tsc', message: 'Command output could not be parsed.' }] },
    });
    const lint = await runner.run(directory, { ...base, kind: 'lint', args: ['lint'] });
    expect(lint.ok).toBe(true);
    const tests = await runner.run(directory, { ...base, kind: 'test', args: ['test'] });
    expect(tests.ok && tests.value.tests).toBeDefined();
    const build = await runner.run(directory, { ...base, kind: 'build', args: ['build'] });
    expect(build).toMatchObject({ ok: true, value: { diagnostics: [] } });
  });

  it('returns root and process runner errors without mapping a command result', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-errors-'));
    const error = {
      code: 'INTERNAL' as const,
      message: 'Injected failure.',
      remediation: ['Retry.'],
      retryable: false,
    };
    const failedRoot = new (class extends NodeFileSystem {
      override realpath() {
        return Promise.resolve({ ok: false as const, error });
      }
    })();
    const rootResult = await new CommandRunner({
      processRunner: { run: () => Promise.reject(new Error('must not spawn')) },
      fileSystem: failedRoot,
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
    }).run(directory, { kind: 'build', executable: 'node', args: [], timeoutMs: 1000 });
    expect(rootResult).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });

    const failedStat = new (class extends NodeFileSystem {
      override stat() {
        return Promise.resolve({ ok: false as const, error });
      }
    })();
    const statResult = await new CommandRunner({
      processRunner: { run: () => Promise.reject(new Error('must not spawn')) },
      fileSystem: failedStat,
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
    }).run(directory, { kind: 'build', executable: 'node', args: [], timeoutMs: 1000 });
    expect(statResult).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });

    const failedProcess = await new CommandRunner({
      processRunner: { run: () => Promise.resolve({ ok: false, error }) },
      fileSystem: new NodeFileSystem(),
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
    }).run(directory, { kind: 'build', executable: 'node', args: [], timeoutMs: 1000 });
    expect(failedProcess).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  });

  it('handles empty typecheck output and forwards cancellation signals', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-signal-'));
    let received: ProcessRunInput | undefined;
    const controller = new AbortController();
    const commandRunner = new CommandRunner({
      processRunner: {
        run: (input) => {
          received = input;
          return Promise.resolve({
            ok: true,
            value: { exitCode: 0, timedOut: false, durationMs: 1, stdoutTail: '', stderrTail: '' },
          });
        },
      },
      fileSystem: new NodeFileSystem(),
      ids: { uuid: () => 'e6ad8da0-08f8-4a8d-88a0-4199cdbddfe1' },
    });
    expect(
      await commandRunner.run(
        directory,
        { kind: 'typecheck', executable: 'node', args: [], timeoutMs: 1000 },
        controller.signal,
      ),
    ).toMatchObject({ ok: true, value: { diagnostics: [] } });
    expect(received?.signal).toBe(controller.signal);
  });

  it('TC-M6-040 rejects non-allow-listed executables without spawning them', async () => {
    const result = await new NodeProcessRunner().run({
      executable: 'powershell',
      args: [],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('TC-M6-041 strips provider secrets from child process environments', async () => {
    const result = await new NodeProcessRunner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, OPENAI_API_KEY: 'test-provider-secret' },
      timeoutMs: 1000,
    });
    expect(result.ok && result.value.stdoutTail).not.toContain('test-provider-secret');
    expect(result.ok && result.value.stdoutTail).not.toContain('OPENAI_API_KEY');
  });

  it('TC-M6-042 times out and terminates the command process', async () => {
    const result = await new NodeProcessRunner().run({
      executable: 'node',
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30,
    });
    expect(result).toMatchObject({ ok: true, value: { timedOut: true } });
  });

  it('TC-M6-043 caps captured command output at 64 KB', async () => {
    const result = await new NodeProcessRunner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write("x".repeat(100000))'],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1000,
    });
    expect(result.ok && Buffer.byteLength(result.value.stdoutTail)).toBe(64 * 1024);
  });

  it('TC-M6-044 passes shell metacharacters literally without shell expansion', async () => {
    const result = await new NodeProcessRunner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(process.argv[1] ?? "missing")', '&& | $(echo unsafe)'],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({ ok: true, value: { exitCode: 0, stdoutTail: '&& | $(echo unsafe)' } });
  });
});
