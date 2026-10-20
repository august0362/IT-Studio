import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { WorkflowModule } from '../workflow/index.js';
import type { ChatModule } from './index.js';

export function registerChatRpc(
  server: RpcServer,
  { repository, service }: ChatModule,
  workflow: WorkflowModule,
): void {
  server.register('chat.listConversations', ({ projectId }) => service.listConversations(projectId));
  server.register('chat.createConversation', ({ projectId, title }) => service.createConversation(projectId, title));
  server.register('chat.getMessages', ({ conversationId }) => service.getMessages(conversationId));
  server.register('chat.setRagEnabled', ({ conversationId, enabled }) =>
    service.setRagEnabled(conversationId, enabled),
  );
  server.register('chat.send', async ({ conversationId, text, modelOverride }) => {
    const conversation = await repository.getConversation(conversationId);
    const result = await service.send(conversationId, text, modelOverride);
    if (result.ok && conversation !== null)
      workflow.recorder.correlateRequest(result.value.requestId, {
        projectId: conversation.projectId,
        conversationId,
      });
    return result;
  });
  server.register('chat.cancel', ({ requestId }) => service.cancel(requestId));
}
