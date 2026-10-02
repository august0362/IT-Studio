import { describe, expect, it } from 'vitest';
import type {} from '../vitest.config';
import { readSession, type SessionFileSystem } from './session';

const VALID_SESSION = JSON.stringify({ port: 43123, token: 'a'.repeat(64), protocolVersion: 1 });

function fileSystem(contents: string | Error): SessionFileSystem {
  return {
    readFile: () => (contents instanceof Error ? Promise.reject(contents) : Promise.resolve(contents)),
  };
}

describe('readSession', () => {
  it('reads a valid session file', async () => {
    await expect(readSession('C:/project', fileSystem(VALID_SESSION))).resolves.toEqual({
      ok: true,
      value: { port: 43123, token: 'a'.repeat(64), protocolVersion: 1 },
    });
  });

  it('returns a failure when the file is missing', async () => {
    const result = await readSession('C:/project', fileSystem(new Error('missing')));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('missing');
  });

  it('returns a failure for invalid JSON', async () => {
    expect((await readSession('C:/project', fileSystem('{'))).ok).toBe(false);
  });

  it.each([0, 65536, 1.5])('rejects invalid port %s', async (port) => {
    const contents = JSON.stringify({ port, token: 'a'.repeat(64), protocolVersion: 1 });
    expect((await readSession('C:/project', fileSystem(contents))).ok).toBe(false);
  });

  it.each(['short', 'g'.repeat(64)])('rejects invalid token %s', async (token) => {
    const contents = JSON.stringify({ port: 43123, token, protocolVersion: 1 });
    expect((await readSession('C:/project', fileSystem(contents))).ok).toBe(false);
  });
});
