import { ApiKeysPage } from './features/settings/api-keys/ApiKeysPage';
import { ThemePage } from './features/settings/theme/ThemePage';
import { StatusBar } from './components/StatusBar';
import { useState, type JSX } from 'react';
import { ThemeSync } from './theme/ThemeSync';

export function App(): JSX.Element {
  const [page, setPage] = useState<'api-keys' | 'theme'>('api-keys');
  return (
    <div className="flex min-h-screen flex-col">
      <ThemeSync />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main navigation" className="w-56 border-r border-border p-4">
          <h1 className="mb-6 text-lg font-semibold">IT Studio</h1>
          <a
            aria-current={page === 'api-keys' ? 'page' : undefined}
            className="block w-full rounded px-3 py-2 text-left hover:bg-surface-alt"
            href="#settings-api-keys"
            onClick={(event) => {
              event.preventDefault();
              setPage('api-keys');
            }}
          >
            Settings
          </a>
          <button
            aria-current={page === 'theme' ? 'page' : undefined}
            className="mt-1 w-full rounded px-3 py-2 text-left hover:bg-surface-alt"
            onClick={() => {
              setPage('theme');
            }}
            type="button"
          >
            Theme
          </button>
        </nav>
        <main className="min-w-0 flex-1 overflow-auto bg-bg p-6 text-text" id="settings-api-keys">
          {page === 'theme' ? <ThemePage /> : <ApiKeysPage />}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
