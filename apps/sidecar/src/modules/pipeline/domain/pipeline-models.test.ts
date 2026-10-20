import { expect, it } from 'vitest';
import { ModelCapability, ProviderId, type ModelDescriptor } from '@itstudio/schemas';
import { modelKeySchema } from '../../../kernel/validation/common.js';
import { augmentPipelineRoles } from './pipeline-models.js';

it('TC-OWNER-FB3-006 appends keyed enabled models per role, preserving priority and requiring code for coder', () => {
  const descriptor = (id: string, capabilities: ModelDescriptor['capabilities'], enabled = true): ModelDescriptor => ({
    key: modelKeySchema.parse('deepseek/' + id),
    provider: ProviderId.DEEPSEEK,
    providerModelId: id,
    displayName: id,
    enabled,
    capabilities,
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
  });
  const chat = [ModelCapability.CHAT, ModelCapability.JSON_MODE];
  const models = [
    descriptor('preferred', [...chat, ModelCapability.CODE]),
    descriptor('json-chat', chat),
    descriptor('coder', [...chat, ModelCapability.CODE]),
    descriptor('embedding', [ModelCapability.EMBEDDING]),
    descriptor('no-json', [ModelCapability.CHAT]),
    descriptor('disabled', [...chat, ModelCapability.CODE], false),
    descriptor('no-key', [...chat, ModelCapability.CODE]),
  ];
  const keys = models.map((model) => model.key);
  const preferred = keys[0];
  if (preferred === undefined) throw new Error('Missing fixture');
  const result = augmentPipelineRoles(
    { pm: [preferred], coder: [preferred], reviewer: [preferred] },
    models,
    keys.slice(0, -1),
  );
  expect(result.pm).toEqual(keys.slice(0, 3));
  expect(result.reviewer).toEqual(keys.slice(0, 3));
  expect(result.coder).toEqual([keys[0], keys[2]]);
});
