import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../../apps/desktop/src-tauri/tauri.conf.release.json', import.meta.url);
const templateUrl = new URL('../../apps/desktop/src-tauri/wix/main.wxs', import.meta.url);

test('release MSI uses a per-user WiX template under Local AppData', async () => {
  const config = JSON.parse(await readFile(configUrl, 'utf8'));
  const template = await readFile(templateUrl, 'utf8');

  assert.equal(config.bundle.windows.wix.template, 'wix/main.wxs');
  assert.match(template, /InstallScope="perUser"/);
  assert.match(template, /<Directory Id="LocalAppDataFolder">\s*<Directory Id="INSTALLDIR"/);
  assert.doesNotMatch(template, /InstallScope="perMachine"/);
  assert.doesNotMatch(template, /PlatformProgramFilesFolder|ProgramFiles64Folder/);
  assert.match(template, /<RegistryKey Root="HKCU" Key="Software\\Classes\\\\\{\{protocol\}\}"/);
});

test('custom WiX template retains Tauri installer metadata and resources', async () => {
  const template = await readFile(templateUrl, 'utf8');

  for (const placeholder of [
    '{{product_name}}',
    '{{upgrade_code}}',
    '{{main_binary_path}}',
    '{{resources}}',
    '{{webview2_bootstrapper_path}}',
    '{{webview_installer_args}}',
    '{{#each component_refs',
    '<MajorUpgrade',
    '<UIRef Id="WixUI_InstallDir" />',
  ]) {
    assert.ok(template.includes(placeholder), `missing Tauri installer element: ${placeholder}`);
  }

  assert.match(template, /<Shortcut\s+Id="ApplicationStartMenuShortcut"/);
  assert.match(template, /<Shortcut\s+Id="ApplicationDesktopShortcut"/);
});
