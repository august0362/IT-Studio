import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from '../../../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker';
import { resolveTheme } from '../../theme/catalog';

let themeObserver: MutationObserver | undefined;

function alpha(hex: string): string {
  return `${hex}4D`;
}

function applyActiveTheme(): void {
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
  monaco.editor.setTheme('itstudio-active');
}

export function setupMonaco(): void {
  loader.config({ monaco });
  globalThis.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  applyActiveTheme();
  if (themeObserver === undefined) {
    themeObserver = new MutationObserver(applyActiveTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode'],
    });
  }
}

setupMonaco();
