import {
  ErrorCode,
  ModelCapability,
  type AppError,
  type CoderOutput,
  type LlmRequest,
  type ModelKey,
  type PipelineRunId,
  type ProjectId,
  type Result,
  type ReviewVerdict,
  type TaskSpec,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { contextBlock, renderTemplate } from '../domain/template.js';
import { systemIdGenerator, type IIdGenerator } from '../infra/id.js';
import { CODER_ROLE_PROMPT } from '../prompts/coder.js';
import { PM_ROLE_PROMPT } from '../prompts/pm.js';
import { REVIEWER_ROLE_PROMPT } from '../prompts/reviewer.js';
import type { LlmRouter } from './llm-router.js';
import { coderOutputSchema, reviewVerdictSchema, taskSpecSchema, toJsonSchema } from '../validation/pipeline.js';
import { conversationIdSchema, isoDateTimeSchema, llmRequestIdSchema, messageIdSchema } from '../validation/brand.js';

export type Role = 'pm' | 'coder' | 'reviewer';

export type RoleInputs =
  | { readonly prompt: string; readonly ragHits: string; readonly tree: string; readonly conventionsSummary: string }
  | {
      readonly spec: TaskSpec;
      readonly filesWithHashes: string;
      readonly fixRound: boolean;
      readonly findings?: string;
    }
  | { readonly spec: TaskSpec; readonly coderOutput: CoderOutput; readonly diff: string };

export interface RoleCallOptions {
  readonly projectId: ProjectId;
  readonly pipelineRunId: PipelineRunId;
  readonly ladder: readonly ModelKey[];
}

export interface RoleCallerDependencies {
  readonly router: Pick<LlmRouter, 'dispatch'>;
  readonly logger: Logger;
  readonly ids?: IIdGenerator;
  readonly now?: () => Date;
}

type RoleOutput = TaskSpec | CoderOutput | ReviewVerdict;

function promptFor(role: Role, inputs: RoleInputs): string {
  if (role === 'pm' && 'prompt' in inputs) {
    return renderTemplate(PM_ROLE_PROMPT, {
      taskSpecJsonSchema: JSON.stringify(toJsonSchema(taskSpecSchema)),
      tree: inputs.tree,
      ragHits: inputs.ragHits,
      conventionsSummary: inputs.conventionsSummary,
      prompt: inputs.prompt,
    });
  }
  if (role === 'coder' && 'filesWithHashes' in inputs) {
    return renderTemplate(CODER_ROLE_PROMPT, {
      coderOutputJsonSchema: JSON.stringify(toJsonSchema(coderOutputSchema)),
      fixRound: inputs.fixRound,
      findings: inputs.findings ?? '',
      spec: JSON.stringify(inputs.spec),
      filesWithHashes: inputs.filesWithHashes,
    });
  }
  if (role !== 'reviewer' || !('coderOutput' in inputs)) throw new Error('Role inputs do not match the requested role');
  return renderTemplate(REVIEWER_ROLE_PROMPT, {
    reviewVerdictJsonSchema: JSON.stringify(toJsonSchema(reviewVerdictSchema)),
    spec: JSON.stringify(inputs.spec),
    coderOutput: JSON.stringify(inputs.coderOutput),
    diff: inputs.diff,
  });
}

function getSchema(role: Role) {
  if (role === 'pm') return taskSpecSchema;
  if (role === 'coder') return coderOutputSchema;
  return reviewVerdictSchema;
}

function extractJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          const parsed: unknown = JSON.parse(candidate);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return candidate;
        } catch {
          start = -1;
        }
      }
    }
  }
  return undefined;
}

function parseJson(text: string): unknown {
  const object = extractJsonObject(text);
  if (object === undefined) throw new Error('No JSON object was found');
  const parsed: unknown = JSON.parse(object);
  return parsed;
}

function reviewerOverride(value: unknown): { readonly value: unknown; readonly overridden: boolean } {
  if (typeof value !== 'object' || value === null || !('approved' in value) || !('findings' in value))
    return { value, overridden: false };
  const verdict = value;
  if (
    verdict.approved !== true ||
    !Array.isArray(verdict.findings) ||
    !verdict.findings.some(
      (finding: unknown) =>
        typeof finding === 'object' &&
        finding !== null &&
        'severity' in finding &&
        (finding.severity === 'blocker' || finding.severity === 'major'),
    )
  )
    return { value, overridden: false };
  return { value: { ...value, approved: false }, overridden: true };
}

function validationSummary(error: {
  readonly issues: readonly { readonly path: PropertyKey[]; readonly message: string }[];
}): string {
  const summary = error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return summary.slice(0, 2_000);
}

function validationFailure(): Result<never> {
  const error: AppError = {
    code: ErrorCode.VALIDATION,
    message: 'The role returned an invalid response after one retry.',
    remediation: ['Retry the pipeline. If the error continues, choose a different model or review the role prompt.'],
    retryable: false,
  };
  return { ok: false, error };
}

export class RoleCaller {
  private readonly deps: RoleCallerDependencies;

  constructor(dependencies: RoleCallerDependencies) {
    this.deps = dependencies;
  }

  async call(role: Role, inputs: RoleInputs, options: RoleCallOptions): Promise<Result<RoleOutput>> {
    let prompt: string;
    try {
      prompt = promptFor(role, inputs);
    } catch {
      return validationFailure();
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ids = this.deps.ids ?? systemIdGenerator;
      const request: LlmRequest = {
        id: llmRequestIdSchema.parse(ids.uuid()),
        projectId: options.projectId,
        purpose: `pipeline_${role}`,
        messages: [
          {
            id: messageIdSchema.parse(ids.uuid()),
            conversationId: conversationIdSchema.parse(ids.uuid()),
            role: 'user',
            parts: [{ type: 'text', text: 'Return the requested JSON object.' }],
            createdAt: isoDateTimeSchema.parse((this.deps.now?.() ?? new Date()).toISOString()),
          },
        ],
        systemPrompt: prompt,
        requiredCapabilities: [ModelCapability.CHAT],
        responseFormat: 'json',
        ladderOverride: options.ladder,
        stream: false,
      };
      const response = await this.deps.router.dispatch(request);
      if (!response.ok) return response;
      const text = response.value.message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      try {
        const untrusted: unknown = parseJson(text);
        const normalized = role === 'reviewer' ? reviewerOverride(untrusted) : { value: untrusted, overridden: false };
        if (normalized.overridden) {
          this.deps.logger.warn(
            { projectId: options.projectId, pipelineRunId: options.pipelineRunId },
            'Forcing reviewer verdict to rejected because it contains blocking findings',
          );
        }
        const validated = getSchema(role).safeParse(normalized.value);
        if (validated.success) return { ok: true, value: validated.data };
        throw validated.error;
      } catch (error) {
        if (attempt === 0) {
          const issues = error instanceof ZodError ? validationSummary(error) : 'The response was not valid JSON.';
          prompt = `${prompt}\n\n${contextBlock('validation_error', issues)}`;
          continue;
        }
        return validationFailure();
      }
    }
    return validationFailure();
  }
}
