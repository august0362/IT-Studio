import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const documentNames = ['CONTEXT', 'ARCHITECTURE', 'CONVENTIONS', 'ROADMAP', 'ROLES', 'TESTING'];
const movedFiles = [...documentNames.map((name) => `${name}.md`), ['diagram', 'png'].join('.')];
const namesPattern = String.raw`(${documentNames.join('|')})\.md|diagram\.png`;
const references = new RegExp(String.raw`(?:[\w.-]+/)*(?:${namesPattern})`, 'g');

function isWorkspaceConvention(file, line) {
  // The pipeline reads conventions from the user's project workspace, independently of this repo's docs.
  const conventionsFile = `${documentNames[2]}.md`;
  return (
    (file === 'apps/sidecar/src/services/project-context.ts' &&
      line.trim() === `const conventionsPath = join(root, '${conventionsFile}');`) ||
    (file === 'apps/sidecar/src/services/project-context.test.ts' &&
      line.trim() === 'await fs.writeFile(`${root}/' + conventionsFile + "`, 'x'.repeat(2100));") ||
    (file === 'docs/tasks/archive/M6/M6-05.md' &&
      (line.startsWith('3. Role calls') || line.includes('Add `project-context.test.ts`')))
  );
}

function staleReferences(file, line) {
  return [...line.matchAll(references)]
    .map(([reference]) => reference)
    .filter((reference) => {
      if (reference === `${documentNames[2]}.md` && isWorkspaceConvention(file, line)) return false;
      const base = file.endsWith('.md') ? posix.dirname(file) : '.';
      const target =
        file === 'docs/CONTEXT.md' && /^[├│└]/u.test(line) ? reference : posix.normalize(posix.join(base, reference));
      return !movedFiles.some((name) => target === `docs/${name}`);
    });
}

test('REPO-01 project documents exist only under docs', () => {
  for (const name of movedFiles) {
    assert.ok(existsSync(resolve(root, 'docs', name)), `Missing docs/${name}`);
    assert.ok(!existsSync(resolve(root, name)), `Unexpected root document: ${name}`);
  }
});

test('REPO-01 git grep finds no stale repository document references', () => {
  const output = execFileSync('git', ['grep', '-n', '-E', namesPattern], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const stale = [];
  for (const hit of output.trim().split(/\r?\n/)) {
    const [, file, lineNumber, line] = /^([^:]+):(\d+):(.*)$/.exec(hit) ?? [];
    assert.ok(file && lineNumber && line !== undefined, `Unrecognized git grep output: ${hit}`);
    for (const reference of staleReferences(file, line)) {
      stale.push(`${file}:${lineNumber}: ${reference}`);
    }
  }
  assert.deepEqual(stale, []);
});

test('REPO-01 reference guard distinguishes root paths from docs sibling paths', () => {
  const name = movedFiles[0];
  assert.deepEqual(staleReferences('AGENTS.md', `Read ${name}`), [name]);
  assert.deepEqual(staleReferences('AGENTS.md', `Read docs/${name}`), []);
  assert.deepEqual(staleReferences('docs/tasks/example.md', `Read ${name}`), [name]);
  assert.deepEqual(staleReferences('docs/tasks/example.md', `Read ../${name}`), []);
  assert.deepEqual(staleReferences('docs/HANDOFF.md', `Read ${name}`), []);
  assert.deepEqual(staleReferences('src/example.ts', `See docs/${name}`), []);
});

test('REPO-02 relative Markdown links in docs resolve to files', () => {
  const files = execFileSync('git', ['ls-files', 'docs'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .filter((file) => file.endsWith('.md'));
  const linkPattern = /\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/gu;
  const broken = [];

  for (const file of files) {
    const content = readFileSync(resolve(root, file), 'utf8');
    for (const match of content.matchAll(linkPattern)) {
      const href = match[1] ?? match[2];
      if (!href || /^(?:https?:\/\/|#)/iu.test(href)) continue;
      if (/[<>]/u.test(href)) continue;

      const target = decodeURIComponent(href.split(/[?#]/u, 1)[0] ?? '');
      if (!target) continue;

      const destination = resolve(root, posix.dirname(file), target);
      if (!existsSync(destination)) broken.push(`${file}: ${href}`);
    }
  }

  assert.deepEqual(broken, []);
});

test('REPO-01 Windows launcher anchors its directory, starts dev and pauses on errors', () => {
  const launcher = readFileSync(resolve(root, 'Start-IT-Studio.bat'), 'utf8');
  assert.match(launcher, /^@echo off\r?\ncd \/d "%~dp0"/);
  assert.match(launcher, /call npm --cache \.npm-cache run dev/);
  for (const label of ['missing_node', 'missing_cargo', 'install_failed', 'start_failed', 'usage']) {
    assert.match(launcher, new RegExp(String.raw`:${label}\r?\n(?:(?!:).*\r?\n)*?pause\r?\nexit /b`));
  }
  assert.doesNotMatch(launcher, /C:[\\/]Users/i);
  assert.doesNotMatch(launcher, /--force|runas/i);
  assert.match(launcher, /where node/);
  assert.match(launcher, /where npm/);
  assert.match(launcher, /where cargo/);
  assert.match(launcher, /https:\/\/nodejs\.org\/en\/download/);
  assert.match(launcher, /https:\/\/rustup\.rs\//);
  assert.match(launcher, /set "ITSTUDIO_DATA_DIR=%~2"/);
  assert.match(launcher, /package-lock\.json'\)\.mtimeMs > fs\.statSync\(marker\)\.mtimeMs/);
  assert.match(launcher, /call npm --cache \.npm-cache install/);
  assert.match(launcher, /set "ITSTUDIO_EXIT_CODE=%ERRORLEVEL%"/);
});
