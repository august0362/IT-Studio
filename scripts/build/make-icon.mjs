import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
// Hash of the SVG used for the committed icons. Update after committing a changed source and its icons.
const COMMITTED_SOURCE_HASH = '55e2c51d44ea4e0d55ec9efe6f6e703c561950c6d285ef03d83ba582ea714952';
const sourceSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">' +
    '<rect width="1024" height="1024" rx="190" fill="#0177c8"/>' +
    '<text x="512" y="570" text-anchor="middle" dominant-baseline="middle" ' +
    'font-family="Arial, sans-serif" font-size="390" font-weight="700" letter-spacing="-24" fill="#ffffff">IT</text>' +
    '</svg>',
);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await generateIcons();
}

export async function generateIcons({
  icons = join(root, 'apps/desktop/src-tauri/icons'),
  svg = sourceSvg,
  generator = runGenerator,
} = {}) {
  const cache = join(root, '.npm-cache');
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'itstudio-icons-'));
  const generated = join(temporary, 'icons');
  // Store build metadata beside the icons in an already ignored cache directory.
  const hashPath = join(icons, '.npm-cache/source.svg.sha256');
  const sourceHash = createHash('sha256').update(svg).digest('hex');
  const previousHash = (await readOptional(hashPath))?.toString('utf8').trim() ?? COMMITTED_SOURCE_HASH;
  try {
    await mkdir(generated, { recursive: true });
    await generator(svg, generated);
    await copyChanged(generated, icons, sourceHash !== previousHash);
    await mkdir(dirname(hashPath), { recursive: true });
    if (sourceHash !== (await readOptional(hashPath))?.toString('utf8').trim())
      await writeFile(hashPath, `${sourceHash}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function copyChanged(source, destination, sourceChanged) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyChanged(input, output, sourceChanged);
      continue;
    }
    if (!entry.isFile()) continue;
    const previous = await readOptional(output);
    if (entry.name === 'icon.icns' && !sourceChanged && previous !== undefined) continue;
    if (previous?.equals(await readFile(input))) continue;
    await mkdir(dirname(output), { recursive: true });
    await copyFile(input, output);
  }
}

async function runGenerator(svg, generated) {
  const input = join(dirname(generated), 'source.png');
  await sharp(svg).png().toFile(input);
  const result = spawnSync(
    process.execPath,
    [
      npmCli,
      '--cache',
      '.npm-cache',
      'run',
      'tauri',
      '--workspace',
      '@itstudio/desktop',
      '--',
      'icon',
      input,
      '--output',
      generated,
    ],
    { cwd: root, stdio: 'inherit', shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tauri icon generation exited with status ${String(result.status)}`);
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
