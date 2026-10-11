import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const treeMarker = '<!-- ITSTUDIO_RESOURCE_TREE -->';
const refsMarker = '<!-- ITSTUDIO_RESOURCE_COMPONENT_REFS -->';
const registryKey = String.raw`Software\\{{manufacturer}}\\{{product_name}}\Components`;

export async function generatePerUserWixTemplate({ templatePath, resourcesRoot, outputPath }) {
  const template = await readFile(templatePath, 'utf8');
  if (template.split(treeMarker).length !== 2 || template.split(refsMarker).length !== 2) {
    throw new Error('WiX template must contain each IT Studio resource marker exactly once');
  }

  const componentIds = [];
  const resourceTree = await renderDirectory(resolve(resourcesRoot), 'resources', componentIds);
  const references = componentIds.map((id) => `<ComponentRef Id="${id}" />`).join('\n');
  const output = template.replace(treeMarker, resourceTree).replace(refsMarker, references);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  return { componentCount: componentIds.length, outputPath };
}

async function renderDirectory(absolutePath, relativePath, componentIds) {
  const entries = (await readdir(absolutePath, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  const id = wixId('Dir', relativePath);
  const cleanupId = wixId('Cleanup', relativePath);
  componentIds.push(cleanupId);
  const contents = [
    `<Component Id="${cleanupId}" Guid="${componentGuid('cleanup', relativePath)}" Win64="$(var.Win64)">`,
    `  <RegistryValue Root="HKCU" Key="${registryKey}" Name="${cleanupId}" Type="string" Value="[INSTALLDIR]" KeyPath="yes" />`,
    `  <RemoveFolder Id="${wixId('Remove', relativePath)}" On="uninstall" />`,
    '</Component>',
  ];

  for (const entry of entries) {
    const childPath = join(absolutePath, entry.name);
    const childRelativePath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      contents.push(await renderDirectory(childPath, childRelativePath, componentIds));
    } else if (entry.isFile()) {
      const componentId = wixId('Resource', childRelativePath);
      componentIds.push(componentId);
      contents.push(
        `<Component Id="${componentId}" Guid="${componentGuid('file', childRelativePath)}" Win64="$(var.Win64)">`,
        `  <File Id="${wixId('File', childRelativePath)}" Source="${xmlAttribute(childPath)}" Name="${xmlAttribute(entry.name)}" />`,
        `  <RegistryValue Root="HKCU" Key="${registryKey}" Name="${componentId}" Type="string" Value="[INSTALLDIR]" KeyPath="yes" />`,
        '</Component>',
      );
    } else {
      throw new Error(`Unsupported staged resource: ${childPath}`);
    }
  }

  return `<Directory Id="${id}" Name="${xmlAttribute(relativePath.split('/').at(-1))}">\n${contents.join('\n')}\n</Directory>`;
}

function wixId(prefix, relativePath) {
  return `${prefix}_${createHash('sha256').update(relativePath).digest('hex').slice(0, 32)}`;
}

function componentGuid(kind, relativePath) {
  const hash = createHash('sha1').update(`IT Studio WiX ${kind}:${relativePath}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function xmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
