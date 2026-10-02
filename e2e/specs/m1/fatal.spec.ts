import { remote } from 'webdriverio';
import { expect } from 'chai';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

describe('M1 fatal restart limit', () => {
  it('TC-M1-041 shows the blocking fatal banner with the log folder', async () => {
    const capabilities: TauriCapabilities = {
      browserName: 'wry',
      'tauri:options': {
        application: `${process.cwd()}\\apps\\desktop\\src-tauri\\target\\debug\\itstudio-desktop.exe`,
      },
    };
    const fatalBrowser = await remote({
      hostname: '127.0.0.1',
      port: 4445,
      path: '/',
      capabilities,
    });
    try {
      const banner = fatalBrowser.$('footer[role="alert"]');
      // 6 cold sidecar starts (~4 s each in dev, tsx) + restart backoff 1+2+4+8+16 s; see PERF-01.
      await banner.waitForDisplayed({ timeout: 150_000 });
      expect(await banner.getText()).to.include('Sidecar restarted more than 5 times');
      expect(await banner.getText()).to.include('Logs:');
    } finally {
      await fatalBrowser.deleteSession();
    }
  });
});
