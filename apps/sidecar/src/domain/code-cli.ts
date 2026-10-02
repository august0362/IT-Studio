import { basename, isAbsolute } from 'node:path';

const WINDOWS_CLI_LINE =
  /^[ \t]*"%~dp0\.\.\\Code\.exe"[ \t]+"%~dp0\.\.\\([^"\r\n]+\\resources\\app\\out\\cli\.js)"(?:[ \t]+[^\r\n]*)?$/imu;
const ACCEPTED_BASENAMES = new Set(['Code.exe', 'code', 'Code - Insiders.exe']);

const resolvedCodeCliBrand: unique symbol = Symbol('ResolvedCodeCli');

export interface ResolvedCodeCli {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
  readonly windows: boolean;
  readonly [resolvedCodeCliBrand]: true;
}

export interface ParsedCodeCmd {
  readonly executableRelativePath: string;
  readonly cliRelativePath: string;
}

export function parseCodeCmd(contents: string): ParsedCodeCmd | null {
  const match = WINDOWS_CLI_LINE.exec(contents);
  if (match?.[1] === undefined) return null;
  return { executableRelativePath: '..\\Code.exe', cliRelativePath: `..\\${match[1]}` };
}

export function isValidCodeExecutable(path: string): boolean {
  return isAbsolute(path) && ACCEPTED_BASENAMES.has(basename(path));
}

export function makeResolvedCodeCli(
  executable: string,
  prefixArgs: readonly string[],
  windows: boolean,
): ResolvedCodeCli | null {
  if (!isValidCodeExecutable(executable)) return null;
  return { executable, prefixArgs: [...prefixArgs], windows, [resolvedCodeCliBrand]: true };
}
