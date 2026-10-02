import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AppError,
  Project,
  RpcMethod,
  RpcMethodMap,
  ModelDescriptor,
  ChatMessage,
  RouterConfig,
  ProjectPnL,
  RetrievalQuery,
  TaskSpec,
  CoderOutput,
  ReviewVerdict,
  FileOperation,
  ExtToSidecar,
  AppSettings,
  ImageAsset,
  ThemeCatalog,
  RpcNotificationName,
} from '@itstudio/schemas';
import type { z } from 'zod';
import { appErrorSchema } from './errors.js';
import { projectSchema } from './projects.js';
import { modelDescriptorSchema } from './models.js';
import { chatMessageSchema } from './chat.js';
import { routerConfigSchema } from './router.js';
import { projectPnLSchema } from './cost.js';
import { retrievalQuerySchema } from './rag.js';
import { coderOutputSchema, reviewVerdictSchema, taskSpecSchema, toJsonSchema } from './pipeline.js';
import { fileOperationSchema } from './worker.js';
import { extToSidecarSchema } from './vscode.js';
import { appSettingsSchema } from './settings.js';
import { imageAssetSchema, themeCatalogSchema } from './image.js';
import {
  rpcParamsSchemas,
  rpcResultSchemas,
  rpcNotificationParamsSchemas,
  rpcRequestEnvelopeSchema,
  rpcNotificationEnvelopeSchema,
} from './ipc.js';
import {
  commandRunIdSchema,
  chunkIdSchema,
  conversationIdSchema,
  documentIdSchema,
  imageAssetIdSchema,
  ingestJobIdSchema,
  isoDateTimeSchema,
  ledgerEntryIdSchema,
  llmRequestIdSchema,
  microUsdSchema,
  messageIdSchema,
  pipelineRunIdSchema,
  priceTableVersionSchema,
  projectIdSchema,
  revenueEntryIdSchema,
  sha256Schema,
  signedMicroUsdSchema,
  toolCallIdSchema,
  transactionIdSchema,
  vndSchema,
  workspaceRelativePathSchema,
} from './brand.js';
import { jsonObjectSchema, modelKeySchema, parse } from './common.js';
import { themeIdSchema, hexColorSchema } from './brand.js';

describe('schema contract type checks', () => {
  it('keeps contract outputs assignable in both directions', () => {
    expectTypeOf<z.output<typeof appErrorSchema>>().toExtend<AppError>();
    expectTypeOf<AppError>().toExtend<z.output<typeof appErrorSchema>>();
    expectTypeOf<z.output<typeof projectSchema>>().toExtend<Project>();
    expectTypeOf<Project>().toExtend<z.output<typeof projectSchema>>();
    type ParamOutputs = { [M in RpcMethod]: z.output<(typeof rpcParamsSchemas)[M]> };
    type ContractParams = { [M in RpcMethod]: RpcMethodMap[M]['params'] };
    expectTypeOf<ParamOutputs>().toEqualTypeOf<ContractParams>();
    expectTypeOf<z.output<(typeof rpcResultSchemas)['project.list']>>().toExtend<
      RpcMethodMap['project.list']['result']
    >();
    expectTypeOf<RpcMethodMap['project.list']['result']>().toExtend<
      z.output<(typeof rpcResultSchemas)['project.list']>
    >();
    expectTypeOf<z.output<typeof modelDescriptorSchema>>().toExtend<ModelDescriptor>();
    expectTypeOf<z.output<typeof chatMessageSchema>>().toExtend<ChatMessage>();
    expectTypeOf<z.output<typeof routerConfigSchema>>().toExtend<RouterConfig>();
    expectTypeOf<z.output<typeof projectPnLSchema>>().toExtend<ProjectPnL>();
    expectTypeOf<z.output<typeof retrievalQuerySchema>>().toExtend<RetrievalQuery>();
    expectTypeOf<z.output<typeof taskSpecSchema>>().toExtend<TaskSpec>();
    expectTypeOf<z.output<typeof coderOutputSchema>>().toExtend<CoderOutput>();
    expectTypeOf<z.output<typeof reviewVerdictSchema>>().toExtend<ReviewVerdict>();
    expectTypeOf<z.output<typeof fileOperationSchema>>().toExtend<FileOperation>();
    expectTypeOf<z.output<typeof extToSidecarSchema>>().toExtend<ExtToSidecar>();
    expectTypeOf<z.output<typeof appSettingsSchema>>().toExtend<AppSettings>();
    expectTypeOf<z.output<typeof imageAssetSchema>>().toExtend<ImageAsset>();
    expectTypeOf<z.output<typeof themeCatalogSchema>>().toExtend<ThemeCatalog>();
    expectTypeOf<keyof typeof rpcNotificationParamsSchemas>().toEqualTypeOf<RpcNotificationName>();
  });
  it('executes every schema family', () => {
    const schemas = [
      appErrorSchema,
      projectSchema,
      modelDescriptorSchema,
      chatMessageSchema,
      routerConfigSchema,
      projectPnLSchema,
      retrievalQuerySchema,
      coderOutputSchema,
      reviewVerdictSchema,
      taskSpecSchema,
      fileOperationSchema,
      extToSidecarSchema,
      appSettingsSchema,
      imageAssetSchema,
      themeCatalogSchema,
      rpcRequestEnvelopeSchema,
      rpcNotificationEnvelopeSchema,
      ...Object.values(rpcParamsSchemas),
      ...Object.values(rpcResultSchemas),
      ...Object.values(rpcNotificationParamsSchemas),
    ];
    for (const schema of schemas) schema.safeParse({});
  });
});

