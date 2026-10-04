import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { WebChatLinkId } from '@itstudio/schemas';
import { projectSchema } from '../../src/validation/projects.js';
import { startSidecar, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('quick web chat integration', () => {
  it('TC-WC-001 returns default links and records a fake browser launch', async () => {
    sidecar = await startSidecar();
    const settings = await sidecar.call('settings.get');
    expect(settings.result).toMatchObject({
      webChat: {
        links: [
          { id: 'chatgpt', url: 'https://chatgpt.com/', enabled: true },
          { id: 'gemini', url: 'https://gemini.google.com/app', enabled: true },
          { id: 'grok', url: 'https://grok.com/', enabled: true },
          { id: 'claude', url: 'https://claude.ai/new', enabled: true },
          { id: 'google-ai-studio', url: 'https://aistudio.google.com/', enabled: true },
          { id: 'perplexity', url: 'https://www.perplexity.ai/', enabled: true },
        ],
      },
    });
    const linkId = z.custom<WebChatLinkId>((value) => value === 'chatgpt').parse('chatgpt');
    const result = await sidecar.call('webchat.open', { linkId });
    expect(result.result).toMatchObject({ opened: true });
    expect(sidecar.stderr.join('')).toContain('"args":["https://chatgpt.com/"]');
    expect(sidecar.stderr.join('')).toContain('"svc":"webchat-e2e"');
    const browsers = await sidecar.call('webchat.browsers');
    expect(browsers.result).toEqual(
      expect.arrayContaining([
        { browser: 'default', installed: true, path: null },
        expect.objectContaining({ browser: 'custom', installed: false, path: null }),
      ]),
    );
    const invalidSettings = await sidecar.call('settings.update', {
      patch: {
        webChat: {
          links: [{ id: linkId, name: 'ChatGPT', url: 'http://chatgpt.com/', enabled: true }],
        },
      },
    });
    expect(invalidSettings.error?.data).toMatchObject({
      code: 'VALIDATION',
      details: { issues: [expect.objectContaining({ path: 'webChat.links.0.url' })] },
    });
  }, 30_000);

  it('TC-WC-002 returns project name and a depth-two tree without file contents', async () => {
    sidecar = await startSidecar();
    const workspace = resolve(sidecar.dataDir, 'brief-project');
    await mkdir(resolve(workspace, 'src'), { recursive: true });
    await mkdir(resolve(workspace, 'src', 'nested'), { recursive: true });
    await mkdir(resolve(workspace, 'src', 'nested', 'deeper'), { recursive: true });
    await writeFile(resolve(workspace, 'src', 'main.ts'), 'PRIVATE_FILE_CONTENT');
    await writeFile(resolve(workspace, 'src', 'nested', 'deep.ts'), 'SHALLOW_FILE');
    await writeFile(resolve(workspace, 'src', 'nested', 'deeper', 'secret.ts'), 'TOO_DEEP');
    const created = await sidecar.call('project.create', { name: 'Brief project', workspaceRoot: workspace });
    const parsedProject = projectSchema.safeParse(created.result);
    expect(parsedProject.success).toBe(true);
    if (!parsedProject.success) return;
    const brief = await sidecar.call('webchat.projectBrief', { projectId: parsedProject.data.id });
    const briefValue = z.object({ text: z.string() }).safeParse(brief.result);
    expect(briefValue.success).toBe(true);
    if (!briefValue.success) return;
    expect(briefValue.data.text).toContain('Brief project');
    expect(briefValue.data.text).toContain('src/main.ts');
    expect(briefValue.data.text).toContain('src/nested/deep.ts');
    expect(briefValue.data.text).not.toContain('src/nested/deeper/secret.ts');
    expect(briefValue.data.text).not.toContain('PRIVATE_FILE_CONTENT');
    expect(briefValue.data.text).toContain('My question: ');
  }, 30_000);
});
