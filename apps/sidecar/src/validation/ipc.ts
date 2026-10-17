import {
  processRecordSchema,
  processEventSchema,
  processListSchema,
  processIdentitySchema,
  processReportSchema,
} from './process.js';
import type {
  RpcError,
  RpcMethod,
  RpcMethodMap,
  RpcNotificationMap,
  RpcNotificationName,
  WebChatLinkId,
} from '@itstudio/schemas';
import type { OrchAttempt, OrchEvent, OrchRun } from '@itstudio/schemas';
import { z } from './common.js';
import { projectSchema } from './projects.js';
import { appSettingsSchema, settingsPatchSchema } from './settings.js';
import { secretStatusSchema, secretHistoryEntrySchema, modelDescriptorSchema } from './models.js';
import { conversationSchema, chatMessageSchema } from './chat.js';
import {
  routerConfigSchema,
  fallbackDecisionSchema,
  routerEventSchema,
  fallbackDecisionRequestSchema,
} from './router.js';
import {
  ledgerQuerySchema,
  ledgerEntrySchema,
  projectPnLSchema,
  portfolioPnLSchema,
  revenueEntrySchema,
  budgetSchema,
  budgetStatusSchema,
  priceTableSchema,
  priceUpdateRunSchema,
  priceEntrySchema,
  priceRowSchema,
  pricingExtractionOptionsSchema,
  fxRateSchema,
  moneyDisplaySchema,
  pageSchema,
  ledgerRowSchema,
  revenueRowSchema,
} from './cost.js';
import { retrievalQuerySchema, ingestJobSchema, sourceDocumentSchema, retrievalHitSchema } from './rag.js';
import { pipelineRunSchema, pipelineEventSchema, failureReportSchema } from './pipeline.js';
import { diagnosticSchema } from './worker.js';
import { vscodeStatusSchema } from './vscode.js';
import { imageAssetSchema } from './image.js';
import { appErrorSchema } from './errors.js';
import { activityEventSchema, workflowGraphSchema, workflowModuleIdSchema } from './workflow.js';
import {
  projectIdSchema,
  conversationIdSchema,
  llmRequestIdSchema,
  pipelineRunIdSchema,
  documentIdSchema,
  modelKeySchema,
  isoDateTimeSchema,
  providerIdSchema,
  messageIdSchema,
  imageAssetIdSchema,
} from './common.js';

