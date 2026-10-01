import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './infra/logger.js';
import { createFakeClock } from './infra/clock.js';
import { createContainer } from './container.js';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!isJsonObject(value)) throw new Error('Expected JSON object');
  return value;
}

describe('sidecar container', () => {
  it('publishes ready first, then answers system.ping over injected streams', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    let pending = '';
    output.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const chunks = pending.split('\n');
      pending = chunks.pop() ?? '';
      lines.push(...chunks.filter(Boolean));
    });
    const container = createContainer(
      {},
      {
        input,
        output,
        clock: createFakeClock(),
        logger: createLogger({
          streams: [
            new Writable({
              write(_chunk, _encoding, callback) {
                callback();
              },
            }),
          ],
        }),
      },
    );
    container.start();
    input.write('{"jsonrpc":"2.0","id":1,"method":"system.ping","params":{}}\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parseLine(lines[0] ?? '{}')).toMatchObject({ method: 'system.ready' });
    const ping = parseLine(lines[1] ?? '{}');
    expect(ping.id).toBe(1);
    const result = ping.result;
    if (!isJsonObject(result)) throw new Error('Expected ping result');
    expect(typeof result.version).toBe('string');
    expect(result.uptimeMs).toBe(0);
  });
});
