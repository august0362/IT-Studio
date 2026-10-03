import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tauri image asset protocol scope', () => {
  it('only permits the app images directory and its descendants', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
    ) as {
      app: { security: { assetProtocol: { enable: boolean; scope: readonly string[] }; csp: string } };
    };
    const capability = JSON.parse(
      readFileSync(resolve(process.cwd(), 'apps/desktop/src-tauri/capabilities/default.json'), 'utf8'),
    ) as {
      permissions: readonly (
        string | { readonly identifier: string; readonly allow: readonly { readonly path: string }[] }
      )[];
    };
    const scope = config.app.security.assetProtocol.scope;
    expect(config.app.security.assetProtocol.enable).toBe(true);
    expect(scope.length).toBeGreaterThan(0);
    expect(
      scope.every(
        (path) => path === '$APPDATA/com.itstudio.app/images' || path === '$APPDATA/com.itstudio.app/images/**',
      ),
    ).toBe(true);
    const openerScope = capability.permissions.filter(
      (
        permission,
      ): permission is { readonly identifier: string; readonly allow: readonly { readonly path: string }[] } =>
        typeof permission !== 'string' && permission.identifier === 'opener:allow-open-path',
    );
    expect(openerScope).toHaveLength(1);
    expect(openerScope[0]?.allow).toEqual([{ path: '$APPDATA/com.itstudio.app/images/**' }]);
    expect(config.app.security.csp).toContain('img-src');
    expect(config.app.security.csp).toContain('asset:');
  });
});
