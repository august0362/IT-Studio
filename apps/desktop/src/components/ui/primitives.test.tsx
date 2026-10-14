import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '../../theme/apply-theme';
import { resolveTheme } from '../../theme/catalog';
import { Button, Card, Chip, Input, KpiTile } from './primitives';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
});

describe('shared glow primitives', () => {
  it.each(['neon-gold', 'neon-cyan', 'neon-violet'])('snapshots semantic dark primitives for %s', (id) => {
    const theme = resolveTheme(id, 'dark', false);
    applyTheme(id, 'dark', theme.tokens);
    const { container } = render(
      <Card aria-label="Project overview">
        <Button tone="primary">Run</Button>
        <Button>Cancel</Button>
        <Button tone="danger">Delete</Button>
        <Input aria-label="Project name" placeholder="Project name" />
        <Chip tone="success">Ready</Chip>
        <KpiTile label="Requests" value="120">
          Completed today
        </KpiTile>
      </Card>,
    );
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-glow')).toBe(theme.tokens.glow);
    expect({
      theme: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.mode,
      variables: document.documentElement.style.cssText,
      markup: container.firstChild,
    }).toMatchSnapshot();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('textbox', { name: 'Project name' })).toBeVisible();
  });

  it('preserves native disabled controls and caller labels', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Verifying…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Verifying…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
