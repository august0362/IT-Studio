import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { ImagesModule } from './index.js';

export function registerImagesRpc(server: RpcServer, { service }: ImagesModule): void {
  server.register('images.list', ({ projectId }) => service.list(projectId));
  server.register('images.delete', ({ assetId }) => service.delete(assetId));
}
