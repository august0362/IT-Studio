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
      await banner.waitForDisplayed({ timeout: 70_000 });
      expect(await banner.getText()).to.include('Sidecar restarted more than 5 times');
      expect(await banner.getText()).to.include('Logs:');
    } finally {
      await fatalBrowser.deleteSession();
    }
  });
});
