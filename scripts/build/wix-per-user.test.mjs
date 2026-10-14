import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { generatePerUserWixTemplate } from './wix-per-user.mjs';

const templatePath = new URL('../../apps/desktop/src-tauri/wix/main.wxs', import.meta.url);

test('TC-M9-009 generated MSI resource tree keeps paths and gives every per-user component an HKCU KeyPath', async (context) => {
  const temp = await mkdtemp(join(tmpdir(), 'itstudio-wix-'));
  context.after(() => rm(temp, { recursive: true, force: true }));
  const resourcesRoot = join(temp, 'resources');
  const nested = join(resourcesRoot, 'config', 'nested');
  await mkdir(nested, { recursive: true });
  await writeFile(join(resourcesRoot, 'manifest.json'), '{}');
  await writeFile(join(nested, 'a&b.json'), '{}');
  const outputPath = join(temp, 'generated', 'main.wxs');

  const result = await generatePerUserWixTemplate({ templatePath, resourcesRoot, outputPath });
  const generated = await readFile(outputPath, 'utf8');
  assert.equal(result.componentCount, 5); // three directories plus two files
  assert.doesNotMatch(generated, /ITSTUDIO_RESOURCE_TREE|ITSTUDIO_RESOURCE_COMPONENT_REFS/);
  assert.doesNotMatch(generated, /\{\{resources\}\}|resource_file_ids/);
  assert.match(generated, /<Directory Id="Dir_[a-f0-9]{32}" Name="resources">/);
  assert.match(generated, /<Directory Id="Dir_[a-f0-9]{32}" Name="config">/);
  assert.match(generated, /<Directory Id="Dir_[a-f0-9]{32}" Name="nested">/);
  assert.match(generated, /Name="a&amp;b\.json"/);
  assert.ok(generated.includes(String.raw`Key="Software\\{{manufacturer}}\\{{product_name}}\Components"`));
  assert.match(generated, /<ComponentRef Id="Resource_[a-f0-9]{32}" \/>/);

  const components = [
    ...generated.matchAll(/<Component Id="(?:Cleanup|Resource)_[a-f0-9]{32}"[^>]*>([\s\S]*?)<\/Component>/g),
  ];
  assert.equal(components.length, 5);
  for (const [, body] of components) {
    assert.match(body, /<RegistryValue Root="HKCU"[^>]*KeyPath="yes"/);
    assert.doesNotMatch(body, /<File\b[^>]*KeyPath="yes"/);
  }
  assert.equal([...generated.matchAll(/<RemoveFolder Id="Remove_[a-f0-9]{32}" On="uninstall" \/>/g)].length, 3);
  assert.equal([...generated.matchAll(/<ComponentRef Id="(?:Cleanup|Resource)_[a-f0-9]{32}" \/>/g)].length, 5);
  const source = generated.match(/<File Id="File_[a-f0-9]{32}" Source="([^"]+)"/);
  assert.ok(source);
  assert.ok(isAbsolute(source[1]));
});

test('TC-M9-009 resource component identities are stable for the same layout in separate worktrees', async (context) => {
  const temp = await mkdtemp(join(tmpdir(), 'itstudio-wix-ids-'));
  context.after(() => rm(temp, { recursive: true, force: true }));
  const outputs = [];

  for (const checkout of ['one', 'two']) {
    const resourcesRoot = join(temp, checkout, 'resources');
    await mkdir(join(resourcesRoot, 'config'), { recursive: true });
    await writeFile(join(resourcesRoot, 'config', 'models.json'), '{}');
    const outputPath = join(temp, checkout, 'main.wxs');
    await generatePerUserWixTemplate({
      templatePath,
      resourcesRoot: relative(process.cwd(), resourcesRoot),
      outputPath,
    });
    const generated = await readFile(outputPath, 'utf8');
    const source = generated.match(/<File Id="File_[a-f0-9]{32}" Source="([^"]+)"/);
    assert.ok(source);
    assert.ok(isAbsolute(source[1]));
    outputs.push(generated);
  }

  const identities = (xml) =>
    [...xml.matchAll(/<Component Id="((?:Cleanup|Resource)_[a-f0-9]{32})" Guid="([A-Fa-f0-9-]{36})"/g)].map((match) =>
      match.slice(1),
    );
  assert.deepEqual(identities(outputs[0]), identities(outputs[1]));
});
