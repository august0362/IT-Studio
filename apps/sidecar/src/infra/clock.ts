export interface IClock {
  now(): Date;
  monotonicMs(): number;
}

export const systemClock: IClock = {
  now: () => new Date(),
  monotonicMs: () => performance.now(),
};

export function createFakeClock(initial = new Date(0)): IClock & { advance(ms: number): void } {
  let current = new Date(initial);
  let monotonic = 0;
  return {
    now: () => new Date(current),
    monotonicMs: () => monotonic,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
      monotonic += ms;
    },
  };
}
