import type { Result } from '@itstudio/schemas';

export interface SessionFileSystem {
  readFile(path: string): Promise<string>;
}

export interface Session {
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: 1;
}

export async function readSession(workspaceRoot: string, fs: SessionFileSystem): Promise<Result<Session>> {
  try {
    const contents = await fs.readFile(`${workspaceRoot}/.itstudio/session.json`);
    const value: unknown = JSON.parse(contents);
    if (
      !isRecord(value) ||
      !Number.isInteger(value.port) ||
      typeof value.port !== 'number' ||
      value.port < 1 ||
      value.port > 65535 ||
      value.protocolVersion !== 1 ||
      typeof value.token !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(value.token)
    ) {
      return { ok: false, error: sessionError('Invalid session file') };
    }
    return { ok: true, value: { port: value.port, token: value.token, protocolVersion: 1 } };
  } catch (error: unknown) {
    return { ok: false, error: sessionError(error instanceof Error ? error.message : 'Unable to read session file') };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sessionError(message: string) {
  return {
    code: 'VALIDATION' as const,
    message,
    retryable: false,
    remediation: ['Start or restart IT Studio for this project.'],
  };
}
