import type { Project } from '@itstudio/schemas';
import { isoDateTimeSchema, projectIdSchema, z } from './common.js';
export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string(),
    workspaceRoot: z.string(),
    createdAt: isoDateTimeSchema,
    archived: z.boolean(),
  })
  .readonly() satisfies z.ZodType<Project>;
