export function retryDelayMs(attempt: number, retryAfterMs: number | undefined, random: () => number): number {
  const base = Math.min(retryAfterMs ?? 500 * 2 ** attempt, 10_000);
  return Math.round(base * (0.8 + random() * 0.4));
}