const empty = z.strictObject({}).readonly();
const orchRunIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as OrchRun['id']);
const orchTaskIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as OrchRun['tasks'][number]['id']);
const orchRunSchema = z.custom<OrchRun>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'state' in value &&
    'tasks' in value &&
    'limits' in value,
);
const orchAttemptSchema = z.custom<OrchAttempt>(
  (value) => typeof value === 'object' && value !== null && 'id' in value && 'usage' in value && 'agent' in value,
);
const orchEventSchema = z.custom<OrchEvent>((value) => typeof value === 'object' && value !== null && 'type' in value);
export const rpcParamsSchemas = {
  'orch.plan': z.strictObject({ projectId: projectIdSchema, request: z.string().min(1) }).readonly(),
  'orch.start': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.cancel': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.resume': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.approve': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.discard': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.get': z.strictObject({ runId: orchRunIdSchema }).readonly(),
  'orch.list': z
    .strictObject({ projectId: projectIdSchema.exactOptional(), limit: z.number().int().min(1).max(200) })
    .readonly(),
  'orch.attempts': z.strictObject({ runId: orchRunIdSchema, taskId: orchTaskIdSchema.exactOptional() }).readonly(),
  'orch.adapters': empty,
  'process.list': processListSchema,
  'process.get': processIdentitySchema,
  'process.cancel': processIdentitySchema,
  'process.retry': processIdentitySchema,
  'process.dismiss': processIdentitySchema,
  'process.delete': processIdentitySchema,
  'process.report': processReportSchema,
  'system.ping': empty,
  'system.shutdown': empty,
  'project.list': empty,
  'project.create': z.strictObject({ name: z.string(), workspaceRoot: z.string() }).readonly(),
  'project.setActive': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'project.delete': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'settings.get': empty,
  'settings.update': z.strictObject({ patch: settingsPatchSchema }).readonly(),
  'webchat.browsers': empty,
  'webchat.open': z
    .strictObject({
      linkId: z.custom<WebChatLinkId>((value) => typeof value === 'string' && value.length > 0),
    })
    .readonly(),
  'webchat.projectBrief': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'secrets.set': z.strictObject({ provider: providerIdSchema, apiKey: z.string() }).readonly(),
  'secrets.delete': z.strictObject({ provider: providerIdSchema }).readonly(),
  'secrets.status': empty,
  'secrets.verify': z.strictObject({ provider: providerIdSchema }).readonly(),
  'secrets.verifyAndSave': z.strictObject({ provider: providerIdSchema, apiKey: z.string() }).readonly(),
  'secrets.history': z
    .strictObject({
      provider: providerIdSchema.exactOptional(),
      limit: z.number().int().min(1).max(50).exactOptional(),
    })
    .readonly(),
  'models.list': empty,
  'chat.listConversations': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'chat.createConversation': z
    .strictObject({ projectId: projectIdSchema, title: z.string().exactOptional() })
    .readonly(),
  'chat.getMessages': z.strictObject({ conversationId: conversationIdSchema }).readonly(),
  'chat.setRagEnabled': z.strictObject({ conversationId: conversationIdSchema, enabled: z.boolean() }).readonly(),
  'chat.send': z
    .strictObject({
      conversationId: conversationIdSchema,
      text: z.string(),
      modelOverride: modelKeySchema.exactOptional(),
    })
    .readonly(),
  'chat.cancel': z.strictObject({ requestId: llmRequestIdSchema }).readonly(),
  'images.list': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'images.delete': z.strictObject({ assetId: imageAssetIdSchema }).readonly(),
  'router.getConfig': empty,
  'router.updateConfig': z.strictObject({ config: routerConfigSchema }).readonly(),
  'router.resolveFallback': fallbackDecisionSchema,
  'ledger.query': ledgerQuerySchema,
  'ledger.queryRows': ledgerQuerySchema,
  'pnl.get': z.strictObject({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema }).readonly(),
  'pnl.getAll': z.strictObject({ from: isoDateTimeSchema, to: isoDateTimeSchema }).readonly(),
  'revenue.list': z
    .strictObject({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema })
    .readonly(),
  'revenue.listRows': z
    .strictObject({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema })
    .readonly(),
  'revenue.add': z
    .strictObject({
      projectId: projectIdSchema,
      amount: z.number().positive(),
      currency: z.enum(['USD', 'VND']),
      description: z.string().trim().max(500),
    })
    .readonly(),
  'budget.set': budgetSchema,
  'budget.setUsd': z
    .strictObject({
      projectId: projectIdSchema,
      period: z.enum(['daily', 'monthly', 'project_lifetime']),
      limitUsd: z.string(),
      warnAt: z.array(z.number()).readonly(),
    })
    .readonly(),
  'budget.status': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'pricing.get': empty,
  'pricing.getRows': empty,
  'pricing.refresh': empty,
  'pricing.override': z.strictObject({ entry: priceEntrySchema }).readonly(),
  'pricing.clearOverride': z.strictObject({ modelKey: modelKeySchema }).readonly(),
  'pricing.overrideUsd': z
    .strictObject({
      modelKey: modelKeySchema,
      inputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
      outputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
      cachedInputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
    })
    .readonly(),
  'fx.get': empty,
  'fx.override': z.strictObject({ usdToVnd: z.number().nullable() }).readonly(),
  'rag.ingest': z
    .strictObject({
      projectId: projectIdSchema,
      paths: z.array(z.string()).readonly(),
      tags: z.array(z.string()).readonly().exactOptional(),
    })
    .readonly(),
  'rag.listDocuments': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'rag.deleteDocument': z.strictObject({ documentId: documentIdSchema }).readonly(),
  'rag.query': retrievalQuerySchema,
  'pipeline.start': z.strictObject({ projectId: projectIdSchema, prompt: z.string() }).readonly(),
  'pipeline.get': z.strictObject({ runId: pipelineRunIdSchema }).readonly(),
  'pipeline.list': z.strictObject({ projectId: projectIdSchema, limit: z.number() }).readonly(),
  'pipeline.cancel': z.strictObject({ runId: pipelineRunIdSchema }).readonly(),
  'pipeline.answerClarifications': z
    .strictObject({
      runId: pipelineRunIdSchema,
      answers: z
        .array(
          z
            .strictObject({
              questionId: z.string(),
              optionId: z.string().exactOptional(),
              freeText: z.string().max(2000).exactOptional(),
            })
            .readonly(),
        )
        .max(5)
        .readonly(),
    })
    .readonly(),
  'workflow.graph': z.strictObject({ projectId: projectIdSchema.nullable() }).readonly(),
  'workflow.activity': z
    .strictObject({
      projectId: projectIdSchema.nullable(),
      moduleId: workflowModuleIdSchema.exactOptional(),
      limit: z.number().int().min(1).max(200),
      before: isoDateTimeSchema.exactOptional(),
    })
    .readonly(),
  'workspace.openInVSCode': z.strictObject({ projectId: projectIdSchema }).readonly(),
  'vscode.closeForProject': z
    .strictObject({ projectId: projectIdSchema, reason: z.enum(['project_closed', 'project_deleted']) })
    .readonly(),
} satisfies { [M in RpcMethod]: z.ZodType<RpcMethodMap[M]['params']> };
export const rpcRequestEnvelopeSchema = z
  .object({ jsonrpc: z.literal('2.0'), id: z.number().int().nonnegative(), method: z.string() })
  .readonly();
