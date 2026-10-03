import type { RpcError, RpcMethod, RpcMethodMap, RpcNotificationMap, RpcNotificationName } from '@itstudio/schemas';
import { z } from './common.js';
import { projectSchema } from './projects.js';
import { appSettingsSchema, settingsPatchSchema } from './settings.js';
import { secretStatusSchema, modelDescriptorSchema } from './models.js';
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
  fxRateSchema,
  moneyDisplaySchema,
  pageSchema,
  ledgerRowSchema,
  revenueRowSchema,
} from './cost.js';
import { retrievalQuerySchema, ingestJobSchema, sourceDocumentSchema, retrievalHitSchema } from './rag.js';
import { pipelineRunSchema, pipelineEventSchema, failureReportSchema } from './pipeline.js';
import { commandKindSchema, diagnosticSchema, commandRunSchema } from './worker.js';
import { vscodeStatusSchema } from './vscode.js';
import { appErrorSchema } from './errors.js';
import {
  projectIdSchema,
  conversationIdSchema,
  llmRequestIdSchema,
  pipelineRunIdSchema,
  documentIdSchema,
  workspaceRelativePathSchema,
  modelKeySchema,
  isoDateTimeSchema,
  providerIdSchema,
  messageIdSchema,
  sha256Schema,
} from './common.js';

const empty = z.object({}).readonly();
export const rpcParamsSchemas = {
  'system.ping': empty,
  'system.shutdown': empty,
  'project.list': empty,
  'project.create': z.object({ name: z.string(), workspaceRoot: z.string() }).readonly(),
  'project.setActive': z.object({ projectId: projectIdSchema }).readonly(),
  'settings.get': empty,
  'settings.update': z.object({ patch: settingsPatchSchema }).readonly(),
  'secrets.set': z.object({ provider: providerIdSchema, apiKey: z.string() }).readonly(),
  'secrets.delete': z.object({ provider: providerIdSchema }).readonly(),
  'secrets.status': empty,
  'secrets.verify': z.object({ provider: providerIdSchema }).readonly(),
  'models.list': empty,
  'chat.listConversations': z.object({ projectId: projectIdSchema }).readonly(),
  'chat.createConversation': z.object({ projectId: projectIdSchema, title: z.string().exactOptional() }).readonly(),
  'chat.getMessages': z.object({ conversationId: conversationIdSchema }).readonly(),
  'chat.setRagEnabled': z.object({ conversationId: conversationIdSchema, enabled: z.boolean() }).readonly(),
  'chat.send': z
    .object({ conversationId: conversationIdSchema, text: z.string(), modelOverride: modelKeySchema.exactOptional() })
    .readonly(),
  'chat.cancel': z.object({ requestId: llmRequestIdSchema }).readonly(),
  'router.getConfig': empty,
  'router.updateConfig': z.object({ config: routerConfigSchema }).readonly(),
  'router.resolveFallback': fallbackDecisionSchema,
  'ledger.query': ledgerQuerySchema,
  'ledger.queryRows': ledgerQuerySchema,
  'pnl.get': z.object({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema }).readonly(),
  'pnl.getAll': z.object({ from: isoDateTimeSchema, to: isoDateTimeSchema }).readonly(),
  'revenue.list': z.object({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema }).readonly(),
  'revenue.listRows': z
    .object({ projectId: projectIdSchema, from: isoDateTimeSchema, to: isoDateTimeSchema })
    .readonly(),
  'revenue.add': z
    .object({
      projectId: projectIdSchema,
      amount: z.number().positive(),
      currency: z.enum(['USD', 'VND']),
      description: z.string().trim().max(500),
    })
    .readonly(),
  'budget.set': budgetSchema,
  'budget.setUsd': z
    .object({
      projectId: projectIdSchema,
      period: z.enum(['daily', 'monthly', 'project_lifetime']),
      limitUsd: z.string(),
      warnAt: z.array(z.number()).readonly(),
    })
    .readonly(),
  'budget.status': z.object({ projectId: projectIdSchema }).readonly(),
  'pricing.get': empty,
  'pricing.getRows': empty,
  'pricing.refresh': empty,
  'pricing.override': z.object({ entry: priceEntrySchema }).readonly(),
  'pricing.clearOverride': z.object({ modelKey: modelKeySchema }).readonly(),
  'pricing.overrideUsd': z
    .object({
      modelKey: modelKeySchema,
      inputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
      outputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
      cachedInputPerMTokUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
    })
    .readonly(),
  'fx.get': empty,
  'fx.override': z.object({ usdToVnd: z.number().nullable() }).readonly(),
  'rag.ingest': z
    .object({
      projectId: projectIdSchema,
      paths: z.array(z.string()).readonly(),
      tags: z.array(z.string()).readonly().exactOptional(),
    })
    .readonly(),
  'rag.listDocuments': z.object({ projectId: projectIdSchema }).readonly(),
  'rag.deleteDocument': z.object({ documentId: documentIdSchema }).readonly(),
  'rag.query': retrievalQuerySchema,
  'pipeline.start': z.object({ projectId: projectIdSchema, prompt: z.string() }).readonly(),
  'pipeline.get': z.object({ runId: pipelineRunIdSchema }).readonly(),
  'pipeline.list': z.object({ projectId: projectIdSchema, limit: z.number() }).readonly(),
  'pipeline.cancel': z.object({ runId: pipelineRunIdSchema }).readonly(),
  'workspace.openInVSCode': z.object({ projectId: projectIdSchema }).readonly(),
  'workspace.readFile': z.object({ projectId: projectIdSchema, path: workspaceRelativePathSchema }).readonly(),
  'workspace.runCommand': z.object({ projectId: projectIdSchema, kind: commandKindSchema }).readonly(),
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
} satisfies { [N in RpcNotificationName]: z.ZodType<RpcNotificationMap[N]> };

export const rpcResultSchemas = {
  'system.ping': z.object({ version: z.string(), uptimeMs: z.number() }).readonly(),
  'system.shutdown': z.object({ accepted: z.literal(true) }).readonly(),
  'project.list': z.array(projectSchema).readonly(),
  'project.create': projectSchema,
  'project.setActive': projectSchema,
  'settings.get': appSettingsSchema,
  'settings.update': appSettingsSchema,
  'secrets.set': secretStatusSchema,
  'secrets.delete': secretStatusSchema,
  'secrets.status': z.array(secretStatusSchema).readonly(),
  'secrets.verify': secretStatusSchema,
  'models.list': z.array(modelDescriptorSchema).readonly(),
  'chat.listConversations': z.array(conversationSchema).readonly(),
  'chat.createConversation': conversationSchema,
  'chat.getMessages': z.array(chatMessageSchema).readonly(),
  'chat.setRagEnabled': conversationSchema,
  'chat.send': z.object({ requestId: llmRequestIdSchema, userMessageId: messageIdSchema }).readonly(),
  'chat.cancel': z.object({ cancelled: z.boolean() }).readonly(),
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
    .object({ table: priceTableSchema, rows: z.array(priceRowSchema).readonly(), stale: z.boolean() })
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
  'workspace.openInVSCode': vscodeStatusSchema,
  'workspace.readFile': z.object({ content: z.string(), hash: sha256Schema }).readonly(),
  'workspace.runCommand': commandRunSchema,
} satisfies { [M in RpcMethod]: z.ZodType<RpcMethodMap[M]['result']> };
