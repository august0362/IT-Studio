import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { KnowledgeModule } from './index.js';

export function registerKnowledgeRpc(server: RpcServer, { rag }: KnowledgeModule): void {
  server.register('rag.ingest', (input) => rag.ingest(input));
  server.register('rag.query', (input) => rag.query(input));
  server.register('rag.listDocuments', (input) => rag.listDocuments(input));
  server.register('rag.deleteDocument', (input) => rag.deleteDocument(input));
}
