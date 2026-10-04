import { describe, expect, it, vi } from 'vitest';
import {
  WebChatBrowser,
  type AppSettings,
  type Project,
  type ProjectId,
  type Result,
  type WebChatLinkId,
} from '@itstudio/schemas';
import { z } from 'zod';
import { DEFAULT_WEB_CHAT_SETTINGS } from '../domain/web-chat.js';
import { createLogger } from '../infra/logger.js';
import { BrowserLocator } from '../infra/browser-locator.js';
import type { SettingsService } from './settings-service.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { ProjectContextService } from './project-context.js';
import type { IBrowserLauncher } from '../ports/browser-launcher.js';
import { WebChatService } from './web-chat-service.js';
import { projectSchema } from '../validation/projects.js';

function setup(
  browser: AppSettings['webChat']['browser'] = WebChatBrowser.DEFAULT,
  customBrowserPath: string | null = null,
) {
  const settings: AppSettings = {
    activeProjectId: null,
    router: {
      ladder: [],
      autoFallback: true,
      lockedModelKey: null,
      circuitBreaker: { failureThreshold: 3, cooldownMs: 1 },
      userDecisionTimeoutMs: 1,
    },
    budget: { hardStop: false },
    pricing: { autoUpdate: false, updateIntervalHours: 24, maxAutoChangePercent: 50, extractionModelKey: 'openai/x' },
    fx: { autoUpdate: true, manualUsdToVnd: null },
    vscode: { autoLaunch: true, codeExecutable: null, showDiffBeforeValidate: true, revealChangedFiles: true },
    pipeline: { roleAssignment: { pm: [], coder: [], reviewer: [] }, validationCommands: [], maxFixAttempts: 1 },
    rag: {
      embedding: { modelKey: 'openai/x', dimensions: 1, batchSize: 1, fallbackModelKeys: [] },
      chunking: { targetTokens: 10, overlapTokens: 0, respectHeadings: true },
      defaultTopK: 1,
      minScore: 0,
    },
    image: { enabled: false, providerOrder: [] },
    ui: { themeId: 'theme' as AppSettings['ui']['themeId'], mode: 'system', locale: 'en' },
    webChat: { ...DEFAULT_WEB_CHAT_SETTINGS, browser, customBrowserPath },
  };
  const getSettings = vi.fn((): Promise<Result<AppSettings>> => Promise.resolve({ ok: true, value: settings }));
  const settingsService = { get: getSettings } as unknown as SettingsService;
  const files = new Set<string>();
  const fs = { exists: (path: string) => Promise.resolve({ ok: true as const, value: files.has(path) }) };
  const env: NodeJS.ProcessEnv = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Local',
    WINDIR: 'C:\\Windows',
  };
  const locator = new BrowserLocator(fs, env);
  const launches: { executable: string; url: string }[] = [];
  const launch = vi.fn((executable: string, url: string): Result<void> => {
    launches.push({ executable, url });
    return { ok: true as const, value: undefined };
  });
  const launcher: IBrowserLauncher = {
    launch,
  };
  const project = projectSchema.parse({
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Sample',
    workspaceRoot: 'C:\\project',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
  });
  const getProject = vi.fn((projectId: ProjectId): Promise<Project | null> => {
    if (projectId.length === 0) throw new Error('Project id cannot be empty.');
    return Promise.resolve(project);
  });
  const buildWebChatTree = vi.fn(() => Promise.resolve('src/\nsrc/app.ts'));
  const projects = { get: getProject } as unknown as IProjectRepository;
  const context = {
    buildWebChatTree,
  } as unknown as ProjectContextService;
  const service = new WebChatService({
    settings: settingsService,
    projects,
    context,
    launcher,
    locator,
    fileSystem: fs,
    env,
    logger: createLogger({ streams: [] }),
  });
  return {
    service,
    settings,
    getSettings,
    launch,
    launches,
    files,
    getProject,
    buildWebChatTree,
    project,
    env,
    locator,
  };
}

