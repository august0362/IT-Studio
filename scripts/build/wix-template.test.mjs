import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../../apps/desktop/src-tauri/tauri.conf.release.json', import.meta.url);
const templateUrl = new URL('../../apps/desktop/src-tauri/wix/main.wxs', import.meta.url);

test('TC-M9-009 release MSI uses a per-user WiX template under Local AppData', async () => {
  const config = JSON.parse(await readFile(configUrl, 'utf8'));
  const template = await readFile(templateUrl, 'utf8');

  assert.equal(config.bundle.windows.wix.template, 'target/itstudio-wix/main.generated.wxs');
  assert.match(template, /InstallScope="perUser"/);
  assert.match(template, /<Directory Id="LocalAppDataFolder">\s*<Directory Id="INSTALLDIR"/);
  assert.doesNotMatch(template, /InstallScope="perMachine"/);
  assert.doesNotMatch(template, /PlatformProgramFilesFolder|ProgramFiles64Folder/);
  assert.match(template, /<RegistryKey Root="HKCU" Key="Software\\Classes\\\\\{\{protocol\}\}"/);
});

test('TC-M9-009 explicit INSTALLDIR takes precedence over prior HKCU install paths', async () => {
  const template = await readFile(templateUrl, 'utf8');
  const previousPathProperty = template.match(/<Property Id="PREVIOUS_INSTALLDIR">([\s\S]*?)<\/Property>/);

  assert.ok(previousPathProperty, 'registry discovery must use a separate previous-path property');
  assert.ok(previousPathProperty[1].includes('Id="PrevInstallDirNoName"'));
  assert.ok(previousPathProperty[1].includes('Id="PrevInstallDirWithName"'));
  assert.ok(
    previousPathProperty[1].indexOf('Id="PrevInstallDirNoName"') <
      previousPathProperty[1].indexOf('Id="PrevInstallDirWithName"'),
    'the MSI InstallDir registry value must take priority over the NSIS default value',
  );
  assert.doesNotMatch(template, /<Property Id="INSTALLDIR">/, 'AppSearch must not overwrite an explicit INSTALLDIR');

  const previousPathAssignment = template.match(
    /<SetDirectory Id="INSTALLDIR" Sequence="first" Value="\[PREVIOUS_INSTALLDIR\]"\s*>([\s\S]*?)<\/SetDirectory\s*>/,
  );
  assert.ok(previousPathAssignment, 'the previous path must be assigned once across UI/execute sequences');
  assert.equal(previousPathAssignment[1].trim(), 'NOT INSTALLDIR AND PREVIOUS_INSTALLDIR');
  assert.equal((template.match(/<SetDirectory Id="INSTALLDIR"/g) ?? []).length, 1);
});

test('TC-M9-009 custom WiX template retains Tauri installer metadata and resources', async () => {
  const template = await readFile(templateUrl, 'utf8');

  for (const placeholder of [
    '{{product_name}}',
    '{{upgrade_code}}',
    '{{main_binary_path}}',
    '<!-- ITSTUDIO_RESOURCE_TREE -->',
    '<!-- ITSTUDIO_RESOURCE_COMPONENT_REFS -->',
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
  assert.doesNotMatch(template, /\{\{resources\}\}|resource_file_ids/);
  assert.ok(template.includes(String.raw`Key="Software\\{{manufacturer}}\\{{product_name}}\Components"`));
});

test('TC-M9-009 per-user executable components use HKCU registry values as KeyPaths', async () => {
  const template = await readFile(templateUrl, 'utf8');

  for (const componentId of ['Path', '{{ bin.id }}', 'UpdateTask', 'UpdateTaskInstaller', 'UpdateTaskUninstaller']) {
    const component = template.match(
      new RegExp(
        `<Component Id="${componentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/Component>`,
      ),
    );
    assert.ok(component, `missing component ${componentId}`);
    assert.doesNotMatch(component[1], /<File\b[^>]*\bKeyPath="yes"/);
    assert.match(component[1], /<RegistryValue\s+Root="HKCU"[\s\S]*?KeyPath="yes"/);
    if (componentId === '{{ bin.id }}') {
      assert.ok(component[1].includes(String.raw`Key="Software\\{{../manufacturer}}\\{{../product_name}}\Components"`));
    }
  }
});
