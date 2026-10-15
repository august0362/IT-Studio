import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureStarts } from './smoke-sidecar.mjs';
import { generateIcons } from './make-icon.mjs';

test('M9-OBS-04 excludes one cold start and gates the median of exactly three measured starts', async () => {
  const timings = [2104, 452, 1600, 427];
  const messages = [];
  let calls = 0;
  assert.equal(
    await measureStarts(
      async () => timings[calls++],
      (message) => messages.push(message),
    ),
    452,
  );
  assert.equal(calls, 4);
  assert.ok(messages[0].includes('2104'));
  assert.ok(messages[0].includes('warm-up'));
  for (const timing of timings) assert.ok(messages.some((message) => message.includes(String(timing))));
  for (const median of [1500, 1501]) {
    await assert.rejects(
      measureStarts(
        async () => median,
        () => {},
      ),
      /target < 1500 ms/,
    );
  }
  await assert.rejects(
    measureStarts(
      async () => {
        throw new Error('ping failed');
      },
      () => {},
    ),
    /ping failed/,
  );
});

test('V1-POLISH-01 icon generation copies changed bytes only and keeps ICNS until the SVG changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'itstudio-icons-test-'));
  const icons = join(directory, 'icons');
  let invocation = 0;
  const generator = async (_input, output) => {
    invocation += 1;
    await mkdir(join(output, 'ios'), { recursive: true });
    await writeFile(join(output, 'icon.png'), 'unchanged png');
    await writeFile(join(output, 'icon.ico'), invocation < 3 ? 'unchanged ico' : 'changed ico');
    await writeFile(join(output, 'ios/icon.png'), 'unchanged mobile png');
    await writeFile(join(output, 'icon.icns'), `nondeterministic icns ${invocation}`);
  };
  try {
    await generateIcons({ icons, svg: Buffer.from('<svg/>'), generator });
    const pngTime = (await stat(join(icons, 'icon.png'))).mtimeMs;
    const icoTime = (await stat(join(icons, 'icon.ico'))).mtimeMs;
    // A sentinel time proves unchanged files are never rewritten even on coarse filesystems.
    const { utimes } = await import('node:fs/promises');
    await utimes(join(icons, 'icon.png'), 1, 1);
    await utimes(join(icons, 'icon.ico'), 1, 1);
    await generateIcons({ icons, svg: Buffer.from('<svg/>'), generator });
    assert.equal((await stat(join(icons, 'icon.png'))).mtimeMs, 1000);
    assert.equal((await stat(join(icons, 'icon.ico'))).mtimeMs, 1000);
    assert.ok(pngTime > 1000 && icoTime > 1000);
    assert.equal(await readFile(join(icons, 'icon.icns'), 'utf8'), 'nondeterministic icns 1');
    await generateIcons({ icons, svg: Buffer.from('<svg>changed</svg>'), generator });
    assert.equal(await readFile(join(icons, 'icon.ico'), 'utf8'), 'changed ico');
    assert.equal(await readFile(join(icons, 'icon.icns'), 'utf8'), 'nondeterministic icns 3');
    assert.equal((await stat(join(icons, 'icon.png'))).mtimeMs, 1000);
    await assert.rejects(
      generateIcons({
        icons,
        svg: Buffer.from('changed again'),
        generator: async () => {
          throw new Error('generation failed');
        },
      }),
      /generation failed/,
    );
    assert.equal(await readFile(join(icons, 'icon.icns'), 'utf8'), 'nondeterministic icns 3');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
