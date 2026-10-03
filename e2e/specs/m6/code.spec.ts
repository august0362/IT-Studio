import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { remote } from 'webdriverio';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder } from '../../helpers/ui.js';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

type Session = Awaited<ReturnType<typeof remote>>;
let activeSession: Session | undefined;

async function openScriptedSession(): Promise<Session> {
  const capabilities: TauriCapabilities = {
    browserName: 'wry',
    'tauri:options': {
      application: `${process.cwd()}\\apps\\desktop\\src-tauri\\target\\debug\\itstudio-desktop.exe`,
    },
  };
  const session = await remote({
    hostname: '127.0.0.1',
    port: 4448,
    path: '/',
    capabilities,
  });
  activeSession = session;
  await session.waitUntil(async () => (await session.$('footer[role="status"]').getText()).includes('Ready v0.1.0'), {
    timeout: 20_000,
    timeoutMsg: 'Scripted M6 app did not become ready',
  });
  await ensureProviderKeys(['openai', 'anthropic', 'google'], session);
  return session;
}

async function createProject(session: Session, name: string, folder: string): Promise<void> {
  await session.$('button[aria-label="Add project"]').click();
  await session.$('aria/Project name').setValue(name);
  await session.$('aria/Folder path').setValue(folder);
  await session.$('button=Create project').click();
  await session.waitUntil(
    async () => (await session.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === name,
  );
  await session.$('nav[aria-label="Main navigation"] a[href="#code"]').click();
}

describe('M6 Code pipeline', () => {
  afterEach(async () => {
    const session = activeSession;
    activeSession = undefined;
    if (session !== undefined) await session.deleteSession();
  });

  it('TC-M6-070 creates a project and observes the scripted pipeline complete', async () => {
    const session = await openScriptedSession();
    await createProject(session, 'Code E2E Project', createTemporaryProjectFolder());
    await session.$('#pipeline-prompt').setValue('Create a sample file');
    await session.$('button=Run pipeline').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Completed'), { timeout: 70_000 });
    expect(await session.$('[aria-label="Pipeline stages"]').getText()).to.include('Completed');
  });

  it('TC-M6-071 shows the failure report after validation fails', async () => {
    const session = await openScriptedSession();
    const folder = createTemporaryProjectFolder();
    const compilerShim = join(folder, 'node_modules', 'typescript', 'bin');
    mkdirSync(compilerShim, { recursive: true });
    writeFileSync(join(compilerShim, 'tsc'), 'process.exit(1);\n', 'utf8');
    await createProject(session, 'Code Failure E2E Project', folder);
    await session.$('#pipeline-prompt').setValue('Create a sample file that fails validation');
    await session.$('button=Run pipeline').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Failure report'), {
      timeout: 70_000,
    });
    expect(await session.$('body').getText()).to.include('next steps');
  });

  it('TC-M6-072 asks for confirmation when cancelling validation', async () => {
    const session = await openScriptedSession();
    await createProject(session, 'Code Cancel E2E Project', createTemporaryProjectFolder());
    await session.$('#pipeline-prompt').setValue('Create a slow validation sample');
    await session.$('button=Run pipeline').click();
    await session.waitUntil(async () =>
      (await session.$('[aria-label="Pipeline stages"]').getText()).includes('Validating'),
    );
    await session.$('button=Cancel run').click();
    expect(await session.$('[role="alertdialog"]').getText()).to.include('roll back');
  });
});
