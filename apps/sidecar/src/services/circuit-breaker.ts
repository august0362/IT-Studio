import {
  FailureKind,
  type CircuitBreakerConfig,
  type FailureKind as FailureKindType,
  type ModelKey,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';

type CircuitStatus = 'closed' | 'open' | 'half_open';
interface CircuitState {
  failures: number;
  status: CircuitStatus;
  openedAt: number;
  probeInFlight: boolean;
  quotaFailure: boolean;
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly clock: IClock;
  private readonly states = new Map<ModelKey, CircuitState>();
  private readonly onChange: (modelKey: ModelKey, status: CircuitStatus) => void;

  constructor(
    config: CircuitBreakerConfig,
    clock: IClock,
    onChange: (modelKey: ModelKey, status: CircuitStatus) => void,
  ) {
    this.config = config;
    this.clock = clock;
    this.onChange = onChange;
  }

  acquire(modelKey: ModelKey): boolean {
    const state = this.states.get(modelKey);
    if (state === undefined || state.status === 'closed') return true;
    if (state.status === 'open') {
      if (this.clock.monotonicMs() - state.openedAt < this.cooldown(state)) return false;
      state.status = 'half_open';
      this.onChange(modelKey, 'half_open');
    }
    if (state.probeInFlight) return false;
    state.probeInFlight = true;
    return true;
  }

  success(modelKey: ModelKey): void {
    const state = this.getState(modelKey);
    state.failures = 0;
    state.probeInFlight = false;
    if (state.status !== 'closed') {
      state.status = 'closed';
      this.onChange(modelKey, 'closed');
    }
  }

  failure(modelKey: ModelKey, kind: FailureKindType): void {
    const state = this.getState(modelKey);
    state.probeInFlight = false;
    if (!fallbackFailures.has(kind)) {
      state.failures = 0;
      state.quotaFailure = false;
      return;
    }
    state.failures += 1;
    state.quotaFailure = kind === FailureKind.QUOTA_EXHAUSTED;
    if (state.status === 'half_open' || state.failures >= this.config.failureThreshold) this.open(modelKey, state);
  }

  status(modelKey: ModelKey): CircuitStatus {
    const state = this.states.get(modelKey);
    if (state === undefined) return 'closed';
    if (state.status === 'open' && this.clock.monotonicMs() - state.openedAt >= this.cooldown(state)) {
      return 'half_open';
    }
    return state.status;
  }

  private cooldown(state: CircuitState): number {
    return state.failures > 0 && state.quotaFailure
      ? Math.max(this.config.cooldownMs, 3_600_000)
      : this.config.cooldownMs;
  }

  private open(modelKey: ModelKey, state: CircuitState): void {
    state.status = 'open';
    state.openedAt = this.clock.monotonicMs();
    this.onChange(modelKey, 'open');
  }

  private getState(modelKey: ModelKey): CircuitState {
    let state = this.states.get(modelKey);
    if (state === undefined) {
      state = { failures: 0, status: 'closed', openedAt: 0, probeInFlight: false, quotaFailure: false };
      this.states.set(modelKey, state);
    }
    return state;
  }
}

const fallbackFailures: ReadonlySet<FailureKindType> = new Set([
  FailureKind.RATE_LIMITED,
  FailureKind.QUOTA_EXHAUSTED,
  FailureKind.SERVER_ERROR,
  FailureKind.TIMEOUT,
]);
