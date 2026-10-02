import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessRunInput, IProcessRunner } from '../ports/process-runner.js';
import { NodeFileSystem } from '../infra/node-file-system.js';
import { CommandRunner } from './command-runner.js';

describe('CommandRunner', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('uses the real project root and maps command output into CommandRun', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-command-'));
    let received: ProcessRunInput | undefined;
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
    });
    const result = await commandRunner.run(directory, {
      kind: 'typecheck',
      executable: 'node',
      args: ['node_modules/typescript/bin/tsc'],
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { exitCode: 1, diagnostics: [{ path: 'src/a.ts', code: 'TS1234' }] },
    });
    expect(received?.cwd).toBe(
      await new NodeFileSystem().realpath(directory).then((real) => (real.ok ? real.value : '')),
    );
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
});
