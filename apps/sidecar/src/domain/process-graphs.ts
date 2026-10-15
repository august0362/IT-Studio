import type { ProcessEdge, ProcessKind, ProcessModule } from '@itstudio/schemas';

export const PROCESS_MODULES: Readonly<Record<ProcessKind, readonly string[]>> = {
  chat: ['input', 'context', 'router', 'provider', 'stream', 'cost', 'output'],
  code_pipeline: ['request', 'clarify', 'spec', 'code', 'review', 'fix', 're_review', 'write', 'validate', 'done'],
  knowledge_ingest: ['discover', 'parse', 'chunk', 'embed', 'store', 'done'],
  image: ['prompt', 'budget', 'provider', 'download', 'store', 'gallery'],
  price_update: ['sources', 'fetch', 'extract', 'validate', 'save'],
  key_verify: ['input', 'request', 'result'],
  vscode_launch: ['locate', 'launch', 'session'],
  web_chat: ['open', 'load', 'active', 'closed'],
};
export function processGraph(kind: ProcessKind): { modules: readonly ProcessModule[]; edges: readonly ProcessEdge[] } {
  const ids = PROCESS_MODULES[kind];
  const edges = ids.flatMap((to, index) => {
    const from = ids[index - 1];
    return from === undefined ? [] : [{ from, to }];
  });
  if (kind === 'code_pipeline') edges.push({ from: 'review', to: 'write' }, { from: 're_review', to: 'write' });
  return {
    modules: ids.map((id) => ({
      id,
      label: id.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase()),
      state: 'idle',
    })),
    edges,
  };
}
