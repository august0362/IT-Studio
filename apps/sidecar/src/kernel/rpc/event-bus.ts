import type { RpcNotificationMap, RpcNotificationName } from '@itstudio/schemas';

type Listener<T> = (params: T) => void;

export class EventBus<TMap extends object> {
  private readonly listeners = new Map<keyof TMap, Set<Listener<unknown>>>();

  publish<N extends keyof TMap>(name: N, params: TMap[N]): void {
    for (const listener of this.listeners.get(name) ?? []) listener(params);
  }

  subscribe<N extends keyof TMap>(name: N, handler: Listener<TMap[N]>): () => void {
    const listeners = this.listeners.get(name) ?? new Set<Listener<unknown>>();
    listeners.add(handler as Listener<unknown>);
    this.listeners.set(name, listeners);
    return () => {
      listeners.delete(handler as Listener<unknown>);
      if (listeners.size === 0) this.listeners.delete(name);
    };
  }
}

export type RpcEventBus = EventBus<RpcNotificationMap>;
export type RpcEventHandler<N extends RpcNotificationName> = Listener<RpcNotificationMap[N]>;
