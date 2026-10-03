import { ErrorCode, type AppError, type FileOperation, type Result } from '@itstudio/schemas';
import { join } from 'node:path';
import { resolveSafe } from '../domain/path-guard.js';
import type { IClock } from '../infra/clock.js';
import type { IFileSystem } from '../ports/file-system.js';
import { parseTransactionManifest, PreparedWriteTransaction } from './write-transaction.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function pathsFor(operation: FileOperation): readonly string[] {
  return operation.kind === 'rename' ? [operation.from, operation.to] : [operation.path];
}

function recoveryError(message: string, remediation: readonly string[]): Result<never> {
  const error: AppError = { code: ErrorCode.ROLLBACK_FAILED, message, remediation, retryable: false };
  return { ok: false, error };
}

/** Recovers prepared or committed journals at startup and expires old validated manifests. */
export class JournalRecoveryService {
  private readonly fs: IFileSystem;
  private readonly clock: IClock;

  constructor(fileSystem: IFileSystem, clock: IClock) {
    this.fs = fileSystem;
    this.clock = clock;
  }

  async recover(projectRoot: string): Promise<Result<number>> {
    const realRoot = await this.fs.realpath(projectRoot);
    if (!realRoot.ok) return recoveryError('The project folder is unavailable during journal recovery.', [projectRoot]);
    const transactionRoot = join(realRoot.value, '.itstudio', 'tx');
    const exists = await this.fs.exists(transactionRoot);
    if (!exists.ok) return recoveryError('Could not inspect the transaction journal directory.', [transactionRoot]);
    if (!exists.value) return { ok: true, value: 0 };
    const ids = await this.fs.readdir(transactionRoot);
    if (!ids.ok) return recoveryError('Could not list transaction journals.', [transactionRoot]);

    let recovered = 0;
    const failures: string[] = [];
    for (const id of ids.value) {
      const journalDir = join(transactionRoot, id);
      const manifestPath = join(journalDir, 'manifest.json');
      const hasManifest = await this.fs.exists(manifestPath);
      if (!hasManifest.ok) {
        failures.push(manifestPath);
        continue;
      }
      if (!hasManifest.value) continue;
      const raw = await this.fs.readFile(manifestPath);
      if (!raw.ok) {
        failures.push(manifestPath);
        continue;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.value)) as unknown;
      } catch {
        failures.push(manifestPath);
        continue;
      }
      const parsed = parseTransactionManifest(decoded);
      if (!parsed.ok) {
        failures.push(manifestPath);
        continue;
      }
      const { transaction, originals } = parsed.value;
      if (transaction.status === 'validated') {
        const age = this.clock.now().getTime() - Date.parse(transaction.createdAt);
        if (age > RETENTION_MS) {
          const removed = await this.fs.unlink(manifestPath);
          if (!removed.ok) failures.push(manifestPath);
        }
        continue;
      }
      if (transaction.status !== 'prepared' && transaction.status !== 'committed') continue;
      const operationPaths = transaction.operations.flatMap(pathsFor);
      const known = new Set(operationPaths);
      const possibleDirectories = new Set<string>();
      for (const path of operationPaths) {
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index += 1)
          possibleDirectories.add(segments.slice(0, index).join('/'));
      }
      if (
        originals.some((original) => !known.has(original.path)) ||
        originals.length !== known.size ||
        parsed.value.createdDirectories.some((directory) => !possibleDirectories.has(directory)) ||
        new Set(parsed.value.createdDirectories).size !== parsed.value.createdDirectories.length
      ) {
        failures.push(manifestPath);
        continue;
      }
      let pathsSafe = true;
      for (const path of operationPaths) {
        const safe = await resolveSafe(realRoot.value, path, [path], this.fs);
        if (!safe.ok) pathsSafe = false;
      }
      if (!pathsSafe) {
        failures.push(manifestPath);
        continue;
      }
      const handle = new PreparedWriteTransaction(
        this.fs,
        realRoot.value,
        journalDir,
        manifestPath,
        transaction,
        originals,
        parsed.value.createdDirectories,
        [],
      );
      const result = await handle.rollback();
      // PreparedWriteTransaction's failure helper always includes remediation paths.
      /* v8 ignore next */
      if (!result.ok) failures.push(...(result.error.remediation ?? [manifestPath]));
      else recovered += 1;
    }
    if (failures.length > 0)
      return recoveryError('Some transaction journals could not be recovered.', [...new Set(failures)]);
    return { ok: true, value: recovered };
  }
}
