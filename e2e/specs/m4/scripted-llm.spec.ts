import { expect } from 'chai';
import { Key, remote } from 'webdriverio';
import { setDiagnosticSession } from '../../helpers/diagnostics.js';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, openSettings } from '../../helpers/ui.js';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

type Session = Awaited<ReturnType<typeof remote>>;
let activeSession: Session | undefined;

async function closeScriptedSession(): Promise<void> {
  const session = activeSession;
  activeSession = undefined;
  if (session === undefined) return;
  try {
    await session.deleteSession();
  } finally {
    setDiagnosticSession(undefined);
  }
}

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
  setDiagnosticSession(session);
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
  await session.$('nav a[href="#chat"]').click();
}

async function selectOpenAiModel(session: Session): Promise<void> {
  await session.$('#chat-model').selectByAttribute('value', 'openai/gpt-5.4-mini');
}

describe('M4 scripted LLM cases', () => {
  afterEach(closeScriptedSession);

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
    const session = await openScriptedSession(4450);
    await ensureProviderKeys(['openai', 'google'], session);
    await createProject(session, 'Fallback Badge Project');
    await session.$('button=New chat').click();
    await selectOpenAiModel(session);
    await session.$('aria/Message').setValue('fallback badge');
    await session.$('button=Send').click();
    const badge = session.$('ol[aria-label="Messages"] p[role="status"]');
    await badge.waitForDisplayed();
    expect(await badge.getText()).to.equal('Answered by Gemini 3.8 Flash (fallback from GPT-5.4 mini: server error)');
  });

  it('TC-M4-023 lists a priced fallback candidate and handles Use and Escape', async () => {
    const session = await openScriptedSession(4447);
    await ensureProviderKeys(['openai', 'anthropic', 'google', 'groq'], session);
    await openSettings('router', session);
    const autoFallback = session.$('aria/Auto Fallback');
    if (await autoFallback.isSelected()) await autoFallback.click();
    await session.waitUntil(async () => !(await autoFallback.isSelected()));
    await ensureProviderKeys(undefined, session);
    await session.$('nav a[href="#chat"]').click();
    await createProject(session, 'Fallback Modal Project');
    await session.$('nav a[href="#chat"]').click();
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
    await closeScriptedSession();

    const cancelSession = await openScriptedSession(4451);
    await ensureProviderKeys(['openai', 'anthropic', 'google', 'groq'], cancelSession);
    await openSettings('router', cancelSession);
    const cancelFallbackToggle = cancelSession.$('aria/Auto Fallback');
    if (await cancelFallbackToggle.isSelected()) await cancelFallbackToggle.click();
    await cancelSession.waitUntil(async () => !(await cancelFallbackToggle.isSelected()));
    await createProject(cancelSession, 'Fallback Cancel Project');
    await cancelSession.$('button=New chat').click();
    await selectOpenAiModel(cancelSession);
    await cancelSession.$('aria/Message').setValue('cancel fallback');
    await cancelSession.$('button=Send').click();
    const cancelDialog = cancelSession.$('[role="dialog"]');
    await cancelSession.waitUntil(async () => cancelDialog.isDisplayed(), { timeout: 20_000 });
    await cancelSession.keys(Key.Escape);
    await cancelSession.waitUntil(async () => !(await cancelDialog.isDisplayed()), { timeout: 10_000 });
    await cancelSession.waitUntil(async () => !(await cancelSession.$('button=Stop').isDisplayed()), {
      timeout: 10_000,
    });
    expect(await cancelSession.$('ol[aria-label="Messages"] [role="alert"]').getText()).to.include(
      'Model fallback was declined.',
    );
    expect(await cancelSession.$('ol[aria-label="Messages"]').getText()).not.to.include('Scripted assistant reply.');
  });
});
