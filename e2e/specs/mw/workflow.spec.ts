import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { remote } from 'webdriverio';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

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
  const session = await remote({ hostname: '127.0.0.1', port: 4448, path: '/', capabilities });
  activeSession = session;
  await session.waitUntil(async () => (await session.$('footer[role="status"]').getText()).includes('Ready v0.1.0'), {
    timeout: 20_000,
    timeoutMsg: 'Scripted MW app did not become ready',
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
}

function configureValidation(folder: string): void {
  const compilerShim = join(folder, 'node_modules', 'typescript', 'bin');
  mkdirSync(compilerShim, { recursive: true });
  writeFileSync(join(compilerShim, 'tsc'), 'process.exit(0);\n', 'utf8');

  const eslintShim = join(folder, 'node_modules', 'eslint', 'bin');
  mkdirSync(eslintShim, { recursive: true });
  writeFileSync(join(eslintShim, 'eslint.js'), "process.stdout.write('[]');\nprocess.exit(0);\n", 'utf8');

  const vitestShim = join(folder, 'node_modules', 'vitest');
  mkdirSync(vitestShim, { recursive: true });
  const summary = JSON.stringify({
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{ name: 'workflow.test.ts', assertionResults: [{ title: 'workflow', status: 'passed' }] }],
  });
  writeFileSync(
    join(vitestShim, 'vitest.mjs'),
    `process.stdout.write(${JSON.stringify(summary)});\nprocess.exit(0);\n`,
    'utf8',
  );
}

async function assertRecent(session: Session, moduleId: string, summary: RegExp): Promise<string> {
  const graph = session.$('[aria-label="Workflow graph"]');
  await session.waitUntil(async () => (await graph.$$('.react-flow__node').getElements()).length > 0, {
    timeout: 20_000,
    timeoutMsg: 'Workflow graph did not render any nodes',
  });
  const nodes = await graph.$$('.react-flow__node').getElements();
  let targetIndex = -1;
  let startingIndex = -1;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    const nodeId = await node.getAttribute('data-id');
    if (nodeId === moduleId) targetIndex = index;
    if (nodeId === 'chat') startingIndex = index;
  }
  if (targetIndex === -1) throw new Error(`Workflow node ${moduleId} was not rendered`);
  if (startingIndex === -1) throw new Error('Workflow graph did not render its first Chat node');
  const focused = await session.execute((selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    node?.focus();
    return node !== null && document.activeElement === node;
  }, '[aria-label="Workflow graph"] .react-flow__node[data-id="chat"]');
  if (!focused) throw new Error('Could not focus the first workflow node');
  const steps = (targetIndex - startingIndex + nodes.length) % nodes.length;
  for (let step = 0; step < steps; step += 1) await session.keys('ArrowRight');
  const targetFocused = await session.execute((id: string) => {
    const activeNode = document.activeElement?.closest('.react-flow__node');
    return activeNode?.getAttribute('data-id') === id;
  }, moduleId);
  if (!targetFocused) throw new Error(`Keyboard navigation did not focus workflow node ${moduleId}`);
  await session.keys('Enter');
  await session.$('button=Recent').click();
  await session.waitUntil(async () => summary.test(await session.$('body').getText()), {
    timeout: 30_000,
    timeoutMsg: `Workflow history for ${moduleId} did not include ${summary.toString()}`,
  });
  return session.$('body').getText();
}

