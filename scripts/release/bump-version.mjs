import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANIFESTS = [
  ['package.json', 'json', (value) => value.version, (value, version) => ({ ...value, version })],
  ['apps/desktop/package.json', 'json', (value) => value.version, (value, version) => ({ ...value, version })],
  ['apps/sidecar/package.json', 'json', (value) => value.version, (value, version) => ({ ...value, version })],
  ['apps/vscode-ext/package.json', 'json', (value) => value.version, (value, version) => ({ ...value, version })],
  [
    'apps/desktop/src-tauri/tauri.conf.json',
    'json',
    (value) => value.version,
    (value, version) => ({ ...value, version }),
  ],
  ['apps/desktop/src-tauri/Cargo.toml', 'toml', undefined, undefined],
];

export function parseVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`Invalid stable semantic version: ${String(version)}`);
  }
  const [major, minor, patch] = version.split('.').map(Number);
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Invalid stable semantic version: ${version}`);
  }
  return { major, minor, patch };
}

export function bumpVersion(currentVersion, requested) {
  const current = parseVersion(currentVersion);
  if (VERSION_RE.test(requested)) return requested;
  if (!['major', 'minor', 'patch'].includes(requested)) {
    throw new Error(`Expected major, minor, patch, or x.y.z; got ${requested}`);
  }
  if (requested === 'major') return `${current.major + 1}.0.0`;
  if (requested === 'minor') return `${current.major}.${current.minor + 1}.0`;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

export function parseJsonManifest(text, path = 'package.json') {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: malformed JSON`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.version !== 'string') {
    throw new Error(`${path}: expected an object with a string version`);
  }
  parseVersion(value.version);
  return value;
}

export function parseCargoVersion(text, path = 'Cargo.toml') {
  const sectionHeading = /^\[package\]\s*$/m.exec(text);
  const sectionStart = sectionHeading ? sectionHeading.index + sectionHeading[0].length : -1;
  const remaining = sectionStart < 0 ? '' : text.slice(sectionStart);
  const nextSection = remaining.search(/^\[/m);
  const packageBody = nextSection < 0 ? remaining : remaining.slice(0, nextSection);
  const versionLine = packageBody.match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!versionLine?.[1]) throw new Error(`${path}: missing [package] version`);
  parseVersion(versionLine[1]);
  return versionLine[1];
}

export function replaceCargoVersion(text, version, path = 'Cargo.toml') {
  parseCargoVersion(text, path);
  const sectionHeading = /^\[package\]\s*$/m.exec(text);
  if (!sectionHeading) throw new Error(`${path}: missing [package] version`);
  const sectionStart = sectionHeading.index + sectionHeading[0].length;
  const remaining = text.slice(sectionStart);
  const nextSection = remaining.search(/^\[/m);
  const packageBody = nextSection < 0 ? remaining : remaining.slice(0, nextSection);
  const versionMatch = /^version\s*=\s*"[^"]+"\s*$/m.exec(packageBody);
  if (!versionMatch) throw new Error(`${path}: missing [package] version`);
  const matchStart = sectionStart + versionMatch.index;
  return `${text.slice(0, matchStart)}version = "${version}"${text.slice(matchStart + versionMatch[0].length)}`;
}

export function changelogForRelease(text, version, date) {
  const heading = /^## \[Unreleased\]\s*$/m;
  const match = heading.exec(text);
  if (!match) throw new Error('CHANGELOG.md: missing ## [Unreleased] section');
  const bodyStart = match.index + match[0].length;
  const nextHeadingOffset = text.slice(bodyStart).search(/^## /m);
  const bodyEnd = nextHeadingOffset < 0 ? text.length : bodyStart + nextHeadingOffset;
  const body = text.slice(bodyStart, bodyEnd).trim();
  if (!/^### (Added|Changed|Fixed|Security|Deprecated|Removed|Docs)\s*$/m.test(body) || !/^[-*] \S/m.test(body)) {
    throw new Error('CHANGELOG.md: Unreleased section is empty');
  }
  const released = body.replace(/^### (Added|Changed|Fixed|Security|Deprecated|Removed|Docs)\s*$/gm, '### $1');
  const fresh = '### Added\n\n### Changed\n\n### Fixed\n\n### Security\n\n### Deprecated\n\n### Removed\n\n### Docs';
  return `${text.slice(0, match.index)}## [Unreleased]\n\n${fresh}\n\n## [${version}] — ${date}\n\n${released}\n${text.slice(bodyEnd)}`;
}

function diff(path, before, after) {
  if (before === after) return '';
  const removed = before
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `-${line}`)
    .join('\n');
  const added = after
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n');
  return `--- a/${path}\n+++ b/${path}\n${removed}\n${added}\n`;
}

export async function run(args, root = ROOT, now = new Date()) {
  const options = args.filter((arg) => arg.startsWith('--'));
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const force = options.includes('--force');
  const dryRun = options.includes('--dry-run');
  if (options.some((option) => !['--force', '--dry-run'].includes(option)) || positional.length !== 1) {
    throw new Error('Usage: npm run release:bump -- <major|minor|patch|x.y.z> [--force] [--dry-run]');
  }

  const files = await Promise.all(
    MANIFESTS.map(async ([path, format]) => {
      const absolutePath = resolve(root, path);
      const source = await readFile(absolutePath, 'utf8');
      const version = format === 'json' ? parseJsonManifest(source, path).version : parseCargoVersion(source, path);
      return { path, absolutePath, source, version, format };
    }),
  );
  const distinct = [...new Set(files.map((file) => file.version))];
  if (distinct.length > 1 && !force) {
    throw new Error(
      `Version mismatch (use --force to synchronize):\n${files.map(({ path, version }) => `  ${path.padEnd(48)} ${version}`).join('\n')}`,
    );
  }
  const targetVersion = bumpVersion(files[0].version, positional[0]);
  const changelogPath = resolve(root, 'CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf8');
  const releasedChangelog = changelogForRelease(changelog, targetVersion, now.toISOString().slice(0, 10));
  const updates = files.map((file) => {
    const content =
      file.format === 'json'
        ? `${JSON.stringify({ ...JSON.parse(file.source), version: targetVersion }, null, 2)}\n`
        : replaceCargoVersion(file.source, targetVersion, file.path);
    return { ...file, content };
  });
  updates.push({ path: 'CHANGELOG.md', absolutePath: changelogPath, source: changelog, content: releasedChangelog });
  const output = updates.map(({ path, source, content }) => diff(path, source, content)).join('');
  if (dryRun) process.stdout.write(output);
  else {
    for (const update of updates) await writeFile(update.absolutePath, update.content, 'utf8');
    process.stdout.write(`Updated version to ${targetVersion}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
