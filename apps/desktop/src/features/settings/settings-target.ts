import { createContext } from 'react';

/** Search can reveal a conditional field without persisting a settings change. */
export const SettingsTargetContext = createContext<string | undefined>(undefined);
