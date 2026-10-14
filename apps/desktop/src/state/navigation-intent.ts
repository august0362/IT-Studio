import { create } from 'zustand';

export type NavigationIntent =
  | { readonly kind: 'conversation'; readonly id: string }
  | { readonly kind: 'pipelineRun'; readonly id: string }
  | { readonly kind: 'ingestJob'; readonly id: string }
  | { readonly kind: 'ledger'; readonly id: string; readonly field: 'requestId' | 'pipelineRunId' };

interface NavigationIntentState {
  readonly intent: NavigationIntent | null;
  readonly setIntent: (intent: NavigationIntent) => void;
  readonly clearIntent: () => void;
}

export const useNavigationIntent = create<NavigationIntentState>((set) => ({
  intent: null,
  setIntent: (intent) => {
    set({ intent });
  },
  clearIntent: () => {
    set({ intent: null });
  },
}));
