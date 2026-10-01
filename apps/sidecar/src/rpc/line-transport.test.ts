import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LineTransport } from './line-transport.js';

function setup(onLine?: (line: string) => void) {
  const input = new PassThrough();
  const output = new PassThrough();
  const received: string[] = [];
  const written: string[] = [];
  output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
  const transport = new LineTransport({ input, output, onLine: onLine ?? ((line) => received.push(line)) });
  transport.start();
  return { input, output, received, written, transport };
}

describe('LineTransport', () => {
  it('handles split chunks, CRLF, and multiple lines', async () => {
    const { input, received } = setup();
    input.write('{"a":');
    input.write('1}\r\n{"b":2}\n{"c":');
    input.end('3}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('rejects overlong lines with a parse error response', async () => {
    const { input, written } = setup();
    input.write('x'.repeat(8 * 1024 * 1024 + 1) + '\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it('discards the remainder of an overlong partial line and resumes at the next line', async () => {
    const { input, received, written } = setup();
    input.write('x'.repeat(8 * 1024 * 1024 + 1));
    input.write('ignored remainder\n{"valid":true}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(['{"valid":true}']);
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it('serializes concurrent writes as complete lines', async () => {
    const { transport, written } = setup();
    await Promise.all([transport.write({ value: 1 }), transport.write({ value: 2 })]);
    expect(written.join('')).toBe('{"value":1}\n{"value":2}\n');
  });
});
