import type { JSX } from 'react';
import { ApiKeysPage } from './features/settings/api-keys/ApiKeysPage';
import { StatusBar } from './components/StatusBar';
import { neutralClasses } from './components/ui/neutral-classes';

export function App(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main navigation" className={`w-56 border-r ${neutralClasses.border} p-4`}>
          <h1 className="mb-6 text-lg font-semibold">IT Studio</h1>
          <a
            aria-current="page"
            className={`w-full rounded px-3 py-2 text-left ${neutralClasses.hoverSurface}`}
            href="#settings"
          >
            Settings
          </a>
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-6" id="settings">
          <ApiKeysPage />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
