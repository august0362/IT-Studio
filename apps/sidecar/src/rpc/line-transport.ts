import type { Readable, Writable } from 'node:stream';

export const MAX_LINE_BYTES = 8 * 1024 * 1024;
const PARSE_ERROR = JSON.stringify({
  jsonrpc: '2.0',
  id: null,
  error: {
    code: -32700,
    message: 'Parse error',
    data: { code: 'VALIDATION', message: 'Input line exceeds 8 MiB', retryable: false },
  },
});

export interface LineTransportOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly onLine: (line: string) => void | Promise<void>;
}

export class LineTransport {
  private buffer = '';
  private discardingOverlongLine = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly options: LineTransportOptions;

  constructor(options: LineTransportOptions) {
    this.options = options;
  }

  start(): void {
    this.options.input.setEncoding('utf8');
    this.options.input.on('data', (chunk: string | Buffer) => {
      this.consume(String(chunk));
    });
    this.options.input.on('end', () => {
      if (this.buffer.length > 0) this.processLine(this.buffer);
      this.buffer = '';
    });
  }

  write(value: unknown): Promise<void> {
    const line = `${JSON.stringify(value)}\n`;
    this.writeQueue = this.writeQueue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.options.output.write(line, 'utf8', (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    return this.writeQueue;
  }

  private consume(chunk: string): void {
    let remaining = this.buffer + chunk;
    this.buffer = '';
    let newline = remaining.indexOf('\n');
    while (newline !== -1) {
      const line = remaining.slice(0, newline).replace(/\r$/u, '');
      if (this.discardingOverlongLine) this.discardingOverlongLine = false;
      else if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) void this.write(JSON.parse(PARSE_ERROR));
      else this.processLine(line);
      remaining = remaining.slice(newline + 1);
      newline = remaining.indexOf('\n');
    }
    if (this.discardingOverlongLine) return;
    if (Buffer.byteLength(remaining, 'utf8') > MAX_LINE_BYTES) {
      void this.write(JSON.parse(PARSE_ERROR));
      this.discardingOverlongLine = true;
      this.buffer = '';
    } else this.buffer = remaining;
  }

  private processLine(line: string): void {
    if (line.trim().length === 0) return;
    void this.options.onLine(line);
  }
}