export const rpcNotificationEnvelopeSchema = z
  .object({ jsonrpc: z.literal('2.0'), method: z.string(), params: z.unknown() })
  .readonly();
export const rpcErrorSchema = z
  .object({ code: z.number(), message: z.string(), data: appErrorSchema })
  .readonly() satisfies z.ZodType<RpcError>;
export const rpcResponseEnvelopeSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.number().int().nonnegative(),
    result: z.unknown().exactOptional(),
    error: rpcErrorSchema.exactOptional(),
  })
  .readonly();
export const rpcNotificationParamsSchemas = {
  'orch.event': orchEventSchema,
  'process.event': processEventSchema,
  'system.ready': z.object({ version: z.string(), recoveredTransactions: z.number() }).readonly(),
  'chat.delta': z.object({ requestId: llmRequestIdSchema, textDelta: z.string() }).readonly(),
  'chat.completed': z
    .object({ requestId: llmRequestIdSchema, message: chatMessageSchema, cost: moneyDisplaySchema })
    .readonly(),
  'chat.failed': z.object({ requestId: llmRequestIdSchema, error: appErrorSchema }).readonly(),
  'router.event': routerEventSchema,
  'router.fallbackRequired': fallbackDecisionRequestSchema,
  'ledger.entry': z.object({ entry: ledgerEntrySchema, cost: moneyDisplaySchema }).readonly(),
  'budget.alert': budgetStatusSchema,
  'pricing.updated': priceUpdateRunSchema,
  'rag.progress': ingestJobSchema,
  'pipeline.event': pipelineEventSchema,
  'pipeline.failureReport': failureReportSchema,
  'vscode.status': vscodeStatusSchema,
  'vscode.diagnostics': z
    .object({ projectId: projectIdSchema, diagnostics: z.array(diagnosticSchema).readonly() })
    .readonly(),
  'workflow.activity': z.array(activityEventSchema).readonly(),
} satisfies { [N in RpcNotificationName]: z.ZodType<RpcNotificationMap[N]> };

