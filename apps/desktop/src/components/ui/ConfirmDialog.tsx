import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react';
import { neutralClasses } from './neutral-classes';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone: 'danger';
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    if (buttons === undefined || buttons.length === 0) return;
    const first = buttons.item(0);
    const last = buttons.item(buttons.length - 1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="confirm-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby="confirm-dialog-message"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className={`w-full max-w-md rounded-lg border ${neutralClasses.border} bg-white p-6 shadow-xl`}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="alertdialog"
      >
        <h2 className="mb-2 text-lg font-semibold" id="confirm-dialog-title">
          {title}
        </h2>
        <p className={`mb-6 ${neutralClasses.secondaryText}`} id="confirm-dialog-message">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            className={`rounded border ${neutralClasses.controlBorder} px-3 py-2 ${neutralClasses.hoverSurface}`}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="rounded border border-red-700 bg-red-700 px-3 py-2 text-white hover:bg-red-800"
            data-tone={tone}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
