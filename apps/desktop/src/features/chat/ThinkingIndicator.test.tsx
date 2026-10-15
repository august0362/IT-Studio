import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { i18n } from '../../i18n';
import { ThinkingIndicator } from './ThinkingIndicator';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

it('announces thinking in Vietnamese and keeps reduced-motion dots static', async () => {
  await i18n.changeLanguage('vi');
  render(<ThinkingIndicator />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Đang trả lời…');
  expect(status).toHaveAttribute('aria-live', 'polite');
  const dots = status.querySelectorAll('[aria-hidden="true"] > span');
  expect(dots).toHaveLength(3);
  dots.forEach((dot) => {
    expect(dot).toHaveClass('motion-safe:animate-bounce', 'motion-reduce:animate-none');
  });
  const streamingStyles = readFileSync(resolve(import.meta.dirname, 'streaming.css'), 'utf8');
  expect(streamingStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});
