import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ErrorCode, type FileOperation } from '@itstudio/schemas';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import { projectIdSchema, sha256Schema } from '../validation/brand.js';
import { fileOperationSchema } from '../validation/worker.js';
import { parseTransactionManifest, WriteTransactionService } from './write-transaction.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const digest = (text: string) => sha256Schema.parse(createHash('sha256').update(text).digest('hex'));
const operation = (value: unknown): FileOperation => fileOperationSchema.parse(value);

interface Fixture {
  readonly fs: MemoryFileSystem;
  readonly root: string;
  readonly service: WriteTransactionService;
}

async function fixture(files: Readonly<Record<string, string>> = {}): Promise<Fixture> {
  const fs = new MemoryFileSystem();
  const root = resolve(process.cwd(), 'memory-tx-project');
  await fs.mkdir(root, true);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    await fs.mkdir(resolve(absolute, '..'), true);
    await fs.writeFile(absolute, content);
  }
  return {
    fs,
    root,
    service: new WriteTransactionService({
      fileSystem: fs,
      ids: createFakeIdGenerator(['00000000-0000-4000-8000-000000000002']),
      clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    }),
  };
}

async function read(fs: MemoryFileSystem, root: string, path: string): Promise<string | undefined> {
  const absolute = join(root, ...path.split('/'));
  const exists = await fs.exists(absolute);
  if (!exists.ok || !exists.value) return undefined;
  const result = await fs.readFile(absolute);
  return result.ok ? new TextDecoder().decode(result.value) : undefined;
}

