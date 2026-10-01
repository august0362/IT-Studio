import { describe, expect, it } from 'vitest';
import { loadSeeds } from '../config/load-seeds.js';
import { appSettingsSchema } from '../validation/settings.js';
import { buildDefaultSettings } from './default-settings.js';

describe('buildDefaultSettings', () => {
  it('uses seed values and returns a valid complete default', () => {
    const loaded = loadSeeds('config');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const settings = buildDefaultSettings(loaded.value);
    expect(appSettingsSchema.parse(settings)).toEqual(settings);
    expect(settings.router.ladder).toEqual(loaded.value.defaultLadder);
    expect(settings.pipeline.roleAssignment).toEqual(loaded.value.defaultRoleAssignment);
    expect(settings.rag.embedding).toEqual(loaded.value.defaultEmbedding);
    expect(settings.pricing.extractionModelKey).toBe(loaded.value.defaultPricingExtractionModel);
    expect(settings.pipeline.validationCommands).toEqual(loaded.value.commands);
    expect(settings.ui.themeId).toBe(loaded.value.themes.defaultLight);
  });
});
