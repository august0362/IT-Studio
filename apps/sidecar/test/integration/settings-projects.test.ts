import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { settings } from '../../src/infra/sqlite/schema.js';
import { openDatabase } from '../../src/infra/sqlite/database.js';
import { projectSchema } from '../../src/validation/projects.js';
import { startSidecar, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('settings and project integration', () => {
  it('TC-M1-020 returns schema-valid defaults on first run', async () => {
    sidecar = await startSidecar();
    const response = await sidecar.call('settings.get');
    const parsed = appSettingsSchema.safeParse(response.result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.router.ladder.length).toBeGreaterThan(0);
      expect(parsed.data.ui.themeId).toBe('arctic-focus');
    }
  }, 30_000);

  it('TC-M1-021 persists settings across process restart', async () => {
    sidecar = await startSidecar();
    const updated = await sidecar.call('settings.update', { patch: { router: { autoFallback: false } } });
    expect(updated.result).toMatchObject({ router: { autoFallback: false } });
    await sidecar.restart();
    await expect(sidecar.call('settings.get')).resolves.toMatchObject({ result: { router: { autoFallback: false } } });
  }, 30_000);

  it('TC-M1-022 rejects invalid settings patches without changing stored settings', async () => {
    sidecar = await startSidecar();
    const before = await sidecar.call('settings.get');
    // @ts-expect-error TC-M1-022 deliberately sends an out-of-contract value (maxFixAttempts must be 1)
    const invalidAttempt = await sidecar.call('settings.update', { patch: { pipeline: { maxFixAttempts: 2 } } });
    expect(invalidAttempt.error?.data).toMatchObject({ code: 'VALIDATION' });
    // @ts-expect-error TC-M1-022 deliberately sends an unbranded, unknown theme id
    const unknownTheme = await sidecar.call('settings.update', { patch: { ui: { themeId: 'unknown-theme' } } });
    expect(unknownTheme.error?.data).toMatchObject({ code: 'VALIDATION' });
    const after = await sidecar.call('settings.get');
    expect(after.result).toEqual(before.result);
  }, 30_000);

  it('TC-M1-023 restores defaults and backs up a corrupted settings row', async () => {
    sidecar = await startSidecar();
    await sidecar.call('settings.get');
    const db = openDatabase(sidecar.dataDir);
    await db.db.update(settings).set({ json: '{corrupt', updatedAt: new Date().toISOString() });
    db.client.close();
    const recovered = await sidecar.call('settings.get');
    expect(recovered.result).toMatchObject({ ui: { themeId: 'arctic-focus' } });
    expect((await readdir(sidecar.dataDir)).some((name) => name.startsWith('settings_backup_'))).toBe(true);
    expect(sidecar.stderr.join('')).toContain('Invalid settings reset to defaults');
  }, 30_000);

  it('TC-M1-024 validates project path classes and duplicate roots', async () => {
    sidecar = await startSidecar();
    const filePath = resolve(sidecar.dataDir, 'not-a-directory.txt');
    await writeFile(filePath, 'data');
    const relative = await sidecar.call('project.create', { name: 'Relative', workspaceRoot: 'relative' });
    const missing = await sidecar.call('project.create', {
      name: 'Missing',
      workspaceRoot: resolve(sidecar.dataDir, 'missing'),
    });
    const file = await sidecar.call('project.create', { name: 'File', workspaceRoot: filePath });
    const root = await sidecar.call('project.create', { name: 'Root', workspaceRoot: parse(sidecar.dataDir).root });
    expect(relative.error?.data).toMatchObject({ code: 'VALIDATION' });
    expect(missing.error?.data).toMatchObject({ code: 'NOT_FOUND' });
    expect(file.error?.data).toMatchObject({ code: 'VALIDATION' });
    expect(root.error?.data).toMatchObject({ code: 'VALIDATION' });
    const workspace = resolve(sidecar.dataDir, 'project-workspace');
    await mkdir(workspace);
    const created = await sidecar.call('project.create', { name: 'Valid', workspaceRoot: workspace });
    const duplicate = await sidecar.call('project.create', { name: 'Again', workspaceRoot: workspace });
    expect(created.result).toMatchObject({ name: 'Valid', workspaceRoot: workspace });
    expect(duplicate.error?.data).toMatchObject({ code: 'CONFLICT' });
  }, 30_000);

  it('TC-M1-025 sets the active project in persisted settings', async () => {
    sidecar = await startSidecar();
    const workspace = resolve(sidecar.dataDir, 'active-workspace');
    await mkdir(workspace);
    const project = await sidecar.call('project.create', { name: 'Active', workspaceRoot: workspace });
    const parsedProject = projectSchema.safeParse(project.result);
    expect(parsedProject.success).toBe(true);
    if (!parsedProject.success) return;
    const projectId = parsedProject.data.id;
    await sidecar.call('project.setActive', { projectId });
    await expect(sidecar.call('settings.get')).resolves.toMatchObject({ result: { activeProjectId: projectId } });
  }, 30_000);
});
