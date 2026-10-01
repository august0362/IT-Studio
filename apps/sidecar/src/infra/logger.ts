import pino, { type Logger } from 'pino';
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

class DailyFileStream extends Writable {
  private readonly directory: string;

  constructor(directory: string) {
    super();
    this.directory = directory;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      appendFileSync(join(this.directory, `sidecar-${date}.log`), chunk);
      this.prune();
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private prune(): void {
    const logs = readdirSync(this.directory)
      .filter((name) => /^sidecar-\d{8}\.log$/u.test(name))
      .sort()
      .reverse();
    for (const stale of logs.slice(7)) unlinkSync(join(this.directory, stale));
  }
}

export interface LoggerOptions {
  readonly dataDir?: string;
  readonly level?: string;
  readonly streams?: readonly Writable[];
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const streams = options.streams ?? [
    process.stderr,
    new DailyFileStream(join(options.dataDir ?? process.env.ITSTUDIO_DATA_DIR ?? '.', 'logs')),
  ];
  const destinations = streams.map((stream) => ({ stream }));
  return pino(
    {
      level: options.level ?? process.env.ITSTUDIO_LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'apiKey',
          '*.apiKey',
          'authorization',
          '*.authorization',
          'headers.authorization',
          '*.headers.authorization',
          '["x-api-key"]',
          '*["x-api-key"]',
          'token',
          '*.token',
        ],
        censor: '[Redacted]',
      },
    },
    pino.multistream(destinations),
  );
}
