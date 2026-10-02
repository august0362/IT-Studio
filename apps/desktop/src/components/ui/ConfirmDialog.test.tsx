import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

function renderDialog(open = true) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <>
      <button type="button">Trigger</button>
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        message="Delete this key?"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open={open}
        title="Delete API key?"
        tone="danger"
      />
    </>,
  );
  return { ...result, onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders labelled dialog and focuses Cancel on open', () => {
    renderDialog();
    expect(screen.getByRole('alertdialog', { name: 'Delete API key?', description: 'Delete this key?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('cancels on Escape and backdrop click', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('confirm-dialog-backdrop'), {
      target: screen.getByTestId('confirm-dialog-backdrop'),
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('traps Tab and Shift+Tab and confirms once', () => {
    const { onConfirm } = renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('returns focus to the triggering button when closed', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              setOpen(true);
            }}
            type="button"
          >
            Trigger
          </button>
          <ConfirmDialog
            cancelLabel="Cancel"
            confirmLabel="Delete"
            message="Delete this key?"
            onCancel={() => {
              setOpen(false);
            }}
            onConfirm={vi.fn()}
            open={open}
            title="Delete API key?"
            tone="danger"
          />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Trigger' })).toHaveFocus();
  });
});
