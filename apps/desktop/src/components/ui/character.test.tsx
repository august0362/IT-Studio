import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon } from './Icon';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';
import { Button } from './primitives';

afterEach(cleanup);

describe('UX-06 visual vocabulary', () => {
  it('names standalone SVGs and hides decorative icons from the accessibility tree', () => {
    render(
      <>
        <Icon name="studio" label="IT Studio" />
        <Icon name="chat" label="Trò chuyện" />
        <Button>
          <Icon name="plus" />
          New project
        </Button>
      </>,
    );
    expect(screen.getByRole('img', { name: 'IT Studio' })).toHaveAttribute('focusable', 'false');
    expect(screen.getByRole('img', { name: 'Trò chuyện' })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'New project' }).querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('renders a labelled heading and an actionable empty state without exposing decorative artwork', () => {
    const start = vi.fn();
    render(
      <>
        <PageHeader title="Projects" subtitle="A home for every idea" icon="projects" />
        <EmptyState
          icon="projects"
          description="Start your first project"
          action={<Button onClick={start}>New project</Button>}
        />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    expect(screen.getByText('Start your first project')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(start).toHaveBeenCalledOnce();
  });

  it('disables entrance, dialog, toast and press motion for the OS preference and the in-app setting', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../index.css'), 'utf8');
    const os = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
      css.indexOf(":root[data-motion='reduced']"),
    );
    const setting = css.slice(
      css.indexOf(":root[data-motion='reduced']"),
      css.indexOf('@media (forced-colors: active)'),
    );
    for (const rules of [os, setting]) {
      expect(rules).toMatch(/animation: none !important/u);
      expect(rules).toMatch(/transition: none !important/u);
      expect(rules).toMatch(/scroll-behavior: auto !important/u);
      expect(rules).toMatch(/\.studio-button:not\(:disabled\):active\s*\{\s*transform: none/u);
    }
    const viewer = readFileSync(resolve(import.meta.dirname, '../../features/processes/process-viewer.css'), 'utf8');
    expect(viewer).not.toMatch(/^\.studio-empty\s*\{/mu);
  });
});
