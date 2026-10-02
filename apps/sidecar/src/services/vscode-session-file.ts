import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface VscodeSessionFile {
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: 1;
}

export interface SessionFileSystem {
  readonly mkdir: typeof mkdir;
  readonly readFile: typeof readFile;
  readonly writeFile: typeof writeFile;
  readonly rename: typeof rename;
  readonly appendFile: typeof appendFile;
}

const systemFileSystem: SessionFileSystem = { mkdir, readFile, writeFile, rename, appendFile };

export async function writeVscodeSessionFile(
  workspaceRoot: string,
  session: VscodeSessionFile,
  fs: SessionFileSystem = systemFileSystem,
): Promise<void> {
  const metadataDir = join(workspaceRoot, '.itstudio');
  await fs.mkdir(metadataDir, { recursive: true });
  await ensureGitignoreEntry(workspaceRoot, fs);
  const target = join(metadataDir, 'session.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(session)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureGitignoreEntry(workspaceRoot: string, fs: SessionFileSystem): Promise<void> {
  const gitignore = join(workspaceRoot, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(gitignore, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  if (existing.split(/\r?\n/u).some((line) => line.trim() === '.itstudio' || line.trim() === '.itstudio/')) return;
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.appendFile(gitignore, `${separator}.itstudio/\n`, 'utf8');
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
