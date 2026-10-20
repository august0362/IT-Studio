import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { projectSchema } from '../../src/kernel/validation/projects.js';
import { conversationSchema } from '../../src/kernel/validation/chat.js';
import { appSettingsSchema } from '../../src/kernel/validation/settings.js';
import { startSidecar, type SidecarHarness, waitFor, waitForLine } from './break-helpers-01.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('adversarial JSON-RPC protocol', () => {
  it('BRK-P01 rejects or handles a 5 MB line and stays alive', async () => {
    sidecar = await startSidecar();
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 801,
      method: 'system.ping',
      params: { padding: 'x'.repeat(5 * 1024 * 1024) },
    });
    sidecar.writeLine(line);
    await waitForLine(sidecar, (value) => value.includes('"id":801') || value.includes('"code":-32700'), 15_000);
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('BRK-P02 returns parse errors for invalid UTF-8 and a lone CR followed by LF', async () => {
    sidecar = await startSidecar();
    sidecar.writeBytes(Buffer.from([0xff, 0x0a]));
    sidecar.writeBytes(Buffer.from('{"jsonrpc":"2.0","id":803,"method":"system.\rping","params":{}}\n'));
    await waitFor(() => sidecar?.stdoutLines.filter((line) => line.includes('"code":-32700')).length === 2, 5_000);
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('BRK-P03 handles JSON nested 10,000 levels without crashing', async () => {
    sidecar = await startSidecar();
    const nested = `${'['.repeat(10_000)}0${']'.repeat(10_000)}`;
    sidecar.writeLine(`{"jsonrpc":"2.0","id":804,"method":"system.ping","params":${nested}}`);
    await waitForLine(sidecar, (line) => line.includes('"id":804'), 15_000);
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('BRK-P04 answers every one of 2,000 mixed concurrent requests exactly once', async () => {
    sidecar = await startSidecar();
    const expected = new Set(Array.from({ length: 2_000 }, (_, index) => 10_000 + index));
    for (const id of expected) {
      const kind = id % 3;
      const method = kind === 0 ? 'system.ping' : kind === 1 ? 'not.a.method' : 'settings.update';
      const params = kind === 2 ? { patch: { ui: { themeId: 'bad theme' } } } : {};
      sidecar.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    }
    await waitFor(() => {
      if (sidecar === undefined) return false;
      const received = sidecar.stdoutLines.flatMap((line) => {
        const parsed = z
          .object({
            jsonrpc: z.literal('2.0'),
            id: z.number(),
            result: z.unknown().optional(),
            error: z.unknown().optional(),
          })
          .refine((envelope) => (envelope.result === undefined) !== (envelope.error === undefined))
          .safeParse(JSON.parse(line) as unknown);
        return parsed.success && expected.has(parsed.data.id) ? [parsed.data.id] : [];
      });
      return received.length === expected.size;
    }, 45_000);
    const received = sidecar.stdoutLines.flatMap((line) => {
      const parsed = z
        .object({
          jsonrpc: z.literal('2.0'),
          id: z.number(),
          result: z.unknown().optional(),
          error: z.unknown().optional(),
        })
        .refine((envelope) => (envelope.result === undefined) !== (envelope.error === undefined))
        .safeParse(JSON.parse(line) as unknown);
      return parsed.success && expected.has(parsed.data.id) ? [parsed.data.id] : [];
    });
    expect(new Set(received)).toEqual(expected);
    expect(received).toHaveLength(expected.size);
  }, 55_000);

  it('BRK-P05 reports both same-id requests or rejects the duplicate while staying alive', async () => {
    sidecar = await startSidecar();
    sidecar.writeLine('{"jsonrpc":"2.0","id":805,"method":"system.ping","params":{}}');
    sidecar.writeLine('{"jsonrpc":"2.0","id":805,"method":"settings.get","params":{}}');
    await waitFor(() => sidecar?.stdoutLines.filter((line) => line.includes('"id":805')).length === 2, 5_000).catch(
      () => undefined,
    );
    const responses = sidecar.stdoutLines
      .filter((line) => {
        try {
          return (JSON.parse(line) as { id?: unknown }).id === 805;
        } catch {
          return false;
        }
      })
      .map((line) =>
        z
          .object({
            jsonrpc: z.literal('2.0'),
            id: z.literal(805),
            result: z.unknown().optional(),
            error: z.unknown().optional(),
          })
          .refine((envelope) => (envelope.result === undefined) !== (envelope.error === undefined))
          .parse(JSON.parse(line) as unknown),
      );
    expect(responses).toHaveLength(2); // RpcServer handles each duplicate id independently.
    expect(responses.map((response) => response.id)).toEqual([805, 805]);
    expect(responses.some((response) => z.object({ version: z.string() }).safeParse(response.result).success)).toBe(
      true,
    );
    expect(responses.some((response) => appSettingsSchema.safeParse(response.result).success)).toBe(true);
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('QA-BREAK-01-D04 BRK-P06 rejects prototype and extra-key pollution attempts', async () => {
    sidecar = await startSidecar();
    const settings = await new Promise<string>((resolveResponse) => {
      const listener = (line: string): void => {
        if (line.includes('"id":806')) {
          sidecar?.notifications.off('line', listener);
          resolveResponse(line);
        }
      };
      sidecar?.notifications.on('line', listener);
      sidecar?.writeLine(
        '{"jsonrpc":"2.0","id":806,"method":"settings.update","params":{"patch":{"router":{"autoFallback":true,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"extra":true}}}}',
      );
    }).then((line) => JSON.parse(line) as unknown);
    expect(settings).toMatchObject({ error: { code: -32602 } });
    const project = await new Promise<string>((resolveResponse) => {
      const listener = (line: string): void => {
        if (line.includes('"id":807')) {
          sidecar?.notifications.off('line', listener);
          resolveResponse(line);
        }
      };
      sidecar?.notifications.on('line', listener);
      sidecar?.writeLine(
        `{"jsonrpc":"2.0","id":807,"method":"project.create","params":{"name":"pollution","workspaceRoot":${JSON.stringify(sidecar.dataDir)},"__proto__":{"polluted":true},"extra":true}}`,
      );
    }).then((line) => JSON.parse(line) as unknown);
    expect(project).toMatchObject({ error: { code: -32602 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await sidecar.call('settings.get')).error).toBeUndefined();
  }, 30_000);

  it.each([{}, [], true, 1.5])(
    'BRK-P07 rejects a non-integer id envelope (%j)',
    async (id) => {
      sidecar = await startSidecar();
      const error = new Promise<unknown>((resolveError) => {
        const listener = (line: string): void => {
          const parsed = z
            .object({ error: z.object({ code: z.number() }), id: z.null() })
            .safeParse(JSON.parse(line) as unknown);
          if (parsed.success) {
            sidecar?.notifications.off('line', listener);
            resolveError(parsed.data);
          }
        };
        sidecar?.notifications.on('line', listener);
      });
      sidecar.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method: 'system.ping', params: {} }));
      await expect(error).resolves.toMatchObject({ error: { code: -32600 }, id: null });
      await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
    },
    30_000,
  );

  it('BRK-P08 exits cleanly when stdin closes during chat.send', async () => {
    sidecar = await startSidecar({}, { 'google/gemini-3.8-flash': ['delay:30000'] });
    const project = await sidecar.call('project.create', { name: 'EOF chat', workspaceRoot: sidecar.dataDir });
    const projectId = projectSchema.parse(project.result).id;
    await sidecar.call('secrets.set', { provider: 'google', apiKey: 'fake-google-key' });
    const conversation = await sidecar.call('chat.createConversation', { projectId });
    const conversationId = conversationSchema.parse(conversation.result).id;
    await sidecar.call('chat.send', { conversationId, text: 'stay in flight' });
    await waitFor(() => sidecar?.stdoutLines.some((line) => line.includes('"state":"dispatching"')) ?? false);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        rejectExit(new Error('Sidecar did not exit within shutdown budget'));
      }, 5_000);
      sidecar?.notifications.once('exit', (status: { code: number | null; signal: NodeJS.Signals | null }) => {
        clearTimeout(timeout);
        resolveExit(status);
      });
    });
    sidecar.endStdin();
    await expect(exited).resolves.toEqual({ code: 0, signal: null });
  }, 30_000);
});
