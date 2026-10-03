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

async function openScriptedSession(port: number): Promise<Session> {
  const capabilities: TauriCapabilities = {
    browserName: 'wry',
    'tauri:options': {
      application: `${process.cwd()}\\apps\\desktop\\src-tauri\\target\\debug\\itstudio-desktop.exe`,
    },
  };
  const session = await remote({
    hostname: '127.0.0.1',
    port,
    path: '/',
    capabilities,
  });
  activeSession = session;
  await session.waitUntil(async () => (await session.$('footer[role="status"]').getText()).includes('Ready v0.1.0'), {
    timeout: 20_000,
    timeoutMsg: 'Scripted M4 app did not become ready',
  });
  return session;
}

async function createProject(session: Session, name: string): Promise<void> {
  await session.$('button[aria-label="Add project"]').click();
  await session.$('aria/Project name').setValue(name);
  await session.$('aria/Folder path').setValue(createTemporaryProjectFolder());
  await session.$('button=Create project').click();
  await session.waitUntil(async () => (await session.$('[role="tab"][aria-selected="true"]').getText()) === name);
  await session.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
}

async function selectOpenAiModel(session: Session): Promise<void> {
  await session.$('#chat-model').selectByAttribute('value', 'openai/gpt-5.4-mini');
}

async function enableAutoFallback(session: Session): Promise<void> {
  await session.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
  const autoFallback = session.$('aria/Auto Fallback');
  if (!(await autoFallback.isSelected())) await autoFallback.click();
  await session.waitUntil(async () => autoFallback.isSelected());
}

describe('M4 scripted LLM cases', () => {
  afterEach(async () => {
    const session = activeSession;
    activeSession = undefined;
    if (session !== undefined) {
      try {
        await enableAutoFallback(session);
      } finally {
        await session.deleteSession();
      }
    }
  });

  it('TC-M4-021 cancels a slow scripted response without an assistant message', async () => {
    const session = await openScriptedSession(4446);
    await ensureProviderKeys(undefined, session);
    await createProject(session, 'Slow Script Project');
    await session.$('button=New chat').click();
    await selectOpenAiModel(session);
    await session.$('aria/Message').setValue('cancel this response');
    await session.$('button=Send').click();
    await session.waitUntil(async () => session.$('button=Stop').isDisplayed(), { timeout: 10_000 });
    await session.$('button=Stop').click();
    await session.waitUntil(async () => (await session.$('body').getText()).toLowerCase().includes('cancel'));
    expect(await session.$('body').getText()).not.to.include('Scripted assistant reply.');
  });

  it('TC-M4-022 shows a fallback badge when model B answers', async () => {
    const session = await openScriptedSession(4447);
    await ensureProviderKeys(['openai', 'anthropic', 'google', 'groq'], session);
    await createProject(session, 'Fallback Badge Project');
    await session.$('button=New chat').click();
    await selectOpenAiModel(session);
    await session.$('aria/Message').setValue('fallback badge');
    await session.$('button=Send').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Answered by'));
    expect(await session.$('body').getText()).to.include('Llama 3.3 70B (Groq)');
  });

  it('TC-M4-023 lists a priced fallback candidate and handles Use and Escape', async () => {
    const session = await openScriptedSession(4447);
    await ensureProviderKeys(['openai', 'anthropic', 'google', 'groq'], session);
    await session.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const autoFallback = session.$('aria/Auto Fallback');
    if (await autoFallback.isSelected()) await autoFallback.click();
    await session.waitUntil(async () => !(await autoFallback.isSelected()));
    await ensureProviderKeys(undefined, session);
    await session.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await createProject(session, 'Fallback Modal Project');
    await session.$('button=New chat').click();
    await selectOpenAiModel(session);
    await session.$('aria/Message').setValue('use fallback');
    await session.$('button=Send').click();
    const dialog = session.$('[role="dialog"]');
    await session.waitUntil(async () => dialog.isDisplayed());
    const dialogText = await dialog.getText();
    expect(dialogText).to.include('Llama 3.3 70B (Groq)');
    expect(dialogText).to.include('$');
    expect(dialogText).to.include('Use');
    expect(dialogText).to.include('Retry same');
    expect(dialogText).to.include('Cancel');
    await session.$('button=Use').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Scripted assistant reply.'));
    await session.$('button=New chat').click();
    await session.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const cancelFallbackToggle = session.$('aria/Auto Fallback');
    if (await cancelFallbackToggle.isSelected()) await cancelFallbackToggle.click();
    await session.waitUntil(async () => !(await cancelFallbackToggle.isSelected()));
    await session.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await selectOpenAiModel(session);
    await session.$('aria/Message').setValue('cancel fallback');
    await session.$('button=Send').click();
    await session.waitUntil(async () => dialog.isDisplayed());
    await session.keys('ESC');
    await session.waitUntil(async () => !(await dialog.isDisplayed()));
  });
});
