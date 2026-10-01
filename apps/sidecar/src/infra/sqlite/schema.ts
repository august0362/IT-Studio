import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
