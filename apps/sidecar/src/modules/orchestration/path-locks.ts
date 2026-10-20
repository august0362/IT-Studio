import { globToRegExp } from './glob.js';

/** Stand-in for an unsafe pattern, which matches nothing (plan validation rejects those anyway). */
const NOTHING = /(?!)/u;

function globRegex(glob: string): RegExp {
  return globToRegExp(glob) ?? NOTHING;
}
/**
 * Conservative: two allowances overlap when one path could fall under both. Compared case-insensitively
 * because `src/**` and `SRC/**` are the same folder on Windows.
 */
export function pathsOverlap(leftInput: string, rightInput: string): boolean {
  const left = leftInput.toLocaleLowerCase('en-US');
  const right = rightInput.toLocaleLowerCase('en-US');
  if (
    left === right ||
    left.startsWith(`${right.replace(/\*+$/u, '')}/`) ||
    right.startsWith(`${left.replace(/\*+$/u, '')}/`)
  )
    return true;
  const l = globRegex(left);
  const r = globRegex(right);
  const candidates = new Set([
    left,
    right,
    left.replace(/\*\*?/gu, 'x'),
    right.replace(/\*\*?/gu, 'x'),
    `${left.replace(/\*\*?/gu, 'x')}/${right.replace(/\*\*?/gu, 'x')}`,
  ]);
  return [...candidates].some((candidate) => l.test(candidate) && r.test(candidate));
}
export function pathSetsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((a) => right.some((b) => pathsOverlap(a, b)));
}
