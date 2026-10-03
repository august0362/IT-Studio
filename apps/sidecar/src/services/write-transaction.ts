import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  ErrorCode,
  type AppError,
  type FileOperation,
  type Result,
  type WriteTransaction as WriteTransactionContract,
} from '@itstudio/schemas';
import { z } from 'zod';
import { applyUnifiedDiff } from '../domain/unified-diff.js';
import { resolveSafe } from '../domain/path-guard.js';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import { transactionIdSchema } from '../validation/brand.js';
import { fileOperationSchema } from '../validation/worker.js';
import { writeTransactionSchema } from '../validation/worker.js';
import type { IFileSystem } from '../ports/file-system.js';

const originalSchema = z.object({
  path: z.string(),
  existed: z.boolean(),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
const manifestSchema = z.object({
  transaction: writeTransactionSchema,
  originals: z.array(originalSchema),
  createdDirectories: z.array(z.string()).default([]),
});
export type TransactionManifest = z.infer<typeof manifestSchema>;

function hash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function failure(
  code: AppError['code'],
  message: string,
  remediation: readonly string[] = ['Review the workspace and retry the operation.'],
): Result<never> {
  return { ok: false, error: { code, message, remediation, retryable: false } };
}

function fsError<T>(_result: { readonly ok: false }, path: string): Result<T> {
  return failure(ErrorCode.INTERNAL, `A file system operation failed for ${path}.`);
}

function operationPaths(operation: FileOperation): readonly string[] {
  return operation.kind === 'rename' ? [operation.from, operation.to] : [operation.path];
}

function asBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function crashAt(stage: 'after_prepare' | 'mid_commit'): void {
  if (process.env.ITSTUDIO_E2E === '1' && process.env.ITSTUDIO_E2E_CRASH_AT === stage) process.exit(91);
}

export interface WriteTransactionDependencies {
  readonly fileSystem: IFileSystem;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
}

interface PreparedOperation {
  readonly operation: FileOperation;
  readonly source: string;
  readonly destination?: string;
  readonly content?: Uint8Array;
}

/** Coordinates one journaled workspace transaction. Journal paths are intentionally internal. */
export class WriteTransactionService {
  private readonly fs: IFileSystem;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;

  constructor(dependencies: WriteTransactionDependencies) {
    this.fs = dependencies.fileSystem;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
  }

  async prepare(
    projectRoot: string,
    projectId: WriteTransactionContract['projectId'],
    operations: readonly FileOperation[],
    allowedPaths: readonly string[],
  ): Promise<Result<PreparedWriteTransaction>> {
    const parsed = z.array(fileOperationSchema).max(200).safeParse(operations);
    if (!parsed.success) return failure(ErrorCode.VALIDATION, 'The transaction contains invalid file operations.');
    if (operations.length === 0)
      return failure(ErrorCode.VALIDATION, 'The transaction must contain at least one operation.');
    const rootResult = await this.fs.realpath(projectRoot);
    if (!rootResult.ok) return failure(ErrorCode.NOT_FOUND, 'The project folder is unavailable.');
    const root = rootResult.value;
    const paths = operations.flatMap(operationPaths);
    const unique = new Set(paths.map((path) => path.toLocaleLowerCase('en-US')));
    if (unique.size !== paths.length)
      return failure(ErrorCode.CONFLICT, 'A transaction cannot modify the same path more than once.');

    const resolved = new Map<string, string>();
    for (const path of paths) {
      const safe = await resolveSafe(root, path, allowedPaths, this.fs);
      if (!safe.ok) return safe;
      resolved.set(path, safe.value);
    }

    const prepared: PreparedOperation[] = [];
    const originals = new Map<string, Uint8Array | undefined>();
    for (const operation of operations) {
      const sourceRel = operation.kind === 'rename' ? operation.from : operation.path;
      // Every operation path was resolved in the preceding loop; this protects internal map drift.
      /* v8 ignore next */
      const source = resolved.get(sourceRel);
      // sourceRel comes from operationPaths, the exact set used to populate resolved.
      /* v8 ignore next */
      if (!source) return failure(ErrorCode.PATH_OUTSIDE_WORKSPACE, 'A transaction path could not be resolved.');
      const exists = await this.fs.exists(source);
      if (!exists.ok) return fsError(exists, source);
      if (operation.kind === 'create') {
        if (exists.value) return failure(ErrorCode.CONFLICT, `Cannot create ${sourceRel}; the file already exists.`);
        originals.set(sourceRel, undefined);
        prepared.push({ operation, source, content: asBytes(operation.content) });
        continue;
      }
      if (!exists.value)
        return failure(ErrorCode.PATCH_CONFLICT, `Cannot modify ${sourceRel}; the file no longer exists.`);
      const read = await this.fs.readFile(source);
      if (!read.ok) return fsError(read, source);
      if (hash(read.value) !== operation.baseHash)
        return failure(ErrorCode.PATCH_CONFLICT, `The base content of ${sourceRel} has changed.`);
      originals.set(sourceRel, read.value);
      if (operation.kind === 'replace') prepared.push({ operation, source, content: asBytes(operation.content) });
      else if (operation.kind === 'patch') {
        let currentText: string;
        try {
          currentText = new TextDecoder('utf-8', { fatal: true }).decode(read.value);
        } catch {
          return failure(ErrorCode.PATCH_CONFLICT, `The base content of ${sourceRel} is not valid UTF-8 text.`);
        }
        const applied = applyUnifiedDiff(currentText, operation.unifiedDiff);
        if (!applied.ok) return applied;
        prepared.push({ operation, source, content: asBytes(applied.value) });
      } else if (operation.kind === 'rename') {
        const destinationRel = operation.to;
        // Rename destinations are resolved above from this same operation's path list.
        /* v8 ignore next */
        const destination = resolved.get(destinationRel);
        // The path list was already resolved from operation.to, so this map entry must exist.
        /* v8 ignore next */
        if (!destination) return failure(ErrorCode.PATH_OUTSIDE_WORKSPACE, 'A transaction path could not be resolved.');
        const targetExists = await this.fs.exists(destination);
        if (!targetExists.ok) return fsError(targetExists, destination);
        if (targetExists.value)
          return failure(ErrorCode.CONFLICT, `Cannot rename to ${destinationRel}; the file already exists.`);
        originals.set(destinationRel, undefined);
        prepared.push({ operation, source, destination });
      } else prepared.push({ operation, source });
    }

    const id = transactionIdSchema.parse(this.ids.uuid());
    const journalDir = join(root, '.itstudio', 'tx', id);
    const origDir = join(journalDir, 'orig');
    const made = await this.fs.mkdir(origDir, true);
    if (!made.ok) return fsError(made, origDir);
    const entries = [...originals.entries()].map(([path, data]) => ({
      path,
      existed: data !== undefined,
      ...(data ? { hash: hash(data) } : {}),
    }));
    for (const [path, data] of originals) {
      if (!data) continue;
      const snapshot = join(origDir, ...path.split('/'));
      const dir = await this.fs.mkdir(dirname(snapshot), true);
      if (!dir.ok) return fsError(dir, snapshot);
      const written = await this.fs.writeFile(snapshot, data);
      if (!written.ok) return fsError(written, snapshot);
      const synced = await this.fs.fsync(snapshot);
      if (!synced.ok) return fsError(synced, snapshot);
    }
    const transaction: WriteTransactionContract = {
      id,
      projectId,
      operations,
      snapshotRef: journalDir,
      status: 'prepared',
      createdAt: this.clock.now().toISOString() as WriteTransactionContract['createdAt'],
    };
    const manifestPath = join(journalDir, 'manifest.json');
    const manifestWritten = await this.writeManifest(manifestPath, {
      transaction,
      originals: entries,
      createdDirectories: [],
    });
    if (!manifestWritten.ok) return manifestWritten;
    crashAt('after_prepare');
    return {
      ok: true,
      value: new PreparedWriteTransaction(this.fs, root, journalDir, manifestPath, transaction, entries, [], prepared),
    };
  }

  private async writeManifest(path: string, manifest: TransactionManifest): Promise<Result<void>> {
    const written = await this.fs.writeFile(path, JSON.stringify(manifest));
    if (!written.ok) return fsError(written, path);
    const synced = await this.fs.fsync(path);
    return synced.ok ? synced : fsError(synced, path);
  }
}

export class PreparedWriteTransaction {
  readonly transactionId: WriteTransactionContract['id'];
  private readonly fs: IFileSystem;
  private readonly root: string;
  private readonly journalDir: string;
  private readonly manifestPath: string;
  private readonly transaction: WriteTransactionContract;
  private readonly originals: TransactionManifest['originals'];
  private readonly createdDirectories: string[];
  private readonly prepared: readonly PreparedOperation[];
  private status: WriteTransactionContract['status'] = 'prepared';

  constructor(
    fs: IFileSystem,
    root: string,
    journalDir: string,
    manifestPath: string,
    transaction: WriteTransactionContract,
    originals: TransactionManifest['originals'],
    createdDirectories: readonly string[],
    prepared: readonly PreparedOperation[],
  ) {
    this.fs = fs;
    this.root = root;
    this.journalDir = journalDir;
    this.manifestPath = manifestPath;
    this.transaction = transaction;
    this.transactionId = transaction.id;
    this.originals = originals;
    this.createdDirectories = [...createdDirectories];
    this.prepared = prepared;
  }

  async commit(): Promise<Result<void>> {
    if (this.status !== 'prepared') return failure(ErrorCode.CONFLICT, 'The transaction is no longer prepared.');
    const ordinary = this.prepared.filter(
      ({ operation }) => operation.kind !== 'rename' && operation.kind !== 'delete',
    );
    const final = this.prepared.filter(({ operation }) => operation.kind === 'rename' || operation.kind === 'delete');
    for (const item of this.prepared) {
      const op = item.operation;
      const sourceExists = await this.fs.exists(item.source);
      if (!sourceExists.ok) return fsError(sourceExists, item.source);
      if (op.kind === 'create' ? sourceExists.value : !sourceExists.value)
        return failure(
          op.kind === 'create' ? ErrorCode.CONFLICT : ErrorCode.PATCH_CONFLICT,
          'A workspace path changed after transaction preparation.',
        );
      if (op.kind !== 'create') {
        const current = await this.fs.readFile(item.source);
        if (!current.ok) return fsError(current, item.source);
        if (hash(current.value) !== op.baseHash)
          return failure(ErrorCode.PATCH_CONFLICT, 'A file changed after transaction preparation.');
      }
      if (op.kind === 'rename' && item.destination) {
        const destinationExists = await this.fs.exists(item.destination);
        if (!destinationExists.ok) return fsError(destinationExists, item.destination);
        if (destinationExists.value)
          return failure(ErrorCode.CONFLICT, 'A rename destination appeared after transaction preparation.');
      }
    }
    let committedOperations = 0;
    const parentDirectories = new Set<string>();
    for (const item of this.prepared) {
      const destination = item.operation.kind === 'rename' ? item.destination : item.source;
      if (!destination) continue;
      let parent = dirname(destination);
      while (parent !== this.root) {
        parentDirectories.add(parent);
        const next = dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    const orderedParents = [...parentDirectories].sort((left, right) => {
      const depthDifference = left.split(/[\\/]/).length - right.split(/[\\/]/).length;
      return depthDifference === 0 ? left.localeCompare(right) : depthDifference;
    });
    for (const directory of orderedParents) {
      const exists = await this.fs.exists(directory);
      if (!exists.ok) return this.failAndRollback();
      if (exists.value) continue;
      const relativeDirectory = directory.slice(this.root.length + 1).replaceAll('\\', '/');
      this.createdDirectories.push(relativeDirectory);
      const journaled = await this.saveStatus('prepared');
      if (!journaled.ok) return this.failAndRollback();
      const made = await this.fs.mkdir(directory, false);
      if (!made.ok) {
        const nowExists = await this.fs.exists(directory);
        if (!nowExists.ok || !nowExists.value) return this.failAndRollback();
        this.createdDirectories.pop();
        const updated = await this.saveStatus('prepared');
        if (!updated.ok) return this.failAndRollback();
      }
    }
    for (const item of [...ordinary, ...final]) {
      const op = item.operation;
      if (op.kind === 'delete') {
        const removed = await this.fs.unlink(item.source);
        if (!removed.ok) return this.failAndRollback();
      } else if (op.kind === 'rename') {
        const target = item.destination;
        // Only rename preparation creates a rename item, and it always carries a resolved destination.
        /* v8 ignore next */
        if (!target) return this.failAndRollback();
        const moved = await this.fs.rename(item.source, target);
        if (!moved.ok) return this.failAndRollback();
      } else {
        const temp = `${item.source}.itstudio-tmp`;
        // Create, replace, and patch preparation always computes content; keep the fallback for defensive use.
        /* v8 ignore next */
        const written = await this.fs.writeFile(temp, item.content ?? new Uint8Array());
        if (!written.ok) return this.failAndRollback();
        const synced = await this.fs.fsync(temp);
        if (!synced.ok) return this.failAndRollback();
        const moved = await this.fs.rename(temp, item.source);
        if (!moved.ok) return this.failAndRollback();
      }
      committedOperations += 1;
      if (committedOperations === 1 && this.prepared.length > 1) crashAt('mid_commit');
    }
    this.status = 'committed';
    const updated = await this.saveStatus('committed');
    if (!updated.ok) return this.failAndRollback();
    return { ok: true, value: undefined };
  }

  async markValidated(): Promise<Result<void>> {
    if (this.status !== 'committed')
      return failure(ErrorCode.CONFLICT, 'Only a committed transaction can be validated.');
    const updated = await this.saveStatus('validated');
    if (!updated.ok) return updated;
    this.status = 'validated';
    const removed = await this.removeTree(join(this.journalDir, 'orig'));
    return removed.ok ? { ok: true, value: undefined } : removed;
  }

  async rollback(): Promise<Result<void>> {
    const remediation: string[] = [];
    for (const original of this.originals) {
      const target = join(this.root, ...original.path.split('/'));
      const temporary = `${target}.itstudio-tmp`;
      const temporaryExists = await this.fs.exists(temporary);
      if (!temporaryExists.ok || (temporaryExists.value && !(await this.fs.unlink(temporary)).ok))
        remediation.push(temporary);
      if (!original.existed) {
        const exists = await this.fs.exists(target);
        if (!exists.ok || (exists.value && !(await this.fs.unlink(target)).ok)) remediation.push(target);
      } else {
        const snapshot = join(this.journalDir, 'orig', ...original.path.split('/'));
        const bytes = await this.fs.readFile(snapshot);
        if (!bytes.ok || (original.hash && hash(bytes.value) !== original.hash)) {
          remediation.push(snapshot);
          continue;
        }
        const dir = await this.fs.mkdir(dirname(target), true);
        const temp = `${target}.itstudio-tmp`;
        const write = dir.ok ? await this.fs.writeFile(temp, bytes.value) : dir;
        const sync = write.ok ? await this.fs.fsync(temp) : write;
        const rename = sync.ok ? await this.fs.rename(temp, target) : sync;
        const verify = rename.ok ? await this.fs.readFile(target) : rename;
        if (!verify.ok || hash(verify.value) !== original.hash) remediation.push(target);
      }
    }
    for (const directory of [...this.createdDirectories].reverse()) {
      const path = join(this.root, ...directory.split('/'));
      const removed = await this.fs.rmdirIfEmpty(path);
      if (!removed.ok) remediation.push(path);
    }
    if (remediation.length > 0) {
      this.status = 'rollback_failed';
      await this.saveStatus('rollback_failed');
      return failure(ErrorCode.ROLLBACK_FAILED, 'The transaction could not restore all original files.', [
        ...new Set([...remediation, this.manifestPath]),
      ]);
    }
    this.status = 'rolled_back';
    const updated = await this.saveStatus('rolled_back');
    if (!updated.ok)
      return failure(
        ErrorCode.ROLLBACK_FAILED,
        'The files were restored but the rollback status could not be recorded.',
        [this.manifestPath],
      );
    return { ok: true, value: undefined };
  }

  private async failAndRollback(): Promise<Result<void>> {
    const rolledBack = await this.rollback();
    return rolledBack.ok
      ? failure(ErrorCode.INTERNAL, 'The transaction failed and all workspace changes were rolled back.')
      : rolledBack;
  }

  private async saveStatus(status: WriteTransactionContract['status']): Promise<Result<void>> {
    const manifest = { transaction: { ...this.transaction, status }, originals: this.originals };
    const written = await this.fs.writeFile(
      this.manifestPath,
      JSON.stringify({ ...manifest, createdDirectories: this.createdDirectories }),
    );
    if (!written.ok) return failure(ErrorCode.INTERNAL, `Could not write transaction manifest ${this.manifestPath}.`);
    const synced = await this.fs.fsync(this.manifestPath);
    return synced.ok
      ? { ok: true, value: undefined }
      : failure(ErrorCode.INTERNAL, `Could not sync transaction manifest ${this.manifestPath}.`);
  }

  private async removeTree(path: string): Promise<Result<void>> {
    const exists = await this.fs.exists(path);
    if (!exists.ok || !exists.value) return { ok: true, value: undefined };
    const entries = await this.fs.readdir(path);
    if (!entries.ok) return failure(ErrorCode.INTERNAL, `Could not list journal directory ${path}.`);
    for (const entry of entries.value) {
      const child = join(path, entry);
      const stat = await this.fs.stat(child);
      if (!stat.ok) return failure(ErrorCode.INTERNAL, `Could not inspect journal path ${child}.`);
      const result = stat.value.isDirectory ? await this.removeTree(child) : await this.fs.unlink(child);
      if (!result.ok) return result;
    }
    return { ok: true, value: undefined };
  }
}

export function parseTransactionManifest(value: unknown): Result<TransactionManifest> {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) return failure(ErrorCode.VALIDATION, 'The transaction journal manifest is invalid.');
  return { ok: true, value: parsed.data };
}
