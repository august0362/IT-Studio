import type { AppError } from '@itstudio/schemas';
import { useState, type JSX, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../components/ErrorPanel';
import { pickFolder } from './pick-folder';

export function NewProjectDialog({
  onCancel,
  onCreate,
  error,
}: {
  readonly onCancel: () => void;
  readonly onCreate: (name: string, workspaceRoot: string) => Promise<void>;
  readonly error: AppError | null;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function browse(): Promise<void> {
    setPicking(true);
    setValidation(null);
    try {
      const path = await pickFolder(t('projects.pickFolder'));
      if (path !== null) {
        setWorkspaceRoot(path);
        setName((current) =>
          current.trim().length > 0 ? current : (path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''),
        );
      }
    } catch {
      setValidation(t('projects.pickFolderError'));
    } finally {
      setPicking(false);
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (name.trim().length === 0) {
      setValidation(t('projects.nameRequired'));
      return;
    }
    if (workspaceRoot.trim().length === 0 || !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(workspaceRoot.trim())) {
      setValidation(t('projects.folderRequired'));
      return;
    }
    setValidation(null);
    setBusy(true);
    try {
      await onCreate(name.trim(), workspaceRoot.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-bg/80 p-4" role="presentation">
      <section
        aria-labelledby="new-project-heading"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 text-text shadow-lg"
        role="dialog"
      >
        <h2 className="mb-4 text-xl font-semibold" id="new-project-heading">
          {t('projects.new')}
        </h2>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label className="block">
            {t('projects.name')}
            <input
              autoFocus
              className="mt-1 block w-full rounded border border-border bg-bg px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </label>
          <div>
            <label className="block" htmlFor="new-project-folder">
              {t('projects.folder')}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="new-project-folder"
                className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
                onChange={(event) => {
                  setWorkspaceRoot(event.target.value);
                }}
                value={workspaceRoot}
              />
              <button
                className="flex items-center gap-2 rounded border border-border px-3 py-2 disabled:opacity-60"
                disabled={picking || busy}
                onClick={() => {
                  void browse();
                }}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 7V5h6l2 2h10v13H3V7Z" />
                </svg>
                {t('projects.browse')}
              </button>
            </div>
          </div>
          {validation !== null ? <p role="alert">{validation}</p> : null}
          {error !== null ? <ErrorPanel error={error} /> : null}
          <div className="flex justify-end gap-2">
            <button
              className="rounded border border-border px-3 py-2 hover:bg-surface-alt"
              onClick={onCancel}
              type="button"
            >
              {t('projects.cancel')}
            </button>
            <button
              className="rounded bg-primary px-3 py-2 text-primary-fg disabled:opacity-60"
              disabled={busy || picking}
              type="submit"
            >
              {t('projects.create')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
