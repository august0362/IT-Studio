import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('./', import.meta.url));
const eslintScript = fileURLToPath(new URL('../../node_modules/eslint/bin/eslint.js', import.meta.url));
const secretScanner = fileURLToPath(new URL('../scan-secrets.mjs', import.meta.url));
const eslintFixtures = [
  { name: 'bad-enum.ts', rule: 'no-restricted-syntax' },
  { name: 'bad-any.ts', rule: '@typescript-eslint/no-explicit-any' },
  { name: 'bad-default-export.ts', rule: 'no-restricted-syntax' },
  { name: 'bad-html.tsx', rule: 'no-restricted-syntax' },
];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
  });
}

let failed = false;
for (const fixture of eslintFixtures) {
  const result = run(process.execPath, [eslintScript, '--no-ignore', `${fixtureDirectory}${fixture.name}`]);
  const diagnostics = `${result.stdout}\n${result.stderr}`;
  if (result.error !== undefined || result.status !== 1 || !diagnostics.includes(fixture.rule)) {
    process.stderr.write(`Expected ESLint to reject ${fixture.name} with ${fixture.rule}.\n`);
    if (result.stderr.length > 0) {
      process.stderr.write(result.stderr);
    }
    failed = true;
    continue;
  }

  process.stdout.write(`Rejected ${fixture.name}.\n`);
}

const secretFixture = `${fixtureDirectory}bad-secret.txt`;
const secretResult = run(process.execPath, [secretScanner, secretFixture]);
if (
  secretResult.error !== undefined ||
  secretResult.status !== 1 ||
  !secretResult.stdout.includes('bad-secret.txt:1: openai-api-key') ||
  secretResult.stdout.includes('FAKEKEY')
) {
  process.stderr.write('Expected the secret scanner to reject bad-secret.txt without printing its value.\n');
  if (secretResult.stderr.length > 0) {
    process.stderr.write(secretResult.stderr);
  }
  if (secretResult.stdout.length > 0) {
    process.stderr.write(secretResult.stdout);
  }
  failed = true;
} else {
  process.stdout.write('Rejected bad-secret.txt without printing its value.\n');
}

if (failed) {
  process.exitCode = 1;
}
