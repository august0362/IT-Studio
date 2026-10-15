import type { ProcessKind } from '@itstudio/schemas';
import { z } from 'zod';

const layoutSchema = z.record(z.string(), z.object({ x: z.number(), y: z.number() }));
export type ProcessLayout = z.infer<typeof layoutSchema>;
export const layoutKey = (kind: ProcessKind): string => `itstudio.process-layout.v1.${kind}`;
export function readProcessLayout(kind: ProcessKind): ProcessLayout {
  try {
    const parsed = layoutSchema.safeParse(JSON.parse(localStorage.getItem(layoutKey(kind)) ?? '{}'));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
export function saveProcessLayout(kind: ProcessKind, layout: ProcessLayout): void {
  try {
    localStorage.setItem(layoutKey(kind), JSON.stringify(layout));
  } catch {
    /* Optional preference: the current layout remains usable in memory. */
  }
}
