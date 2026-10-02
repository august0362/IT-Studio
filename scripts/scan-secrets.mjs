import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const secretPatterns = [
  { name: 'anthropic-api-key', expression: new RegExp('sk' + '-ant-' + '[A-Za-z0-9_-]{20,}') },
  { name: 'openai-api-key', expression: new RegExp('sk' + '-' + '[A-Za-z0-9_-]{20,}') },
  { name: 'google-api-key', expression: new RegExp('AIza' + '[0-9A-Za-z_-]{35}') },
  { name: 'xai-api-key', expression: new RegExp('xai' + '-' + '[A-Za-z0-9]{20,}') },
  { name: 'groq-api-key', expression: new RegExp('gsk' + '_' + '[A-Za-z0-9]{20,}') },
  { name: 'replicate-api-key', expression: new RegExp('r8' + '_' + '[A-Za-z0-9]{20,}') },
  {
    name: 'private-key',
    expression: new RegExp('-----BEGIN ' + '(?:RSA |EC )?' + 'PRIVATE KEY-----'),
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isFixturePath(filePath) {
  return filePath.replaceAll('\\', '/').startsWith('scripts/lint-fixtures/');
}

function decodeText(buffer) {
  if (buffer.includes(0)) {
    return undefined;
  }

  const sample = buffer.subarray(0, 8192);
  let controlByteCount = 0;
  for (const byte of sample) {
    if (byte < 0x08 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      controlByteCount += 1;
    }
  }

  if (sample.length > 0 && controlByteCount / sample.length > 0.1) {
    return undefined;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

function listFiles() {
  // -z: NUL-separated, unquoted paths (handles non-ASCII names such as Vietnamese file names).
  const output = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return output.split('\0').filter((filePath) => filePath.length > 0);
}

function scanFile(filePath, explicitlyRequested) {
  const relativePath = normalizePath(path.relative(repositoryRoot, filePath));

  if (!explicitlyRequested && isFixturePath(relativePath)) {
    return [];
  }

  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'read-error';
    process.stderr.write(`Unable to scan ${relativePath}: ${String(code)}\n`);
    return ['error'];
  }

  const contents = decodeText(buffer);
  if (contents === undefined) {
    return [];
  }

  const findings = [];
  const lines = contents.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    for (const pattern of secretPatterns) {
      if (pattern.expression.test(line)) {
        process.stdout.write(`${relativePath}:${lineIndex + 1}: ${pattern.name}\n`);
        findings.push('secret');
      }
    }
  }

  return findings;
}

const requestedFiles = process.argv.slice(2);
const candidatePaths =
  requestedFiles.length > 0
    ? requestedFiles.map((filePath) => path.resolve(repositoryRoot, filePath))
    : listFiles().map((filePath) => path.resolve(repositoryRoot, filePath));

let hasFindings = false;
for (const filePath of candidatePaths) {
  if (scanFile(filePath, requestedFiles.length > 0).length > 0) {
    hasFindings = true;
  }
}

if (hasFindings) {
  process.exitCode = 1;
}
