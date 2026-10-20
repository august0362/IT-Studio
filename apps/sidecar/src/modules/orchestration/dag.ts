import { z } from 'zod';
import type { OrchTaskSpec, Result } from '@itstudio/schemas';
import { isSafeGlob } from './glob.js';
import { pathSetsOverlap } from './path-locks.js';

export interface PlanValidationOptions {
  readonly workspaceRoot: string;
  readonly allowedCommands: readonly { readonly executable: string; readonly args: readonly string[] }[];
}
const commandSchema = z
  .object({
    kind: z.enum(['install', 'typecheck', 'lint', 'test', 'build']),
    executable: z.string().min(1),
    args: z.array(z.string()),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
const taskSchema = z
  .object({
    id: z.string().regex(/^T(?:[1-9]|1\d|20)$/u),
    title: z.string().min(1),
    objective: z.string().min(1),
    dependsOn: z.array(z.string()),
    role: z.literal('worker'),
    candidateAgents: z.array(z.string().min(1)).min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    testCommands: z.array(commandSchema),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    estimate: z.enum(['S', 'M', 'L']),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export const supervisorPlanSchema = z.object({ tasks: z.array(taskSchema).min(1).max(20) }).strict();
export function validatePlan(input: unknown, options: PlanValidationOptions): Result<readonly OrchTaskSpec[]> {
  const errors: string[] = [];
  const parsed = supervisorPlanSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: 'PLAN_INVALID',
        message: 'PLAN_INVALID',
        retryable: false,
        details: { errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
      },
    };
  const tasks = parsed.data.tasks;
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) errors.push('Task ids must be unique.');
  for (const task of tasks) {
    for (const dep of task.dependsOn) if (!ids.has(dep)) errors.push(`${task.id} depends on unknown task ${dep}.`);
    for (const path of task.allowedPaths) {
      if (
        path.startsWith('/') ||
        /^[A-Za-z]:/u.test(path) ||
        path.split(/[\\/]/u).includes('..') ||
        path.split(/[\\/]/u).some((part) => ['.git', 'node_modules', '.itstudio'].includes(part.toLowerCase())) ||
        path.includes('\\') ||
        !isSafeGlob(path)
      )
        errors.push(`${task.id} has unsafe workspace path ${path}.`);
    }
    for (const command of task.testCommands)
      if (
        !options.allowedCommands.some(
          (allowed) =>
            allowed.executable === command.executable && JSON.stringify(allowed.args) === JSON.stringify(command.args),
        )
      )
        errors.push(`${task.id} has a command outside the project allow-list.`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const task = tasks.find((item) => item.id === id);
    for (const dep of task?.dependsOn ?? []) if (ids.has(dep) && !visit(dep)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of ids)
    if (!visit(id)) {
      errors.push('Task dependencies must be acyclic.');
      break;
    }
  if (errors.length > 0)
    return {
      ok: false,
      error: { code: 'PLAN_INVALID', message: 'Plan validation failed.', retryable: false, details: { errors } },
    };
  return { ok: true, value: tasks as unknown as readonly OrchTaskSpec[] };
}
export function topologicalOrder(tasks: readonly OrchTaskSpec[]): readonly OrchTaskSpec[] {
  const remaining = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const result: OrchTaskSpec[] = [];
  while (remaining.size > 0) {
    const next = [...remaining.values()]
      .filter((task) => task.dependsOn.every((dep) => done.has(dep)))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (next === undefined) return [];
    remaining.delete(next.id);
    done.add(next.id);
    result.push(next);
  }
  return result;
}
export function criticalPathLengths(tasks: readonly OrchTaskSpec[]): ReadonlyMap<string, number> {
  const memo = new Map<string, number>();
  const find = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const downstream = tasks.filter((task) => task.dependsOn.includes(id as OrchTaskSpec['id']));
    const length = 1 + Math.max(0, ...downstream.map((task) => find(task.id)));
    memo.set(id, length);
    return length;
  };
  for (const task of tasks) find(task.id);
  return memo;
}
export function allowedPathOverlap(a: OrchTaskSpec, b: OrchTaskSpec): boolean {
  return pathSetsOverlap(a.allowedPaths, b.allowedPaths);
}
