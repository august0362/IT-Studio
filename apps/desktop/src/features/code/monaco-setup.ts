import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { resolveTheme } from '../../theme/catalog';

function alpha(hex: string): string {
  return `${hex}4D`;
}

export function setupMonaco(): void {
  loader.config({ monaco });
  const themeId = document.documentElement.dataset.theme ?? 'arctic-focus';
  const mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
  const { tokens } = resolveTheme(themeId, mode, mode === 'dark');
  monaco.editor.defineTheme('itstudio-active', {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': tokens.bg,
      'editor.foreground': tokens.text,
      'editor.lineHighlightBackground': tokens.surfaceAlt,
      'editorCursor.foreground': tokens.primary,
      'editor.selectionBackground': alpha(tokens.accent),
      'diffEditor.insertedTextBackground': alpha(tokens.success),
      'diffEditor.removedTextBackground': alpha(tokens.danger),
    },
  });
}

setupMonaco();
