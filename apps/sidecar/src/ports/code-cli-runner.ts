import type { Result } from '@itstudio/schemas';
import type { ResolvedCodeCli } from '../domain/code-cli.js';

export interface CodeCliOutput {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ICodeCliRunner {
  run(cli: ResolvedCodeCli, args: readonly string[]): Promise<Result<CodeCliOutput>>;
  launch(cli: ResolvedCodeCli, args: readonly string[]): Result<void>;
}
