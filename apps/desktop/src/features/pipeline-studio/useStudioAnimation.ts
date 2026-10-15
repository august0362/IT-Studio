import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleId } from './studio-model';

export const PACKET_MS = 750;
export interface Packet {
  readonly id: number;
  readonly from: ModuleId;
  readonly to: ModuleId;
}
export function enqueueTransition(
  queue: readonly Packet[],
  from: ModuleId,
  to: ModuleId,
  id: number,
  reduced: boolean,
): readonly Packet[] {
  return reduced || from === to ? queue : [...queue, { id, from, to }];
}
export function replayPackets(path: readonly ModuleId[], startId: number, reduced: boolean): readonly Packet[] {
  return path.reduce<readonly Packet[]>((queue, to, index) => {
    const from = path[index - 1];
    return from === undefined ? queue : enqueueTransition(queue, from, to, startId + index, reduced);
  }, []);
}
export function useStudioAnimation() {
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [queue, setQueue] = useState<readonly Packet[]>([]);
  const [pulse, setPulse] = useState<{ readonly module: ModuleId; readonly id: number } | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => {
      setReduced(media.matches);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);
  const packet = reduced ? undefined : queue[0];
  useEffect(() => {
    if (packet === undefined) return;
    const timer = window.setTimeout(() => {
      setPulse({ module: packet.to, id: packet.id });
      setQueue((items) => items.filter((item) => item.id !== packet.id));
    }, PACKET_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [packet]);
  useEffect(() => {
    if (pulse === null) return;
    const timer = window.setTimeout(() => {
      setPulse(null);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pulse]);
  const transition = useCallback(
    (from: ModuleId, to: ModuleId): void => {
      const id = ++sequence.current;
      setQueue((items) => enqueueTransition(items, from, to, id, reduced));
    },
    [reduced],
  );
  const replay = useCallback(
    (path: readonly ModuleId[]): void => {
      const startId = sequence.current;
      sequence.current += path.length;
      setQueue(replayPackets(path, startId, reduced));
    },
    [reduced],
  );
  const clear = useCallback((): void => {
    setQueue([]);
    setPulse(null);
  }, []);
  useEffect(() => {
    if (reduced) clear();
  }, [reduced, clear]);
  return { packet, pulse, transition, replay, clear };
}
