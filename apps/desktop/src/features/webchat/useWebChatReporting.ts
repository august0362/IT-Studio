import type { ProjectId, RpcMethodMap, WebChatLayout, WebChatLinkId } from '@itstudio/schemas';
import { useCallback, useEffect, useRef } from 'react';
import { useRpcClient } from '../../rpc/rpc-context';

type PaneEvent = RpcMethodMap['process.report']['params']['event'];
export function useWebChatReporting(layout: WebChatLayout, available: boolean, projectId: ProjectId | null) {
  const rpc = useRpcClient();
  const open = useRef(new Set<WebChatLinkId>());
  const report = useCallback(
    (linkId: string, event: PaneEvent): void => {
      void rpc
        .call('process.report', { kind: 'web_chat', linkId, event, ...(projectId === null ? {} : { projectId }) })
        .catch((cause: unknown) => {
          console.warn('Web-chat process reporting failed.', { linkId, event, cause });
        });
    },
    [rpc, projectId],
  );
  useEffect(() => {
    if (!available) return;
    const ids = new Set(layout.panes);
    for (const id of open.current)
      if (!ids.has(id)) {
        report(id, 'closed');
        open.current.delete(id);
      }
    for (const id of ids)
      if (!open.current.has(id)) {
        open.current.add(id);
        report(id, 'opened');
      }
  }, [layout.panes, available, report]);
  useEffect(() => {
    const opened = open.current;
    return () => {
      for (const id of opened) report(id, 'closed');
      opened.clear();
    };
  }, [report]);
  const failed = useCallback(
    (linkIds: readonly WebChatLinkId[]): void => {
      for (const id of new Set(linkIds)) {
        if (!open.current.has(id)) continue;
        report(id, 'failed');
      }
    },
    [report],
  );
  return failed;
}
