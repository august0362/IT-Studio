import type { Result } from '@itstudio/schemas';

export interface ProcessRunInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ProcessRunOutput {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface IProcessRunner {
  run(input: ProcessRunInput): Promise<Result<ProcessRunOutput>>;
}
