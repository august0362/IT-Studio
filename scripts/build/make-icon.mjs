import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, '.npm-cache/itstudio-app-icon.png');
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">' +
    '<rect width="1024" height="1024" rx="190" fill="#0177c8"/>' +
    '<text x="512" y="570" text-anchor="middle" dominant-baseline="middle" ' +
    'font-family="Arial, sans-serif" font-size="390" font-weight="700" letter-spacing="-24" fill="#ffffff">IT</text>' +
    '</svg>',
);

await mkdir(dirname(output), { recursive: true });
await sharp(svg).png().toFile(output);

const result = spawnSync(
  process.execPath,
  [npmCli, '--cache', '.npm-cache', 'run', 'tauri', '--workspace', '@itstudio/desktop', '--', 'icon', output],
  { cwd: root, stdio: 'inherit', shell: false },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Tauri icon generation exited with status ${String(result.status)}`);
