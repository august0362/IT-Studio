import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('redacts api keys in captured output', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createLogger({ streams: [stream], level: 'info' });
    logger.info({ apiKey: 'secret-value' }, 'test');
    expect(lines.join('')).toContain('[Redacted]');
    expect(lines.join('')).not.toContain('secret-value');
  });
});
