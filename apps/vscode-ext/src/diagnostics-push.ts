export interface SeverityDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
}

export interface DiagnosticsTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DiagnosticsPushOptions<T extends SeverityDiagnostic> {
  readonly timer: DiagnosticsTimer;
  readonly snapshot: () => readonly T[];
  readonly send: (diagnostics: readonly T[]) => void;
}

export const MAX_DIAGNOSTICS = 500;

export function capDiagnostics<T extends SeverityDiagnostic>(diagnostics: readonly T[]): readonly T[] {
  return diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((left, right) => severityOrder(left.diagnostic) - severityOrder(right.diagnostic) || left.index - right.index)
    .slice(0, MAX_DIAGNOSTICS)
    .map(({ diagnostic }) => diagnostic);
}

export class DiagnosticsPush<T extends SeverityDiagnostic> {
  private readonly options: DiagnosticsPushOptions<T>;
  private timer: unknown;
  private connected = false;
  private disposed = false;

  public constructor(options: DiagnosticsPushOptions<T>) {
    this.options = options;
  }

  public setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.cancel();
  }

  public changed(): void {
    if (!this.connected || this.disposed) return;
    this.cancel();
    this.timer = this.options.timer.setTimeout(() => {
      this.timer = undefined;
      if (this.connected && !this.disposed) this.options.send(capDiagnostics(this.options.snapshot()));
    }, 500);
  }

  public dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== undefined) this.options.timer.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function severityOrder(diagnostic: SeverityDiagnostic): number {
  if (diagnostic.severity === 'error') return 0;
  if (diagnostic.severity === 'warning') return 1;
  return 2;
}
