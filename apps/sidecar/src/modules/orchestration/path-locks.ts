function globRegex(glob: string): RegExp {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? '';
    if (char === '*' && glob[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}
export function pathsOverlap(left: string, right: string): boolean {
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
