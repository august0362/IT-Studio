import { describe, expect, it } from 'vitest';
import type { RpcMethod } from '@itstudio/schemas';
import { rpcParamsSchemas, rpcResultSchemas } from './ipc.js';
import { settingsPatchSchema } from './settings.js';

describe('RPC input boundaries', () => {
  it('QA-BREAK-01-D01 excludes removed workspace methods from both contract and validation', () => {
    // @ts-expect-error Removed methods must also be absent from the TypeScript contract.
    const read: RpcMethod = 'workspace.readFile';
    // @ts-expect-error Removed methods must also be absent from the TypeScript contract.
    const run: RpcMethod = 'workspace.runCommand';
    for (const method of [read, run]) {
      expect(Object.hasOwn(rpcParamsSchemas, method)).toBe(false);
      expect(Object.hasOwn(rpcResultSchemas, method)).toBe(false);
    }
  });

  it.each(Object.entries(rpcParamsSchemas))(
    'QA-BREAK-01-D04 rejects an extra top-level key for %s',
    (_method, schema) => {
      // Even when required fields are absent, strict objects must report the extra key.
      const result = schema.safeParse({
        action: 'abort',
        requestId: '00000000-0000-4000-8000-000000000001',
        extra: true,
      });
      expect(result.success).toBe(false);
      if (result.success) throw new Error('Unknown key was accepted');
      expect(JSON.stringify(result.error.issues)).toContain('extra');
    },
  );

  it.each(['__proto__', 'constructor', 'prototype', 'unknown'])(
    'QA-BREAK-01-D04 rejects %s at every settings patch depth',
    (key) => {
      for (const patch of [
        `{ "${key}": { "polluted": true } }`,
        `{ "ui": { "${key}": { "polluted": true } } }`,
        `{ "pipeline": { "roleAssignment": { "pm": [], "coder": [], "reviewer": [], "${key}": {} } } }`,
        `{ "pipeline": { "validationCommands": [{ "kind": "build", "executable": "node", "args": [], "timeoutMs": 1, "${key}": {} }] } }`,
      ]) {
        const input: unknown = JSON.parse(patch);
        expect(settingsPatchSchema.safeParse(input).success).toBe(false);
        expect(rpcParamsSchemas['settings.update'].safeParse({ patch: input }).success).toBe(false);
      }
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    },
  );
});
