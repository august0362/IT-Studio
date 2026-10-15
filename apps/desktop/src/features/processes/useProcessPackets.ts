import type { ProcessRecord } from '@itstudio/schemas';
import { useEffect, useRef, useState } from 'react';
import { useNotification } from '../../hooks/use-notification';
import type { ProcessPacket } from './ProcessGraph';

export function useProcessPackets(record: ProcessRecord) {
  const previous = useRef(record);
  const serial = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [packets, setPackets] = useState<readonly ProcessPacket[]>([]);
  function enqueue(from: string, to: string, delay = 0): void {
    const id = ++serial.current;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setPackets((current) => [...current, { from, to, id }]);
      const expiry = setTimeout(() => {
        timers.current.delete(expiry);
        setPackets((current) => current.filter((packet) => packet.id !== id));
      }, 800);
      timers.current.add(expiry);
    }, delay);
    timers.current.add(timer);
  }
  useNotification('process.event', (event) => {
    if (event.type !== 'upsert' || event.process.id !== record.id) return;
    const next = event.process;
    for (const module of next.modules) {
      if (previous.current.modules.find((item) => item.id === module.id)?.state === module.state) continue;
      const outgoing = next.edges.filter((edge) => edge.from === module.id);
      const incoming = next.edges.filter((edge) => edge.to === module.id);
      const edges = module.state === 'done' ? outgoing : incoming;
      for (const edge of edges) enqueue(edge.from, edge.to);
    }
    previous.current = next;
  });
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  function replay(): void {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    setPackets([]);
    record.edges.forEach((edge, index) => {
      enqueue(edge.from, edge.to, index * 800);
    });
  }
  return { packets, replay };
}
