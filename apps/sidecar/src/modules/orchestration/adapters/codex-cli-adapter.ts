import type { IProcessRunner } from '../../../kernel/ports/process-runner.js';
import { CliAgentAdapter } from './cli-adapter.js';
export class CodexCliAdapter extends CliAgentAdapter {
  constructor(runner: IProcessRunner) {
    super('codex', runner);
  }
}
