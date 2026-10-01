import { render, screen } from '@testing-library/react';
import { ProviderId } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import type {} from '../vitest.config';
import { App } from './App';

describe('App', () => {
  it('renders the app heading and provider count', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'IT Studio' })).toBeVisible();
    expect(screen.getByText(new RegExp(`providers: ${String(Object.keys(ProviderId).length)}`))).toBeVisible();
  });
});