describe('branded validators', () => {
  const uuid = 'aa74f72d-b5b5-4e15-90ad-499dd51679a2';
  for (const schema of [
    projectIdSchema,
    conversationIdSchema,
    messageIdSchema,
    llmRequestIdSchema,
    pipelineRunIdSchema,
    ledgerEntryIdSchema,
    revenueEntryIdSchema,
    documentIdSchema,
    chunkIdSchema,
    ingestJobIdSchema,
    transactionIdSchema,
    commandRunIdSchema,
    imageAssetIdSchema,
  ]) {
    it('accepts UUIDs and rejects malformed identifiers', () => {
      expect(schema.safeParse(uuid).success).toBe(true);
      for (const value of ['', 'not-a-uuid', 'aa74f72d-b5b5-4e15-90ad'])
        expect(schema.safeParse(value).success).toBe(false);
    });
  }
  it('validates ISO UTC timestamps, nonnegative currencies, model keys, and hashes', () => {
    expect(isoDateTimeSchema.safeParse('2026-10-01T08:00:00.000Z').success).toBe(true);
    for (const value of ['2026-10-01', '2026-10-01T08:00:00+01:00', 'bad'])
      expect(isoDateTimeSchema.safeParse(value).success).toBe(false);
    for (const schema of [microUsdSchema, vndSchema]) {
      expect(schema.safeParse(0).success).toBe(true);
      for (const value of [-1, 1.5, '2']) expect(schema.safeParse(value).success).toBe(false);
    }
    expect(signedMicroUsdSchema.safeParse(-1).success).toBe(true);
    expect(modelKeySchema.safeParse('openai/gpt-5.5').success).toBe(true);
    for (const value of ['unknown/model', 'openai/bad space', 'openai/'])
      expect(modelKeySchema.safeParse(value).success).toBe(false);
    expect(sha256Schema.safeParse('a'.repeat(64)).success).toBe(true);
    for (const value of ['', 'g'.repeat(64), 'a'.repeat(63)]) expect(sha256Schema.safeParse(value).success).toBe(false);
  });
  it('normalizes relative paths and rejects traversal and absolute paths', () => {
    expect(workspaceRelativePathSchema.parse('src\\main.ts')).toBe('src/main.ts');
    for (const value of [
      '',
      '../secret',
      'src/../../secret',
      '..\\secret',
      '/root/file',
      '\\root\\file',
      'C:\\temp\\file',
      'a\0b',
    ])
      expect(workspaceRelativePathSchema.safeParse(value).success).toBe(false);
  });
  it('validates the remaining branded strings and returns safe validation errors', () => {
    expect(priceTableVersionSchema.safeParse('seed-1').success).toBe(true);
    for (const value of ['', ' ', null, 17]) expect(priceTableVersionSchema.safeParse(value).success).toBe(false);
    expect(themeIdSchema.safeParse('arctic-focus').success).toBe(true);
    for (const value of ['', 'Arctic Focus', 'bad--theme']) expect(themeIdSchema.safeParse(value).success).toBe(false);
    expect(hexColorSchema.safeParse('#0d47a1').success).toBe(true);
    for (const value of ['#FFF', '#GGGGGG', '0d47a1']) expect(hexColorSchema.safeParse(value).success).toBe(false);
    const valid = parse(jsonObjectSchema, { safe: true });
    expect(valid.ok).toBe(true);
    const invalid = parse(jsonObjectSchema, { token: 'private-value', wrong: undefined });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(JSON.stringify(invalid.error)).not.toContain('private-value');
  });
});