describe('WebChatService', () => {
  it('lists available browsers and propagates settings errors', async () => {
    const { service, getSettings, files } = setup();
    files.add('C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe');
    const browsers = await service.browsers();
    expect(browsers.ok).toBe(true);
    if (browsers.ok)
      expect(browsers.value).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ browser: WebChatBrowser.DEFAULT, installed: true }),
          expect.objectContaining({ browser: WebChatBrowser.COCCOC, installed: true }),
        ]),
      );
    getSettings.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'Settings failed.', remediation: ['Try again.'], retryable: false },
    });
    await expect(service.browsers()).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  });

  it.each([WebChatBrowser.COCCOC, WebChatBrowser.CHROME, WebChatBrowser.EDGE, WebChatBrowser.FIREFOX])(
    'opens links in installed %s',
    async (browser) => {
      const { service, launch, files } = setup(browser);
      const roots: Record<string, string> = {
        coccoc: 'C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe',
        chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      };
      const executable = roots[browser];
      if (executable === undefined) throw new Error(`No fixture path for ${browser}`);
      files.add(executable);
      await expect(service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({ ok: true, value: { browser } });
      expect(launch.mock.calls[0]).toEqual([executable, 'https://chatgpt.com/']);
    },
  );

  it('prefers detected Cốc Cốc for the default choice and falls back to system browser when absent', async () => {
    const detected = setup(WebChatBrowser.DEFAULT);
    const coccoc = 'C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe';
    detected.files.add(coccoc);
    await expect(detected.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      value: { browser: WebChatBrowser.COCCOC },
    });
    const missing = setup(WebChatBrowser.CHROME);
    missing.files.add('C:\\Windows\\explorer.exe');
    await expect(missing.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      value: { browser: WebChatBrowser.DEFAULT },
    });
    expect(missing.launch.mock.calls[0]).toEqual(['C:\\Windows\\explorer.exe', 'https://chatgpt.com/']);
  });

  it('opens a custom browser and returns actionable errors when launch cannot be resolved', async () => {
    const path = 'C:\\Tools\\browser.exe';
    const custom = setup(WebChatBrowser.CUSTOM, path);
    custom.files.add(path);
    await expect(custom.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      ok: true,
      value: { browser: WebChatBrowser.CUSTOM },
    });

    const missingSystemBrowser = setup();
    delete missingSystemBrowser.env.WINDIR;
    await expect(missingSystemBrowser.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });

    const failedLaunch = setup(WebChatBrowser.CHROME);
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    failedLaunch.files.add(chrome);
    failedLaunch.launch.mockReturnValue({
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Browser could not be launched.',
        remediation: ['Try again.'],
        retryable: false,
      },
    });
    await expect(failedLaunch.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INTERNAL',
        remediation: ['Choose another browser in Settings → Web chat.'],
      },
    });

    const relativeExecutable = setup(WebChatBrowser.CHROME);
    vi.spyOn(relativeExecutable.locator, 'locate').mockResolvedValue('relative.exe');
    await expect(relativeExecutable.service.open('chatgpt' as WebChatLinkId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  });

  it('rejects disabled/unknown links and returns a brief without file contents', async () => {
    const { service, settings, getSettings, getProject, buildWebChatTree } = setup();
    const firstLink = settings.webChat.links[0];
    if (firstLink === undefined) throw new Error('Default web chat link is missing.');
    const disabled = { ...firstLink, enabled: false };
    const disabledSettings = { ...settings, webChat: { ...settings.webChat, links: [disabled] } };
    getSettings.mockResolvedValue({ ok: true, value: disabledSettings });
    await expect(service.open(disabled.id)).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(service.open('missing' as WebChatLinkId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const projectId = z.custom<ProjectId>().parse('00000000-0000-4000-8000-000000000001');
    const brief = await service.projectBrief(projectId);
    if (!brief.ok) return;
    expect(brief.value.text).toContain('Sample');
    expect(brief.value.text).toContain('src/app.ts');
    expect(brief.value.text).not.toContain('file contents');
    expect(getProject.mock.calls).toHaveLength(1);
    expect(buildWebChatTree).toHaveBeenCalledWith('C:\\project');
  });

  it('limits the project brief to 150 tree lines and 4,000 characters and handles unknown projects', async () => {
    const { service, getProject, buildWebChatTree } = setup();
    buildWebChatTree.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => `file-${String(index)}.ts`).join('\n'),
    );
    const projectId = z.custom<ProjectId>().parse('00000000-0000-4000-8000-000000000001');
    const result = await service.projectBrief(projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text.length).toBeLessThanOrEqual(4000);
    const tree = result.value.text.split('Folder structure (depth 2):\n')[1]?.split('\nMy question: ')[0];
    expect(tree?.split('\n')).toHaveLength(150);
    getProject.mockResolvedValue(null);
    await expect(
      service.projectBrief(z.custom<ProjectId>().parse('00000000-0000-4000-8000-000000000002')),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('caps a long project brief at 4,000 characters while keeping its instruction', async () => {
    const { service, buildWebChatTree } = setup();
    buildWebChatTree.mockResolvedValue('x'.repeat(5000));
    const projectId = z.custom<ProjectId>().parse('00000000-0000-4000-8000-000000000001');
    const result = await service.projectBrief(projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text.length).toBeLessThanOrEqual(4000);
    expect(result.value.text.slice(-13)).toBe('My question: ');
  });
});
