import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@itstudio/schemas';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import { projectIdSchema, sha256Schema } from '../validation/brand.js';
import { fileOperationSchema } from '../validation/worker.js';
import { JournalRecoveryService } from './journal-recovery.js';
import { WriteTransactionService } from './write-transaction.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const txId = '00000000-0000-4000-8000-000000000002';
const digest = (text: string) => sha256Schema.parse(createHash('sha256').update(text).digest('hex'));
const operation = (value: unknown) => fileOperationSchema.parse(value);

async function setup(): Promise<{
  fs: MemoryFileSystem;
  root: string;
  clock: ReturnType<typeof createFakeClock>;
  writer: WriteTransactionService;
}> {
  const fs = new MemoryFileSystem();
  const root = resolve(process.cwd(), 'memory-recovery-project');
  await fs.mkdir(root, true);
  await fs.mkdir(join(root, 'src'), true);
  await fs.writeFile(join(root, 'src', 'a.txt'), 'original');
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'));
  const writer = new WriteTransactionService({ fileSystem: fs, ids: createFakeIdGenerator([txId]), clock });
  return { fs, root, clock, writer };
}

describe('JournalRecoveryService', () => {
  it('TC-M6-030 and TC-M6-031 restore prepared and committed journals and return the recovered count', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'changed', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    const recovery = new JournalRecoveryService(fs, clock);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 1 });
    const content = await fs.readFile(join(root, 'src', 'a.txt'));
    expect(content.ok && new TextDecoder().decode(content.value)).toBe('original');

    const nextWriter = new WriteTransactionService({ fileSystem: fs, ids: createFakeIdGenerator([txId]), clock });
    const second = await nextWriter.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'committed', baseHash: digest('original') })],
      ['src'],
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect((await second.value.commit()).ok).toBe(true);
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toEqual({ ok: true, value: 1 });
    const restored = await fs.readFile(join(root, 'src', 'a.txt'));
    expect(restored.ok && new TextDecoder().decode(restored.value)).toBe('original');
  });

  it('removes transaction-created directories during crash recovery', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'create', path: 'src/recovery/new.txt', content: 'new' })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    expect(await fs.exists(join(root, 'src', 'recovery'))).toEqual({ ok: true, value: true });
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toEqual({ ok: true, value: 1 });
    expect(await fs.exists(join(root, 'src', 'recovery'))).toEqual({ ok: true, value: false });
    const original = await fs.readFile(join(root, 'src', 'a.txt'));
    expect(original.ok && new TextDecoder().decode(original.value)).toBe('original');
  });

  it('leaves recent validated journals and purges their manifests after seven days', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'validated', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    expect((await prepared.value.markValidated()).ok).toBe(true);
    const manifest = join(root, '.itstudio', 'tx', txId, 'manifest.json');
    expect(await fs.exists(manifest)).toEqual({ ok: true, value: true });
    const recovery = new JournalRecoveryService(fs, clock);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 0 });
    expect(await fs.exists(join(root, 'src', 'a.txt'))).toEqual({ ok: true, value: true });
    clock.advance(8 * 24 * 60 * 60 * 1000);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 0 });
    expect(await fs.exists(manifest)).toEqual({ ok: true, value: false });
  });

  it('keeps a validated manifest at the exact seven-day boundary and purges it one millisecond later', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'validated', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    expect((await prepared.value.markValidated()).ok).toBe(true);
    const manifest = join(root, '.itstudio', 'tx', txId, 'manifest.json');
    const recovery = new JournalRecoveryService(fs, clock);
    const retention = 7 * 24 * 60 * 60 * 1000;
    clock.advance(retention - 1);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 0 });
    expect(await fs.exists(manifest)).toEqual({ ok: true, value: true });
    clock.advance(1);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 0 });
    expect(await fs.exists(manifest)).toEqual({ ok: true, value: true });
    clock.advance(1);
    expect(await recovery.recover(root)).toEqual({ ok: true, value: 0 });
    expect(await fs.exists(manifest)).toEqual({ ok: true, value: false });
  });

  it('reports unknown statuses and missing original snapshots with journal paths', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'changed', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const manifest = join(root, '.itstudio', 'tx', txId, 'manifest.json');
    const unknown = await fs.readFile(manifest);
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    const data = JSON.parse(new TextDecoder().decode(unknown.value)) as { transaction: { status: string } };
    data.transaction.status = 'unknown';
    await fs.writeFile(manifest, JSON.stringify(data));
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toMatchObject({
      ok: false,
      error: { remediation: [manifest] },
    });

    data.transaction.status = 'prepared';
    await fs.writeFile(manifest, JSON.stringify(data));
    const snapshot = join(root, '.itstudio', 'tx', txId, 'orig', 'src', 'a.txt');
    await fs.unlink(snapshot);
    const result = await new JournalRecoveryService(fs, clock).recover(root);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.ROLLBACK_FAILED } });
    expect(result.ok || result.error.remediation?.some((path) => path === snapshot)).toBe(true);
  });

  it('continues safely when every recovery filesystem call fails in turn', async () => {
    let reachedSuccess = false;
    for (let invocation = 1; invocation < 40; invocation += 1) {
      const { fs, root, clock, writer } = await setup();
      const prepared = await writer.prepare(
        root,
        projectId,
        [operation({ kind: 'replace', path: 'src/a.txt', content: 'changed', baseHash: digest('original') })],
        ['src'],
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      fs.injectFailureAtInvocation(invocation);
      const result = await new JournalRecoveryService(fs, clock).recover(root);
      fs.clearFailureInjection();
      if (result.ok) {
        reachedSuccess = true;
        break;
      }
      expect(result.error.code).toBe(ErrorCode.ROLLBACK_FAILED);
      expect(result.error.remediation?.length).toBeGreaterThan(0);
    }
    expect(reachedSuccess).toBe(true);
  });

  it('recovers rename journals and rejects manifests with mismatched original paths', async () => {
    const renameFixture = await setup();
    const renaming = await renameFixture.writer.prepare(
      renameFixture.root,
      projectId,
      [operation({ kind: 'rename', from: 'src/a.txt', to: 'src/b.txt', baseHash: digest('original') })],
      ['src'],
    );
    expect(renaming.ok).toBe(true);
    expect(await new JournalRecoveryService(renameFixture.fs, renameFixture.clock).recover(renameFixture.root)).toEqual(
      {
        ok: true,
        value: 1,
      },
    );

    const mismatch = await setup();
    const prepared = await mismatch.writer.prepare(
      mismatch.root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'changed', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    const manifest = join(mismatch.root, '.itstudio', 'tx', txId, 'manifest.json');
    const raw = await mismatch.fs.readFile(manifest);
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const value = JSON.parse(new TextDecoder().decode(raw.value)) as {
      originals: readonly unknown[];
    };
    const altered = { ...value, originals: [] };
    await mismatch.fs.writeFile(manifest, JSON.stringify(altered));
    expect(await new JournalRecoveryService(mismatch.fs, mismatch.clock).recover(mismatch.root)).toMatchObject({
      ok: false,
      error: { code: ErrorCode.ROLLBACK_FAILED, remediation: [manifest] },
    });
  });

  it('reports failure to purge an expired validated manifest', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'validated', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await prepared.value.commit()).ok).toBe(true);
    expect((await prepared.value.markValidated()).ok).toBe(true);
    clock.advance(7 * 24 * 60 * 60 * 1000 + 1);
    fs.injectFailureAtInvocation(6);
    const result = await new JournalRecoveryService(fs, clock).recover(root);
    fs.clearFailureInjection();
    expect(result).toMatchObject({
      ok: false,
      error: { remediation: [join(root, '.itstudio', 'tx', txId, 'manifest.json')] },
    });
  });

  it('ignores valid rolled-back journals and journals without manifests', async () => {
    const { fs, root, clock, writer } = await setup();
    const prepared = await writer.prepare(
      root,
      projectId,
      [operation({ kind: 'replace', path: 'src/a.txt', content: 'changed', baseHash: digest('original') })],
      ['src'],
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const manifest = join(root, '.itstudio', 'tx', txId, 'manifest.json');
    const raw = await fs.readFile(manifest);
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const value = JSON.parse(new TextDecoder().decode(raw.value)) as { transaction: { status: string } };
    value.transaction.status = 'rolled_back';
    await fs.writeFile(manifest, JSON.stringify(value));
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toEqual({ ok: true, value: 0 });

    await fs.mkdir(join(root, '.itstudio', 'tx', 'empty-journal'), true);
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toEqual({ ok: true, value: 0 });
  });

  it('ignores absent journal directories and reports malformed manifests', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'memory-empty-recovery');
    await fs.mkdir(root, true);
    const clock = createFakeClock();
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toEqual({ ok: true, value: 0 });
    await fs.mkdir(join(root, '.itstudio', 'tx', 'broken'), true);
    await fs.writeFile(join(root, '.itstudio', 'tx', 'broken', 'manifest.json'), '{');
    expect(await new JournalRecoveryService(fs, clock).recover(root)).toMatchObject({ ok: false });
  });
});
