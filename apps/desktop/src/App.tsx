import { ProviderId } from '@itstudio/schemas';
import type { JSX } from 'react';

export function App(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1>IT Studio</h1>
      <p>Skeleton — providers: {Object.keys(ProviderId).length}</p>
    </main>
  );
}
