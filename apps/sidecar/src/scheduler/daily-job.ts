import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { FxService } from '../services/fx-service.js';
import type { SettingsService } from '../services/settings-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IntervalTimers {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

export interface DailyJobDependencies {
  readonly fx: FxService;
  readonly settings: SettingsService;
  readonly clock: IClock;
  readonly logger: Logger;
  readonly timers?: IntervalTimers;
}

export class FxDailyJob {
  private readonly deps: DailyJobDependencies;
  private readonly timers: IntervalTimers;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(dependencies: DailyJobDependencies) {
    this.deps = dependencies;
    this.timers = dependencies.timers ?? { setInterval, clearInterval };
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = this.timers.setInterval(() => void this.runIfDue(), DAY_MS);
    this.timer.unref();
    void this.runIfDue();
  }

  stop(): void {
    if (this.timer === undefined) return;
    this.timers.clearInterval(this.timer);
    this.timer = undefined;
  }

  runIfDue(): Promise<void> {
    if (this.inFlight !== undefined) return this.inFlight;
    const run = this.runOnce();
    this.inFlight = run;
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = undefined;
    });
    return run;
  }

  private async runOnce(): Promise<void> {
    try {
      const settings = await this.deps.settings.get();
      if (!settings.ok || !settings.value.fx.autoUpdate) return;
      const latest = this.deps.fx.latestAuto();
      const stale = latest === null || this.deps.clock.now().getTime() - Date.parse(latest.asOf) >= DAY_MS;
      if (!stale) return;
      const result = await this.deps.fx.update();
      if (!result.ok)
        this.deps.logger.warn({ svc: 'fx', code: result.error.code }, 'Daily FX update failed; retaining current rate');
    } catch (error) {
      this.deps.logger.warn(
        { svc: 'fx', error: error instanceof Error ? error.message : 'unknown' },
        'Daily FX update failed; retaining current rate',
      );
    }
  }
}