describe('boundary schemas', () => {
  it('accepts and rejects representative RPC parameters', () => {
    const samples: readonly [RpcMethod, unknown, unknown][] = [
      ['system.ping', {}, null],
      ['project.create', { name: 'Demo', workspaceRoot: 'C:/demo' }, {}],
      ['project.setActive', { projectId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2' }, { projectId: 'bad' }],
      ['secrets.delete', { provider: 'openai' }, { provider: 'fake' }],
      ['chat.createConversation', { projectId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2' }, { projectId: 'bad' }],
      [
        'chat.send',
        { conversationId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2', text: 'hello' },
        { conversationId: 'bad', text: 8 },
      ],
      [
        'router.resolveFallback',
        { requestId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2', action: 'abort' },
        { requestId: 'bad', action: 'invalid' },
      ],
      [
        'ledger.query',
        { projectId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2', limit: 20 },
        { projectId: 'bad', limit: '20' },
      ],
      [
        'rag.query',
        { projectId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2', query: 'x', topK: 3, minScore: 0.5 },
        { projectId: 'bad', query: 'x', topK: 0, minScore: 2 },
      ],
      [
        'pipeline.start',
        { projectId: 'aa74f72d-b5b5-4e15-90ad-499dd51679a2', prompt: 'work' },
        { projectId: 'bad', prompt: 5 },
      ],
    ];
    for (const [method, valid, invalid] of samples) {
      expect(rpcParamsSchemas[method].safeParse(valid).success, method).toBe(true);
      expect(rpcParamsSchemas[method].safeParse(invalid).success, method).toBe(false);
    }
  });
  it('enforces pipeline constraints, severity values, and JSON Schema conversion', () => {
    expect(
      reviewVerdictSchema.safeParse({
        approved: true,
        summary: 'ok',
        findings: [{ severity: 'unknown', category: 'correctness', path: 'a.ts', message: 'x', suggestedFix: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      coderOutputSchema.safeParse({
        summary: 'x',
        assumptions: [],
        operations: [{ kind: 'create', path: '../x', content: 'x' }],
      }).success,
    ).toBe(false);
    expect(toJsonSchema(taskSpecSchema)).toHaveProperty('type', 'object');
  });
});

describe('toolCallIdSchema', () => {
  it('accepts provider-issued opaque ids and rejects unsafe values', () => {
    for (const ok of ['toolu_01ABC', 'call_0', 'call_abc-DEF.1:2', '123e4567-e89b-42d3-a456-426614174000']) {
      expect(toolCallIdSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['', 'a b', 'x'.repeat(129), 'call\n1', '<script>']) {
      expect(toolCallIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});
