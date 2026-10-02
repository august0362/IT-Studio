const secretPatterns: readonly RegExp[] = [
  new RegExp('sk' + '-ant-' + '[A-Za-z0-9_-]{20,}'),
  new RegExp('sk' + '-' + '[A-Za-z0-9_-]{20,}'),
  new RegExp('AIza' + '[0-9A-Za-z_-]{35}'),
  new RegExp('xai' + '-' + '[A-Za-z0-9]{20,}'),
  new RegExp('gsk' + '_' + '[A-Za-z0-9]{20,}'),
  new RegExp('r8' + '_' + '[A-Za-z0-9]{20,}'),
  new RegExp('-----BEGIN ' + '(?:RSA |EC )?' + 'PRIVATE KEY-----'),
];

const userHomePaths = [
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi,
  /(?:^|[\s"'(])(?:\\\\[^\\/\s]+[\\/][^\\/\s]+[\\/]Users[\\/][^\\/\s]+|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)/g,
];

export function redactSecrets(text: string): string {
  return secretPatterns.reduce((redacted, pattern) => redacted.replace(pattern, '[REDACTED]'), text);
}

export function shortenUserPaths(text: string): string {
  return userHomePaths.reduce(
    (shortened, pattern) =>
      shortened.replace(pattern, (match) => {
        const prefix = match.length > 0 && /[\s"'(]/.test(match.slice(0, 1)) ? match.slice(0, 1) : '';
        return `${prefix}~`;
      }),
    text,
  );
}

export function redactLogLine(text: string): string {
  return shortenUserPaths(redactSecrets(text));
}
