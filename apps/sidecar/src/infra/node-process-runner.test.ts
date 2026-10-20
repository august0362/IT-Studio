import { describe, expect, it } from 'vitest';
import { NodeProcessRunner, resolveWindowsCli, type ShimFileSystem } from './node-process-runner.js';

const runner = new NodeProcessRunner();
const input = (args: readonly string[], timeoutMs = 5000) => ({
  executable: 'node',
  args,
  cwd: process.cwd(),
  env: { ...process.env, ITSTUDIO_TEST_SECRET: 'must-not-leak', CUSTOM_SECRET: 'must-not-leak' },
  timeoutMs,
});

describe('NodeProcessRunner', () => {
  it('runs a successful node process and scrubs non-allow-listed environment variables', async () => {
    const result = await runner.run(input(['-e', 'process.stdout.write(JSON.stringify(process.env))']));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdoutTail).not.toContain('must-not-leak');
      expect(result.value.stdoutTail).not.toContain('ITSTUDIO_TEST_SECRET');
    }
  });

  it('returns non-zero exit codes and bounds each output tail to 64 KB', async () => {
    const failed = await runner.run(input(['-e', 'process.stderr.write("bad");process.exitCode=3']));
    expect(failed).toMatchObject({ ok: true, value: { exitCode: 3, stderrTail: 'bad' } });
    const large = await runner.run(input(['-e', 'process.stdout.write("x".repeat(70000))']));
    expect(large.ok && Buffer.byteLength(large.value.stdoutTail)).toBe(64 * 1024);
  });

  it('times out and terminates the process', async () => {
    const result = await runner.run(input(['-e', 'setInterval(()=>{},1000)'], 50));
    expect(result).toMatchObject({ ok: true, value: { timedOut: true } });
  });

  it('rejects unknown executables and NUL arguments', async () => {
    expect(await runner.run({ ...input([]), executable: 'powershell' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await runner.run(input(['bad\0arg']))).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('writes stdin to the child and honours a larger output bound', async () => {
    const echoed = await runner.run({
      ...input(['-e', 'process.stdin.pipe(process.stdout)']),
      stdin: 'prompt via stdin',
    });
    expect(echoed).toMatchObject({ ok: true, value: { exitCode: 0, stdoutTail: 'prompt via stdin' } });
    const large = await runner.run({
      ...input(['-e', 'process.stdout.write("x".repeat(100000))']),
      maxOutputBytes: 200_000,
    });
    expect(large.ok && Buffer.byteLength(large.value.stdoutTail)).toBe(100_000);
  });
});

describe('resolveWindowsCli', () => {
  const npm = String.raw`C:\Users\u\AppData\Roaming\npm`;
  const nodeDir = String.raw`C:\Program Files\nodejs`;
  const fs = (files: Readonly<Record<string, string>>): ShimFileSystem => ({
    exists: (path) => path in files,
    read: (path) => files[path] ?? null,
  });
  const claudeShim = String.raw`"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`;
  const codexShim = [
    String.raw`IF EXIST "%dp0%\node.exe" (`,
    String.raw`  SET "_prog=%dp0%\node.exe"`,
    ')',
    String.raw`"%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`,
  ].join('\r\n');

  it('prefers a real exe on PATH', () => {
    const exe = String.raw`${nodeDir}\claude.exe`;
    expect(resolveWindowsCli('claude', `${nodeDir};${npm}`, fs({ [exe]: '' }))).toEqual({ file: exe, prefixArgs: [] });
  });

  it('follows an npm shim to the native binary it launches', () => {
    const target = String.raw`${npm}\node_modules\@anthropic-ai\claude-code\bin\claude.exe`;
    expect(resolveWindowsCli('claude', npm, fs({ [String.raw`${npm}\claude.cmd`]: claudeShim, [target]: '' }))).toEqual(
      { file: target, prefixArgs: [] },
    );
  });

  it('runs a JavaScript shim target with node from PATH, skipping the optional bundled node.exe', () => {
    const script = String.raw`${npm}\node_modules\@openai\codex\bin\codex.js`;
    const node = String.raw`${nodeDir}\node.exe`;
    const files = { [String.raw`${npm}\codex.cmd`]: codexShim, [script]: '', [node]: '' };
    expect(resolveWindowsCli('codex', `${npm};${nodeDir}`, fs(files))).toEqual({ file: node, prefixArgs: [script] });
  });

  it('returns null when nothing usable is found', () => {
    expect(resolveWindowsCli('codex', npm, fs({ [String.raw`${npm}\codex.cmd`]: codexShim }))).toBeNull();
    expect(resolveWindowsCli('claude', '', fs({}))).toBeNull();
  });
});