describe('WriteTransactionService', () => {
  it('commits create, replace, exact patch, delete, rename, and mixed operations', async () => {
    const { fs, root, service } = await fixture({
      'src/edit.txt': 'old\nline\n',
      'src/patch.txt': 'replaced',
      'src/remove.txt': 'remove',
      'src/move.txt': 'move',
    });
    const operations = [
      { kind: 'create', path: 'src/new.txt', content: 'created' },
      { kind: 'replace', path: 'src/edit.txt', content: 'replaced', baseHash: digest('old\nline\n') },
      {
        kind: 'patch',
        path: 'src/patch.txt',
        unifiedDiff: '@@ -1 +1 @@\n-replaced\n+patched',
        baseHash: digest('replaced'),
      },
      { kind: 'delete', path: 'src/remove.txt', baseHash: digest('remove') },
      { kind: 'rename', from: 'src/move.txt', to: 'src/moved.txt', baseHash: digest('move') },
    ];
    const prepared = await service.prepare(root, projectId, operations.map(operation), ['src']);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    expect(await read(fs, root, 'src/new.txt')).toBe('created');
    expect(await read(fs, root, 'src/edit.txt')).toBe('replaced');
    expect(await read(fs, root, 'src/patch.txt')).toBe('patched');
    expect(await read(fs, root, 'src/remove.txt')).toBeUndefined();
    expect(await read(fs, root, 'src/move.txt')).toBeUndefined();
    expect(await read(fs, root, 'src/moved.txt')).toBe('move');
    expect((await prepared.value.markValidated()).ok).toBe(true);
    expect(
      await fs.exists(join(root, '.itstudio', 'tx', '00000000-0000-4000-8000-000000000002', 'orig', 'src', 'edit.txt')),
    ).toEqual({ ok: true, value: false });
  });

  it('TC-M6-032 rejects stale base hashes, wrong patch context, and create-over-existing without writes', async () => {
    const { root, service } = await fixture({ 'src/a.txt': 'actual' });
    const stale = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'new', baseHash: digest('old') })],
      ['src'],
    );
    expect(stale).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });
    const patch = await service.prepare(
      root,
      projectId,
      [
        operation({
          kind: 'patch',
          path: 'src/a.txt',
          unifiedDiff: '@@ -1 +1 @@\n-wrong\n+new',
          baseHash: digest('actual'),
        }),
      ],
      ['src'],
    );
    expect(patch).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });
    const create = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'create', path: 'src/a.txt', content: 'new' })],
      ['src'],
    );
    expect(create).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });
  });

  it('rejects patching a file that is not valid UTF-8', async () => {
    const { fs, root, service } = await fixture();
    const bytes = new Uint8Array([0xff]);
    await fs.mkdir(join(root, 'src'), true);
    await fs.writeFile(join(root, 'src', 'invalid.txt'), bytes);
    const baseHash = sha256Schema.parse(createHash('sha256').update(bytes).digest('hex'));
    const result = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'patch', path: 'src/invalid.txt', unifiedDiff: '@@ -1 +1 @@\n-a\n+b', baseHash })],
      ['src'],
    );
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });
  });

  it('parses valid journal manifests and rejects invalid manifest shapes', async () => {
    const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
    const prepared = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    const encoded = await read(fs, root, '.itstudio/tx/00000000-0000-4000-8000-000000000002/manifest.json');
    expect(parseTransactionManifest({})).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
    expect(encoded).toBeDefined();
    expect(parseTransactionManifest(JSON.parse(encoded ?? '{}'))).toMatchObject({ ok: true });
  });

  it.each(['after_prepare', 'mid_commit'] as const)(
    'limits crash hook %s to test-only process execution',
    async (stage) => {
      const { root, service } = await fixture();
      vi.stubEnv('ITSTUDIO_E2E', '1');
      vi.stubEnv('ITSTUDIO_E2E_CRASH_AT', stage);
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('simulated process exit');
      });
      try {
        const operations = [
          operation({ kind: 'create', path: 'src/one.txt', content: 'one' }),
          operation({ kind: 'create', path: 'src/two.txt', content: 'two' }),
        ];
        if (stage === 'after_prepare') {
          await expect(service.prepare(root, projectId, operations, ['src'])).rejects.toThrow('simulated process exit');
        } else {
          vi.stubEnv('ITSTUDIO_E2E_CRASH_AT', '');
          const prepared = await service.prepare(root, projectId, operations, ['src']);
          if (!prepared.ok) throw new Error('Test transaction should prepare');
          vi.stubEnv('ITSTUDIO_E2E_CRASH_AT', stage);
          await expect(prepared.value.commit()).rejects.toThrow('simulated process exit');
        }
        expect(exit).toHaveBeenCalledWith(91);
      } finally {
        exit.mockRestore();
        vi.unstubAllEnvs();
      }
    },
  );

  it('rejects rename collisions and reports destination inspection failures', async () => {
    const collision = await fixture({ 'src/from.txt': 'from', 'src/to.txt': 'to' });
    const existingTarget = await collision.service.prepare(
      collision.root,
      projectId,
      [operation({ kind: 'rename', from: 'src/from.txt', to: 'src/to.txt', baseHash: digest('from') })],
      ['src'],
    );
    expect(existingTarget).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });

    const failing = await fixture({ 'src/from.txt': 'from' });
    failing.fs.injectFailureAtInvocation(11);
    const inspectionFailure = await failing.service.prepare(
      failing.root,
      projectId,
      [operation({ kind: 'rename', from: 'src/from.txt', to: 'src/to.txt', baseHash: digest('from') })],
      ['src'],
    );
    failing.fs.clearFailureInjection();
    expect(inspectionFailure).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
  });

  it('returns an internal error when the source existence check fails', async () => {
    const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
    fs.injectFailureAtInvocation(5);
    const result = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    fs.clearFailureInjection();
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
  });

  it('rolls back byte-identical originals after an injected commit failure', async () => {
    for (let successfulMutations = 0; successfulMutations < 5; successfulMutations += 1) {
      const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
      const prepared = await service.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      fs.injectFailureAfter(successfulMutations);
      const result = await prepared.value.commit();
      expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
      expect(await read(fs, root, 'src/a.txt')).toBe('before');
      expect(await fs.exists(join(root, 'src', 'a.txt.itstudio-tmp'))).toEqual({ ok: true, value: false });
    }
  });

  it('injects failures at every prepare filesystem call without changing workspace files', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 40; invocation += 1) {
      const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
      fs.injectFailureAtInvocation(invocation);
      const prepared = await service.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
        ['src'],
      );
      fs.clearFailureInjection();
      expect(await read(fs, root, 'src/a.txt')).toBe('before');
      if (prepared.ok) {
        reachedSuccess = true;
        break;
      }
      expect(prepared.error.code).toBeTruthy();
    }
    expect(reachedSuccess).toBe(true);
  });

  it('injects failures at every commit and rollback filesystem call', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 40; invocation += 1) {
      const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
      const prepared = await service.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      fs.injectFailureAtInvocation(invocation);
      const result = await prepared.value.commit();
      fs.clearFailureInjection();
      if (result.ok) {
        reachedSuccess = true;
        break;
      }
      const content = await read(fs, root, 'src/a.txt');
      if (result.error.code === ErrorCode.ROLLBACK_FAILED) {
        expect(result.error.remediation?.some((path) => path.includes('.itstudio'))).toBe(true);
      } else {
        expect(result.error.code).toBe(ErrorCode.INTERNAL);
        expect(content).toBe('before');
      }
    }
    expect(reachedSuccess).toBe(true);
  });

  it('injects failures through delete and rename commit operations', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 60; invocation += 1) {
      const { fs, root, service } = await fixture({ 'src/remove.txt': 'remove', 'src/move.txt': 'move' });
      const prepared = await service.prepare(
        root,
        projectId,
        [
          operation({ kind: 'delete', path: 'src/remove.txt', baseHash: digest('remove') }),
          operation({ kind: 'rename', from: 'src/move.txt', to: 'src/moved.txt', baseHash: digest('move') }),
        ],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      fs.injectFailureAtInvocation(invocation);
      const result = await prepared.value.commit();
      fs.clearFailureInjection();
      if (result.ok) {
        reachedSuccess = true;
        break;
      }
      if (result.error.code === ErrorCode.ROLLBACK_FAILED) {
        expect(result.error.remediation?.some((path) => path.includes('.itstudio'))).toBe(true);
      } else {
        expect(await read(fs, root, 'src/remove.txt')).toBe('remove');
        expect(await read(fs, root, 'src/move.txt')).toBe('move');
        expect(await read(fs, root, 'src/moved.txt')).toBeUndefined();
      }
    }
    expect(reachedSuccess).toBe(true);
  });

  it('reports rollback failures when a new-file delete or target verification fails', async () => {
    const { fs, root, service } = await fixture();
    const prepared = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'create', path: 'src/new.txt', content: 'new' })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    fs.injectFailureAtInvocation(2);
    const result = await prepared.value.rollback();
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.ROLLBACK_FAILED } });
    expect(result.ok || result.error.remediation?.some((path) => path.includes('manifest.json'))).toBe(true);
  });

  it('TC-M6-033 reports exact journal paths when rollback detects a damaged snapshot', async () => {
    const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
    const prepared = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const snapshot = join(root, '.itstudio', 'tx', '00000000-0000-4000-8000-000000000002', 'orig', 'src', 'a.txt');
    await fs.writeFile(snapshot, 'damaged');
    const rolledBack = await prepared.value.rollback();
    expect(rolledBack).toMatchObject({
      ok: false,
      error: { code: ErrorCode.ROLLBACK_FAILED, remediation: [snapshot, expect.any(String)] },
    });
  });

  it('rejects duplicate paths and disallowed paths', async () => {
    const { root, service } = await fixture({ 'src/a.txt': 'x' });
    const duplicate = await service.prepare(
      root,
      projectId,
      [
        operation({ kind: 'delete', path: 'src/a.txt', baseHash: digest('x') }),
        operation({ kind: 'create', path: 'src/a.txt', content: 'y' }),
      ],
      ['src'],
    );
    expect(duplicate).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });
    const disallowed = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'create', path: 'other/a.txt', content: 'x' })],
      ['src'],
    );
    expect(disallowed).toMatchObject({ ok: false, error: { code: ErrorCode.PATH_OUTSIDE_WORKSPACE } });
  });

  it('covers invalid inputs, missing files, and transaction state guards', async () => {
    const { root, service } = await fixture({ 'src/a.txt': 'before' });
    expect(await service.prepare(root, projectId, [], ['src'])).toMatchObject({
      ok: false,
      error: { code: ErrorCode.VALIDATION },
    });
    // @ts-expect-error Deliberately malformed to exercise runtime schema validation.
    expect(await service.prepare(root, projectId, [{ kind: 'unknown' }], ['src'])).toMatchObject({
      ok: false,
      error: { code: ErrorCode.VALIDATION },
    });
    expect(
      await service.prepare(
        root,
        projectId,
        [operation({ kind: 'delete', path: 'src/missing.txt', baseHash: digest('x') })],
        ['src'],
      ),
    ).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });

    const prepared = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(await prepared.value.markValidated()).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });
    expect((await prepared.value.commit()).ok).toBe(true);
    expect(await prepared.value.commit()).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });
    expect((await prepared.value.markValidated()).ok).toBe(true);
    expect(await prepared.value.markValidated()).toMatchObject({
      ok: false,
      error: { code: ErrorCode.CONFLICT },
    });
  });

  it('detects workspace races between prepare and commit', async () => {
    const createFixture = await fixture();
    const create = await createFixture.service.prepare(
      createFixture.root,
      projectId,
      [operation({ kind: 'create', path: 'src/new.txt', content: 'new' })],
      ['src'],
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    await createFixture.fs.writeFile(join(createFixture.root, 'src', 'new.txt'), 'raced');
    expect(await create.value.commit()).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });

    const replaceFixture = await fixture({ 'src/a.txt': 'before' });
    const replace = await replaceFixture.service.prepare(
      replaceFixture.root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    expect(replace.ok).toBe(true);
    if (!replace.ok) return;
    await replaceFixture.fs.writeFile(join(replaceFixture.root, 'src', 'a.txt'), 'raced');
    expect(await replace.value.commit()).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });

    const deleteFixture = await fixture({ 'src/a.txt': 'before' });
    const deleting = await deleteFixture.service.prepare(
      deleteFixture.root,
      projectId,
      [operation({ kind: 'delete', path: 'src/a.txt', baseHash: digest('before') })],
      ['src'],
    );
    expect(deleting.ok).toBe(true);
    if (!deleting.ok) return;
    await deleteFixture.fs.unlink(join(deleteFixture.root, 'src', 'a.txt'));
    expect(await deleting.value.commit()).toMatchObject({ ok: false, error: { code: ErrorCode.PATCH_CONFLICT } });

    const renameFixture = await fixture({ 'src/a.txt': 'before' });
    const renaming = await renameFixture.service.prepare(
      renameFixture.root,
      projectId,
      [operation({ kind: 'rename', from: 'src/a.txt', to: 'src/b.txt', baseHash: digest('before') })],
      ['src'],
    );
    expect(renaming.ok).toBe(true);
    if (!renaming.ok) return;
    await renameFixture.fs.writeFile(join(renameFixture.root, 'src', 'b.txt'), 'raced');
    expect(await renaming.value.commit()).toMatchObject({ ok: false, error: { code: ErrorCode.CONFLICT } });
  });

  it('covers retention cleanup filesystem failures and create-only journals', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 20; invocation += 1) {
      const { fs, root, service } = await fixture();
      await fs.mkdir(join(root, 'src'), true);
      await fs.writeFile(join(root, 'src', 'a.txt'), 'before');
      const prepared = await service.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect((await prepared.value.commit()).ok).toBe(true);
      fs.injectFailureAtInvocation(invocation);
      const result = await prepared.value.markValidated();
      fs.clearFailureInjection();
      if (result.ok) {
        reachedSuccess = true;
        continue;
      }
      expect(result.error.code).toBe(ErrorCode.INTERNAL);
    }
    expect(reachedSuccess).toBe(true);
  });

  it('returns ROLLBACK_FAILED for failures at each restore step', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 12; invocation += 1) {
      const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
      const prepared = await service.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      fs.injectFailureAtInvocation(invocation);
      const result = await prepared.value.rollback();
      fs.clearFailureInjection();
      if (result.ok) {
        reachedSuccess = true;
        break;
      }
      expect(result.error.code).toBe(ErrorCode.ROLLBACK_FAILED);
      expect(result.error.remediation?.some((path) => path.includes('.itstudio'))).toBe(true);
    }
    expect(reachedSuccess).toBe(true);
  });

  it('returns ROLLBACK_FAILED when both commit and snapshot restoration fail', async () => {
    const { fs, root, service } = await fixture({ 'src/a.txt': 'before' });
    const prepared = await service.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'after', baseHash: digest('before') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    fs.injectFailuresAtInvocations(3, 5);
    const result = await prepared.value.commit();
    fs.clearFailureInjection();
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.ROLLBACK_FAILED } });
    expect(result.ok || result.error.remediation?.some((path) => path.includes('orig'))).toBe(true);
  });
});