describe('MW workflow map', () => {
  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
  });

  afterEach(async () => {
    const session = activeSession;
    activeSession = undefined;
    if (session !== undefined) await session.deleteSession();
  });

  it('TC-MW-010 displays live chat routing activity in the workflow graph', async () => {
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Workflow E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Workflow E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Message').setValue('workflow smoke request');
    await browser.$('button=Send').click();
    try {
      await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Scripted assistant reply.'), {
        timeout: 30_000,
        timeoutMsg: 'The scripted workflow chat did not complete',
      });
    } catch (error) {
      const body = await browser.$('body').getText();
      throw new Error(`TC-MW-010 chat failed; body: ${body.slice(-1_500)}`, { cause: error });
    }
    await browser.$('nav[aria-label="Main navigation"] a[href="#workflow"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Router'));
    const routerText = () =>
      browser.execute(
        (selector: string) => document.querySelector(selector)?.textContent ?? '',
        '[data-id="router"].react-flow__node',
      );
    try {
      await browser.waitUntil(async () => /Calls \(24 h\)\s*[1-9]\d*/.test(await routerText()), {
        timeout: 20_000,
      });
    } catch (error) {
      const nodeText = await routerText();
      const body = await browser.$('body').getText();
      throw new Error(`TC-MW-010 router activity missing; node: ${nodeText}; body: ${body.slice(-1_500)}`, {
        cause: error,
      });
    }
    const focused = await browser.execute((selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      node?.focus();
      return node !== null && document.activeElement === node;
    }, '[data-id="router"].react-flow__node');
    if (!focused) throw new Error('Could not focus the Router workflow node');
    await browser.keys('Enter');
    await browser.$('button=Recent').click();
    const body = await browser.$('body').getText();
    expect(body).to.match(/Router completed on [a-z0-9_-]+\/[a-z0-9._-]+/i);
    expect(body).not.to.include('workflow smoke request');
  });

  it('TC-MW-011 records ingest, RAG retrieval, and pipeline validation in redacted module history', async () => {
    const session = await openScriptedSession();
    const folder = createTemporaryProjectFolder();
    const documentText = 'The bronze lantern is stored in the private north archive.';
    const queryText = 'Where is the bronze lantern stored?';
    const privateMarker = '--token=private-mw-qa-marker';
    writeFileSync(join(folder, 'guide.md'), `# Lantern guide\n\n${documentText}\n`, 'utf8');
    configureValidation(folder);
    await createProject(session, 'Workflow coverage project', folder);

    await session.$('nav[aria-label="Main navigation"] a[href="#knowledge"]').click();
    await session.$('aria/Workspace-relative file or folder paths (one per line)').setValue('guide.md');
    await session.$('button=Add sources').click();
    await session.waitUntil(async () => {
      const body = await session.$('body').getText();
      return body.includes('guide.md') && body.includes('Indexed');
    });

    await session.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await session.$('button=New chat').click();
    await session.$('aria/Use knowledge').click();
    await session.$('#chat-model').selectByAttribute('value', 'anthropic/claude-opus-5-5');
    await session.$('aria/Message').setValue(queryText);
    await session.$('button=Send').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Add greeting'), {
      timeout: 30_000,
    });

    await session.$('nav[aria-label="Main navigation"] a[href="#code"]').click();
    await session.$('#pipeline-prompt').setValue(`Create a greeting file. ${privateMarker}`);
    await session.$('button=Run pipeline').click();
    await session.waitUntil(
      async () => (await session.$('[aria-label="Pipeline stages"]').getText()).includes('Completed'),
      { timeout: 70_000, timeoutMsg: 'Scripted MW pipeline did not complete validation' },
    );

    await session.$('nav[aria-label="Main navigation"] a[href="#workflow"]').click();
    await session.waitUntil(async () => (await session.$('body').getText()).includes('Workflow'));
    const embeddingHistory = await assertRecent(session, 'embeddings', /Embedded \d+ chunks with /);
    expect(embeddingHistory).not.to.include(documentText);
    const retrievalHistory = await assertRecent(session, 'retriever', /Retrieved \d+ hits/);
    expect(retrievalHistory).not.to.include(queryText);
    const commandHistory = await assertRecent(session, 'command_runner', /Command (finished|exited \d+|timed out): /);
    expect(commandHistory).not.to.include(privateMarker);
    expect(commandHistory).not.to.include(documentText);
    expect(commandHistory).not.to.include(queryText);
  });
});
