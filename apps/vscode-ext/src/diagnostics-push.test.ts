import { describe, expect, it } from 'vitest';
import { DiagnosticsPush, capDiagnostics, type DiagnosticsTimer } from './diagnostics-push';

interface TestDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

class FakeTimer implements DiagnosticsTimer {
  private nextId = 0;
  public readonly callbacks = new Map<number, () => void>();
  public readonly delays: number[] = [];

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.delays.push(delayMs);
    return id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  public fireAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

function diagnostic(severity: TestDiagnostic['severity'], index: number): TestDiagnostic {
  return { severity, message: String(index) };
}

describe('DiagnosticsPush', () => {
  it('debounces diagnostic changes for 500 ms and sends the latest workspace snapshot', () => {
    const timer = new FakeTimer();
    let snapshot: readonly TestDiagnostic[] = [diagnostic('error', 1)];
    const sent: (readonly TestDiagnostic[])[] = [];
    const push = new DiagnosticsPush({ timer, snapshot: () => snapshot, send: (value) => sent.push(value) });
    push.setConnected(true);
    push.changed();
    snapshot = [diagnostic('warning', 2)];
    push.changed();
    expect(timer.delays).toEqual([500, 500]);
    expect(timer.callbacks.size).toBe(1);
    timer.fireAll();
    expect(sent).toEqual([[diagnostic('warning', 2)]]);
  });

  it('does not schedule while disconnected and cancels a pending push on disconnect', () => {
    const timer = new FakeTimer();
    const sent: (readonly TestDiagnostic[])[] = [];
    const push = new DiagnosticsPush({ timer, snapshot: () => [], send: (value) => sent.push(value) });
    push.changed();
    expect(timer.callbacks.size).toBe(0);
    push.setConnected(true);
    push.changed();
    push.setConnected(false);
    timer.fireAll();
    expect(sent).toEqual([]);
  });

  it('caps at 500 with errors first, then warnings, preserving order within each severity', () => {
    const all = [
      ...Array.from({ length: 501 }, (_, index) => diagnostic('info', index)),
      diagnostic('warning', 600),
      diagnostic('error', 601),
    ];
    const capped = capDiagnostics(all);
    expect(capped).toHaveLength(500);
    expect(capped[0]?.severity).toBe('error');
    expect(capped[1]?.severity).toBe('warning');
    expect(capped[2]?.message).toBe('0');
    expect(capped.at(-1)?.message).toBe('497');
  });
});
