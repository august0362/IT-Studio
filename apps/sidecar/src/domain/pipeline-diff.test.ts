import { describe, expect, it } from 'vitest';
import { sha256Schema, workspaceRelativePathSchema } from '../validation/brand.js';
import { renderPipelineDiffs } from './pipeline-diff.js';

describe('pipeline reviewer diffs', () => {
  it('renders complete creation and replacement hunks', () => {
    const path = workspaceRelativePathSchema.parse('src/greeting.txt');
    const baseHash = sha256Schema.parse('0'.repeat(64));
    const diff = renderPipelineDiffs(
      [
        { kind: 'create', path, content: 'hello\nworld\n' },
        { kind: 'replace', path, baseHash, content: 'updated' },
      ],
      [{ path, content: 'old' }],
    );
    expect(diff).toContain('--- /dev/null\n+++ b/src/greeting.txt\n@@ -0,0 +1,2 @@\n+hello\n+world');
    expect(diff).toContain('--- a/src/greeting.txt\n+++ b/src/greeting.txt\n@@ -1,1 +1,1 @@\n-old\n+updated');
  });

  it('preserves patch hunks and shows renames explicitly', () => {
    const from = workspaceRelativePathSchema.parse('old.txt');
    const to = workspaceRelativePathSchema.parse('new.txt');
    const baseHash = sha256Schema.parse('0'.repeat(64));
    const diff = renderPipelineDiffs(
      [
        { kind: 'patch', path: from, baseHash, unifiedDiff: '@@ -1 +1 @@\n-old\n+new' },
        { kind: 'rename', from, to, baseHash },
      ],
      [],
    );
    expect(diff).toContain('--- a/old.txt\n+++ b/old.txt\n@@ -1 +1 @@\n-old\n+new');
    expect(diff).toContain('rename from old.txt\nrename to new.txt');
  });
});
