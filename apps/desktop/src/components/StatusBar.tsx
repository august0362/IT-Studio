import type { JSX } from 'react';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { useSidecarStatus } from '../state/sidecar-store';
import { themeCatalog } from '../theme/catalog';

export function StatusBar(): JSX.Element {
  const { status, fatal } = useSidecarStatus();
  const ping = useRpcQuery('system.ping', {}, { enabled: status.ready && fatal === null, retry: false });
  const settings = useRpcQuery('settings.get', {});
  const activeTheme = themeCatalog.themes.find((theme) => theme.id === settings.data?.ui.themeId);

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
      className="border-t border-border bg-surface px-4 py-2 text-sm"
      title={`Theme: ${activeTheme?.name ?? 'Default'} · ${settings.data?.ui.mode ?? 'system'} mode`}
      role={fatal === null ? 'status' : 'alert'}
    >
      <span className={fatal === null ? 'text-text-muted' : 'font-medium text-danger'}>{label}</span>
    </footer>
  );
}
