import { describe, expect, it } from 'vitest';
import type {} from '../vitest.config';
import { statusLabel } from './status';

describe('statusLabel', () => {
  it('labels the idle state', () => {
    expect(statusLabel('idle')).toBe('IT Studio: idle');
  });

  it('labels the connected state', () => {
    expect(statusLabel('connected')).toBe('IT Studio: connected');
  });

  it('labels the disconnected state', () => {
    expect(statusLabel('disconnected')).toBe('IT Studio: disconnected');
  });
});
