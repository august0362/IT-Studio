import { describe, expect, it } from 'vitest';
import { NodeProcessRunner } from './node-process-runner.js';

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
});
