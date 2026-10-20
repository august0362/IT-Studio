import type { IProcessRunner } from '../../../kernel/ports/process-runner.js';
import { CliAgentAdapter } from './cli-adapter.js';
export class ClaudeCliAdapter extends CliAgentAdapter {
  constructor(runner: IProcessRunner) {
    super('claude', runner);
  }
}
