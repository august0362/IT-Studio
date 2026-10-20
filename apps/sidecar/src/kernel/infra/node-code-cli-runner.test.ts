import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeResolvedCodeCli } from '../domain/code-cli.js';
import { NodeCodeCliRunner } from './node-code-cli-runner.js';

describe('NodeCodeCliRunner', () => {
  it('rejects NUL arguments before spawning', async () => {
    const cli = makeResolvedCodeCli(join(process.cwd(), 'missing', 'Code.exe'), [], true);
    if (cli === null) throw new Error('Expected a valid executable value');
    const result = await new NodeCodeCliRunner({ PATH: 'safe', SECRET_KEY: 'not-forwarded' }).run(cli, ['\0']);
    expect(result).toMatchObject({ ok: false, error: { message: 'The VS Code executable or arguments are invalid.' } });
  });

  it('reports an executable start failure as a result', async () => {
    const cli = makeResolvedCodeCli(join(process.cwd(), 'missing', 'Code.exe'), [], true);
    if (cli === null) throw new Error('Expected a valid executable value');
    const result = await new NodeCodeCliRunner({ PATH: 'safe' }).run(cli, ['--list-extensions']);
    expect(result).toMatchObject({ ok: false, error: { message: 'VS Code CLI could not be started.' } });
  });
});
