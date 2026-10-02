import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { writeVscodeSessionFile } from './vscode-session-file.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('writeVscodeSessionFile', () => {
  it('TC-M7-008 atomically writes the session and appends the gitignore entry once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'itstudio-vscode-session-'));
    directories.push(root);
    const session = { port: 43210, token: 'a'.repeat(64), protocolVersion: 1 as const };
    await writeVscodeSessionFile(root, session);
    await writeVscodeSessionFile(root, session);
    const sessionJson: unknown = JSON.parse(readFileSync(join(root, '.itstudio', 'session.json'), 'utf8'));
    expect(z.object({ port: z.number(), token: z.string(), protocolVersion: z.literal(1) }).parse(sessionJson)).toEqual(
      session,
    );
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.itstudio/\n');
  });

  it('preserves an existing gitignore and recognizes an existing entry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'itstudio-vscode-ignore-'));
    directories.push(root);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, '.gitignore'), 'dist/\n.itstudio\n');
    await writeVscodeSessionFile(root, { port: 1, token: 'b'.repeat(64), protocolVersion: 1 });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('dist/\n.itstudio\n');
  });
});
