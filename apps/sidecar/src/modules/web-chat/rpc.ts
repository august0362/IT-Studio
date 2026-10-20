import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { WebChatModule } from './index.js';

export function registerWebChatRpc(server: RpcServer, { service }: WebChatModule): void {
  server.register('webchat.browsers', () => service.browsers());
  server.register('webchat.open', ({ linkId }) => service.open(linkId));
  server.register('webchat.projectBrief', ({ projectId }) => service.projectBrief(projectId));
}
