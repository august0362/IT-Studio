import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createFakeClock } from '../infra/clock.js';
import { SystemService, type SystemServiceTimers } from './system-service.js';

function createTestLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { logger: pino({ level: 'trace' }, stream), lines };
}

function createManualTimers() {
  let callback: (() => void) | undefined;
  let cleared = false;
  const timers: SystemServiceTimers = {
    setTimeout(next) {
      callback = next;
      return next;
    },
    clearTimeout(handle) {
      if (handle === callback) cleared = true;
    },
  };
  return {
    timers,
    fire() {
      callback?.();
    },
    isCleared: () => cleared,
  };
}

describe('SystemService shutdown', () => {
  it('shares one shutdown run across repeated calls and logs its reason', async () => {
    const { logger, lines } = createTestLogger();
    let hookRuns = 0;
    const exits: number[] = [];
    const timers = createManualTimers();
    const service = new SystemService({
      clock: createFakeClock(),
      startedAt: 0,
      logger,
      exit: (code) => exits.push(code),
      timers: timers.timers,
      shutdownHooks: [
        () => {
          hookRuns += 1;
        },
      ],
    });

    const first = service.shutdown('stdin_closed');
    const second = service.shutdown('rpc');
    expect(second).toBe(first);
    await first;

    expect(hookRuns).toBe(1);
    expect(exits).toEqual([0]);
    expect(timers.isCleared()).toBe(true);
    expect(
      lines
        .map((line) => JSON.parse(line) as { msg: string; reason?: string })
        .filter((line) => line.msg === 'shutdown requested'),
    ).toMatchObject([{ reason: 'stdin_closed' }]);
  });

  it('logs hook failures and continues through the remaining hooks', async () => {
    const { logger, lines } = createTestLogger();
    const exits: number[] = [];
    let laterHookRan = false;
    const service = new SystemService({
      clock: createFakeClock(),
      startedAt: 0,
      logger,
      exit: (code) => exits.push(code),
      timers: createManualTimers().timers,
      shutdownHooks: [
        () => {
          throw new Error('hook issue');
        },
        () => {
          laterHookRan = true;
        },
      ],
    });

    await service.shutdown('rpc');

    expect(laterHookRan).toBe(true);
    expect(exits).toEqual([0]);
    expect(lines.some((line) => line.includes('shutdown hook failed'))).toBe(true);
  });

  it('forces exit 0 with a warning when a shutdown hook exceeds the deadline', async () => {
    const { logger, lines } = createTestLogger();
    const exits: number[] = [];
    const timers = createManualTimers();
    const service = new SystemService({
      clock: createFakeClock(),
      startedAt: 0,
      logger,
      exit: (code) => exits.push(code),
      timers: timers.timers,
      shutdownHooks: [() => new Promise<void>(() => undefined)],
    });

    const shutdown = service.shutdown('stdin_closed');
    await Promise.resolve();
    timers.fire();
    await shutdown;

    expect(exits).toEqual([0]);
    expect(lines.some((line) => line.includes('shutdown deadline reached'))).toBe(true);
  });
});
