import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from './unified-diff.js';

describe('applyUnifiedDiff', () => {
  it('applies exact replacement and insertion hunks', () => {
    expect(applyUnifiedDiff('one\ntwo\n', '@@ -1,2 +1,2 @@\n one\n-two\n+three\n')).toEqual({
      ok: true,
      value: 'one\nthree\n',
    });
    expect(applyUnifiedDiff('one\n', '@@ -1,0 +2 @@\n+two\n')).toEqual({ ok: true, value: 'one\ntwo\n' });
  });

  it('rejects malformed, fuzzy, overlapping, and count-mismatched hunks', () => {
    expect(applyUnifiedDiff('one', '@@ nope @@\n-one\n+two')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -1 +1 @@\n-other\n+two')).toMatchObject({
      ok: false,
      error: { code: 'PATCH_CONFLICT' },
    });
    expect(applyUnifiedDiff('one\ntwo', '@@ -1 +1 @@\n-one\n+ONE\n@@ -1 +1 @@\n-two\n+TWO')).toMatchObject({
      ok: false,
    });
    expect(applyUnifiedDiff('one', '@@ -1,2 +1,1 @@\n-one\n+two')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -1,2 +1,2 @@\n-one\n@@ -1 +1 @@\n+two')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -1 +1 @@\n?invalid')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -1 +1 @@\n\n-one\n+two')).toMatchObject({ ok: true, value: 'two' });
    expect(applyUnifiedDiff('one', 'no hunks')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -2 +1 @@\n-one\n+two')).toMatchObject({ ok: false });
    expect(applyUnifiedDiff('one', '@@ -1,0 +2,0 @@')).toMatchObject({ ok: true, value: 'one' });
    expect(applyUnifiedDiff('one', '@@ -1 +1 @@\n one')).toMatchObject({ ok: true, value: 'one' });
    expect(applyUnifiedDiff('one', '@@ -1 +0,0 @@\n-one')).toMatchObject({ ok: true, value: '' });
    expect(applyUnifiedDiff('one\ntwo', '@@ -1,2 +1,1 @@\n-one\n two')).toMatchObject({
      ok: true,
      value: 'two',
    });
    expect(applyUnifiedDiff('one', '@@ -1 +1 @@\n\\ No newline at end of file\n-one\n+two')).toMatchObject({
      ok: true,
      value: 'two',
    });
  });
});
