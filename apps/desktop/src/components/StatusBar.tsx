import type { JSX } from 'react';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { useSidecarStatus } from '../state/sidecar-store';
import { neutralClasses } from './ui/neutral-classes';

export function StatusBar(): JSX.Element {
  const { status, fatal } = useSidecarStatus();
  const ping = useRpcQuery('system.ping', {}, { enabled: status.ready && fatal === null, retry: false });

  let label = 'Connecting…';
  if (fatal !== null) {
    label = `Sidecar stopped: ${fatal.message}. Logs: ${fatal.logDir}`;
  } else if (status.restarts > 0 && !status.ready) {
    label = `Restarting (${String(status.restarts)})`;
  } else if (status.ready && ping.data !== undefined) {
    label = `Ready v${ping.data.version}`;
  }

  return (
    <footer
      aria-live="polite"
      className={`border-t ${neutralClasses.border} px-4 py-2 text-sm`}
      role={fatal === null ? 'status' : 'alert'}
    >
      <span className={fatal === null ? neutralClasses.statusText : 'font-medium'}>{label}</span>
    </footer>
  );
}
