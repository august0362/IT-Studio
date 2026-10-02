import type { AppError } from '@itstudio/schemas';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorPanel } from './ErrorPanel';

const retryableError: AppError = {
  code: 'PROVIDER_TIMEOUT',
  message: 'The request timed out.',
  remediation: ['Check your connection.', 'Try again.'],
  retryable: true,
};

afterEach(cleanup);

describe('ErrorPanel', () => {
  it('shows the message, numbered remediation, code, and retry button when retryable', () => {
    const onRetry = vi.fn();
    render(<ErrorPanel error={retryableError} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The request timed out.');
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('PROVIDER_TIMEOUT').tagName).toBe('SMALL');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits retry for non-retryable errors and without a callback', () => {
    const { rerender } = render(<ErrorPanel error={{ ...retryableError, retryable: false }} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const withoutRemediation: AppError = {
      code: 'INTERNAL',
      message: 'Unexpected error.',
      retryable: false,
    };
    rerender(<ErrorPanel error={withoutRemediation} />);
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<ErrorPanel error={retryableError} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
