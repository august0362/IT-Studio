import { waitForReady, sidecarPid, waitForShutdown } from '../../helpers/ui.js';

describe('M1 graceful shutdown', () => {
  it('TC-M1-006 closes the app and sidecar without restarting', async () => {
    await waitForReady();
    const pid = await sidecarPid();

    try {
      await browser.closeWindow();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/All window handles were removed|session.*closed/i.test(message)) throw cause;
    }

    await waitForShutdown(pid, 7_000);
  });
});
