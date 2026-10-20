import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';

function conflict(message: string): Result<never> {
  const error: AppError = {
    code: ErrorCode.PATCH_CONFLICT,
    message,
    remediation: ['Refresh the file and generate a patch against its current contents.'],
    retryable: false,
  };
  return { ok: false, error };
}

interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newCount: number;
  readonly lines: readonly string[];
}

function parseHunks(diff: string): Result<readonly Hunk[]> {
  const rows = diff.replaceAll('\r\n', '\n').split('\n');
  const hunks: Hunk[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    // The loop condition guarantees this index is within the array; keep a fallback for defensive typing.
    /* v8 ignore next */
    const row = rows[index] ?? '';
    if (!row.startsWith('@@ ')) continue;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(row);
    if (!match) return conflict('The unified diff contains an invalid hunk header.');
    const oldStart = Number(match[1]);
    const oldCount = Number(match[2] ?? '1');
    const newCount = Number(match[4] ?? '1');
    const lines: string[] = [];
    let oldSeen = 0;
    let newSeen = 0;
    for (index += 1; index < rows.length; index += 1) {
      // This loop also bounds the index to existing rows, so the fallback cannot run.
      /* v8 ignore next */
      const line = rows[index] ?? '';
      if (line.startsWith('@@ ')) {
        index -= 1;
        break;
      }
      if (line === '\\ No newline at end of file') continue;
      if (line.startsWith(' ')) {
        lines.push(line);
        oldSeen += 1;
        newSeen += 1;
      } else if (line.startsWith('-')) {
        lines.push(line);
        oldSeen += 1;
      } else if (line.startsWith('+')) {
        lines.push(line);
        newSeen += 1;
      } else if (line.length > 0) {
        return conflict('The unified diff contains an invalid hunk line.');
      }
      if (oldSeen === oldCount && newSeen === newCount) break;
    }
    if (oldSeen !== oldCount || newSeen !== newCount)
      return conflict('The unified diff hunk counts do not match its contents.');
    hunks.push({ oldStart, oldCount, newCount, lines });
  }
  return hunks.length > 0 ? { ok: true, value: hunks } : conflict('The unified diff contains no hunks.');
}

/** Applies standard unified-diff hunks with exact context matching and no fuzz. */
export function applyUnifiedDiff(original: string, unifiedDiff: string): Result<string> {
  const parsed = parseHunks(unifiedDiff);
  if (!parsed.ok) return parsed;
  const source = original.split('\n');
  if (original.endsWith('\n')) source.pop();
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of parsed.value) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (start < cursor || start > source.length) return conflict('The unified diff hunks overlap or exceed the file.');
    output.push(...source.slice(cursor, start));
    cursor = start;
    for (const line of hunk.lines) {
      const marker = line[0];
      const content = line.slice(1);
      if (marker === ' ' || marker === '-') {
        if (source[cursor] !== content) return conflict('The unified diff context does not exactly match the file.');
        cursor += 1;
      }
      if (marker === ' ' || marker === '+') output.push(content);
    }
  }
  output.push(...source.slice(cursor));
  const result = output.join('\n');
  return { ok: true, value: original.endsWith('\n') ? `${result}\n` : result };
}
