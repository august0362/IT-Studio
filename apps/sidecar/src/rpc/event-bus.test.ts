import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus.js';
import type { RpcNotificationMap } from '@itstudio/schemas';

describe('EventBus', () => {
  it('publishes typed payloads and unsubscribes listeners', () => {
    const bus = new EventBus<RpcNotificationMap>();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('system.ready', handler);
    bus.publish('system.ready', { version: '1.0.0', recoveredTransactions: 2 });
    unsubscribe();
    bus.publish('system.ready', { version: '1.0.0', recoveredTransactions: 3 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
