import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { expect } from 'chai';
import { createTemporaryProjectFolder, openSettings, resetLocaleToEnglish, waitForReady } from '../../helpers/ui.js';

let projectRoot: string | undefined;

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function createGitProject(): string {
  const root = createTemporaryProjectFolder();
  projectRoot = root;
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'greeting.ts'), 'export const greeting = "hello";\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), '.itstudio/\n', 'utf8');
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'IT Studio E2E']);
  git(root, ['config', 'user.email', 'orchestration-e2e@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'core.hooksPath', '.git/hooks']);
  git(root, ['add', '--', 'src/greeting.ts', '.gitignore']);
  git(root, ['commit', '-m', 'test: initialize orchestration fixture']);
  return root;
}

async function capture(name: string): Promise<void> {
  const directory = process.env.ITSTUDIO_E2E_EVIDENCE_DIR;
  if (directory !== undefined) await browser.saveScreenshot(join(directory, `ORCH-019-${name}.png`));
}

describe('Orchestration', () => {
  after(() => {
    if (projectRoot === undefined) return;
    const target = resolve(projectRoot);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('itstudio-e2e-project-'))
      throw new Error(`Refusing to remove an unexpected orchestration fixture path: ${target}`);
    rmSync(target, { recursive: true, force: true });
  });

  it('ORCH-019 plans with mock agents, starts a live DAG and approves one merge', async () => {
    await waitForReady();
    await resetLocaleToEnglish();
    // API selections make UI readiness independent of installed CLIs. The fixture flag runs mock agents only.
    await openSettings('orchestration');
    const supervisor = browser.$('label*=Supervisor').$('select');
    await supervisor.waitForDisplayed();
    const modelKey = await supervisor.$('optgroup[label="API models"] option').getAttribute('value');
    if (modelKey === null || modelKey.length === 0) throw new Error('No code-capable model in the E2E seed');
    for (const role of ['Supervisor', 'Worker A', 'Worker B', 'Reviewer'])
      await browser.$(`label*=${role}`).$('select').selectByAttribute('value', modelKey);
    await browser.$('button=Save').click();
    await browser.$('p=Settings saved.').waitForDisplayed();

    const root = createGitProject();
    const initialHead = git(root, ['rev-parse', 'HEAD']);
    const originalContent = readFileSync(join(root, 'src', 'greeting.ts'), 'utf8');
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Orchestration E2E Project');
    await browser.$('aria/Folder path').setValue(root);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) ===
        'Orchestration E2E Project',
    );
    await browser.$('nav a[href="#code"]').click();
    await browser.$('button[role="tab"]=Orchestration').click();
    const request = browser.$('section[aria-labelledby="orch-code-heading"] textarea');
    await request.waitForEnabled();
    await request.setValue('Check the greeting with mock agents and prepare it for approval.');
    await browser.$('button=Plan').click();
    await browser.$('h3=Run: Plan ready').waitForDisplayed();
    expect(await browser.$('thead').getText()).to.include('Task');
    expect(await browser.$('tbody').getText()).to.include('Implement request');
    expect(await browser.$('tbody').getText()).to.include('src/**');
    const taskNode = browser.$('.react-flow__node[data-id="T1"]');
    await taskNode.waitForDisplayed({ timeout: 15_000 });
    expect(await taskNode.$('button').getAttribute('aria-label')).to.include('Waiting');
    await taskNode.scrollIntoView({ block: 'center' });
    await capture('plan-ready');

    await browser.$('button=Start').click();
    await browser.$('h3=Run: Awaiting approval').waitForDisplayed({ timeout: 70_000 });
    // The DAG must change through process events while this view stays mounted.
    await browser.waitUntil(
      async () => (await taskNode.$('button').getAttribute('aria-label'))?.includes('Done') === true,
    );
    expect(git(root, ['rev-parse', 'HEAD'])).to.equal(initialHead);
    expect(existsSync(join(root, 'src', 'orchestration-e2e.ts'))).to.equal(false);
    expect(git(root, ['rev-list', '--count', '--first-parent', '--merges', 'main'])).to.equal('0');
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Verdict: Pass'));
    expect(await browser.$('body').getText()).to.include('Input / output tokens: unknown / unknown');
    expect(await browser.$('body').getText()).to.include('Mock');
    await capture('awaiting-approval');

    await browser.$('button=Approve merge').click();
    await browser.$('h3=Run: Completed').waitForDisplayed({ timeout: 30_000 });
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/u);
    expect(parents).to.have.length(3);
    expect(parents[1]).to.equal(initialHead);
    expect(git(root, ['rev-list', '--count', '--first-parent', '--merges', 'main'])).to.equal('1');
    expect(git(root, ['log', '-1', '--format=%s'])).to.match(/^Merge IT Studio orchestration run /u);
    expect(git(root, ['status', '--porcelain'])).to.equal('');
    expect(git(root, ['worktree', 'list', '--porcelain'])).not.to.include('/.itstudio/orch/');
    expect(git(root, ['branch', '--list', 'itstudio/orch/*'])).to.equal('');
    expect(readFileSync(join(root, 'src', 'greeting.ts'), 'utf8')).to.equal(originalContent);
    expect(readFileSync(join(root, 'src', 'orchestration-e2e.ts'), 'utf8')).to.equal(
      'export const orchestrationE2e = true;\n',
    );
    await capture('merged');
  });
});
