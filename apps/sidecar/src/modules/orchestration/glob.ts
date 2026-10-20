/**
 * The one glob matcher for orchestration `allowedPaths` (scope checks, worker context, path locks).
 * Patterns and paths are workspace-relative and `/`-separated. A `**` segment matches one or more segments
 * at the end of a pattern (`src/**` = everything below `src/`) and zero or more segments elsewhere; `*` and
 * `?` never cross `/`. Anything that is not a plain relative path (absolute, drive letter, UNC, backslash,
 * `.`/`..` or empty segment, NUL) never matches, as pattern or as path. Matching is case-sensitive, so a
 * differently cased path is refused rather than written through a case-insensitive file system.
 */
function isSafeRelative(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function segmentSource(segment: string): string {
  let source = '';
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] ?? '';
    if (char === '*') {
      while (segment[index + 1] === '*') index += 1;
      source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+.]/gu, '\\$&');
  }
  return source;
}

/** Returns `undefined` for an unsafe pattern, which therefore matches nothing. */
export function globToRegExp(glob: string): RegExp | undefined {
  if (!isSafeRelative(glob)) return undefined;
  const segments = glob.split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') source += last ? '[^/]+(?:/[^/]+)*' : '(?:[^/]+/)*';
    else source += `${segmentSource(segment)}${last ? '' : '/'}`;
  });
  return new RegExp(`${source}$`, 'u');
}

export function isSafeGlob(glob: string): boolean {
  return globToRegExp(glob) !== undefined;
}

export function globMatches(glob: string, path: string): boolean {
  if (!isSafeRelative(path)) return false;
  return globToRegExp(glob)?.test(path) ?? false;
}
