import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workspaceRoot: text('workspace_root').notNull().unique(),
  createdAt: text('created_at').notNull(),
  archived: integer('archived').notNull().default(0),
});

export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    json: text('json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('settings_singleton_id', sql`${table.id} = 1`)],
);

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  ragEnabled: integer('rag_enabled').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    partsJson: text('parts_json').notNull(),
    modelKey: text('model_key'),
    usageJson: text('usage_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt)],
);

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    occurredAt: text('occurred_at').notNull(),
    purpose: text('purpose').notNull(),
    modelKey: text('model_key').notNull(),
    llmRequestId: text('llm_request_id'),
    pipelineRunId: text('pipeline_run_id'),
    conversationId: text('conversation_id'),
    usageJson: text('usage_json').notNull(),
    imageCount: integer('image_count'),
    costMicroUsd: integer('cost_micro_usd').notNull(),
    priceTableVersion: text('price_table_version').notNull(),
    billedFailure: integer('billed_failure').notNull(),
  },
  (table) => [index('ledger_entries_project_occurred_idx').on(table.projectId, table.occurredAt)],
);

export const priceTables = sqliteTable('price_tables', {
  version: text('version').primaryKey(),
  effectiveFrom: text('effective_from').notNull(),
  origin: text('origin').notNull(),
  entriesJson: text('entries_json').notNull(),
});

export const fxRates = sqliteTable('fx_rates', {
  asOf: text('as_of').primaryKey(),
  usdToVnd: real('usd_to_vnd').notNull(),
});