export const rpcResultSchemas = {
  'orch.plan': orchRunSchema,
  'orch.start': orchRunSchema,
  'orch.cancel': orchRunSchema,
  'orch.resume': orchRunSchema,
  'orch.approve': orchRunSchema,
  'orch.discard': orchRunSchema,
  'orch.get': orchRunSchema,
  'orch.list': z.array(orchRunSchema).readonly(),
  'orch.attempts': z.array(orchAttemptSchema).readonly(),
  'orch.adapters': z
    .array(
      z
        .strictObject({
          transport: z.enum(['api', 'claude-cli', 'codex-cli', 'mock']),
          status: z.enum(['available', 'unavailable', 'unsupported']),
          version: z.string().exactOptional(),
          reason: z.string().exactOptional(),
        })
        .readonly(),
    )
    .readonly(),
  'process.list': z.array(processRecordSchema).readonly(),
  'process.get': processRecordSchema,
  'process.cancel': processRecordSchema,
  'process.retry': processRecordSchema,
  'process.dismiss': processRecordSchema,
  'process.delete': z.strictObject({ deleted: z.boolean() }).readonly(),
  'process.report': processRecordSchema,
  'system.ping': z.object({ version: z.string(), uptimeMs: z.number() }).readonly(),
  'system.shutdown': z.object({ accepted: z.literal(true) }).readonly(),
  'project.list': z.array(projectSchema).readonly(),
  'project.create': projectSchema,
  'project.setActive': projectSchema,
  'project.delete': z.strictObject({ deleted: z.boolean() }).readonly(),
  'settings.get': appSettingsSchema,
  'settings.update': appSettingsSchema,
  'webchat.browsers': z
    .array(
      z
        .object({
          browser: z.enum(['default', 'coccoc', 'chrome', 'edge', 'firefox', 'custom']),
          installed: z.boolean(),
          path: z.string().nullable(),
        })
        .readonly(),
    )
    .readonly(),
  'webchat.open': z
    .object({
      opened: z.literal(true),
      browser: z.enum(['default', 'coccoc', 'chrome', 'edge', 'firefox', 'custom']),
    })
    .readonly(),
  'webchat.projectBrief': z.object({ text: z.string().max(4000) }).readonly(),
  'secrets.set': secretStatusSchema,
  'secrets.delete': secretStatusSchema,
  'secrets.status': z.array(secretStatusSchema).readonly(),
  'secrets.verify': secretStatusSchema,
  'secrets.verifyAndSave': secretStatusSchema,
  'secrets.history': z.array(secretHistoryEntrySchema).readonly(),
  'models.list': z.array(modelDescriptorSchema).readonly(),
  'chat.listConversations': z.array(conversationSchema).readonly(),
  'chat.createConversation': conversationSchema,
  'chat.getMessages': z.array(chatMessageSchema).readonly(),
  'chat.setRagEnabled': conversationSchema,
  'chat.send': z.object({ requestId: llmRequestIdSchema, userMessageId: messageIdSchema }).readonly(),
  'chat.cancel': z.object({ cancelled: z.boolean() }).readonly(),
  'images.list': z.array(imageAssetSchema).readonly(),
  'images.delete': z.object({ deleted: z.boolean() }).readonly(),
  'router.getConfig': routerConfigSchema,
  'router.updateConfig': routerConfigSchema,
  'router.resolveFallback': z.object({ accepted: z.boolean() }).readonly(),
  'ledger.query': pageSchema(ledgerEntrySchema),
  'ledger.queryRows': pageSchema(ledgerRowSchema),
  'pnl.get': projectPnLSchema,
  'pnl.getAll': portfolioPnLSchema,
  'revenue.list': z.array(revenueEntrySchema).readonly(),
  'revenue.listRows': z.array(revenueRowSchema).readonly(),
  'revenue.add': revenueEntrySchema,
  'budget.set': budgetStatusSchema,
  'budget.setUsd': budgetStatusSchema,
  'budget.status': z.array(budgetStatusSchema).readonly(),
  'pricing.get': priceTableSchema,
  'pricing.getRows': z
    .object({
      table: priceTableSchema,
      rows: z.array(priceRowSchema).readonly(),
      stale: z.boolean(),
      extraction: pricingExtractionOptionsSchema.exactOptional(),
    })
    .readonly(),
  'pricing.refresh': priceUpdateRunSchema,
  'pricing.override': priceTableSchema,
  'pricing.clearOverride': priceTableSchema,
  'pricing.overrideUsd': priceTableSchema,
  'fx.get': fxRateSchema,
  'fx.override': fxRateSchema,
  'rag.ingest': ingestJobSchema,
  'rag.listDocuments': z.array(sourceDocumentSchema).readonly(),
  'rag.deleteDocument': z.object({ deleted: z.boolean() }).readonly(),
  'rag.query': z.array(retrievalHitSchema).readonly(),
  'pipeline.start': pipelineRunSchema,
  'pipeline.get': pipelineRunSchema,
  'pipeline.list': z.array(pipelineRunSchema).readonly(),
  'pipeline.cancel': pipelineRunSchema,
  'pipeline.answerClarifications': pipelineRunSchema,
  'workflow.graph': workflowGraphSchema,
  'workflow.activity': z.array(activityEventSchema).readonly(),
  'workspace.openInVSCode': vscodeStatusSchema,
  'vscode.closeForProject': z.strictObject({ accepted: z.literal(true) }).readonly(),
} satisfies { [M in RpcMethod]: z.ZodType<RpcMethodMap[M]['result']> };
