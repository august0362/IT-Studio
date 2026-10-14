import { WorkflowModuleId, type ActivityKind, type ProjectId } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import {
  commandRunIdSchema,
  llmRequestIdSchema,
  projectIdSchema,
  workspaceRelativePathSchema,
} from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { mapWorkflowEvent, mapWorkflowInternalEvent } from './activity-recorder.js';
import type { WorkflowInternalEvent } from './workflow-internal-events.js';

const projectId: ProjectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');

describe('Workflow QA mappings', () => {
  it('TC-MW-006 maps each internal source family to its public module, edge, and kind', () => {
    const commandRunId = commandRunIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const cases: readonly {
      readonly source: WorkflowInternalEvent;
      readonly moduleId: WorkflowModuleId;
      readonly edgeId: string;
      readonly kind: ActivityKind;
    }[] = [
      {
        source: { type: 'retriever', phase: 'started', projectId },
        moduleId: WorkflowModuleId.RETRIEVER,
        edgeId: 'query-retriever',
        kind: 'started',
      },
      {
        source: {
          type: 'command',
          phase: 'finished',
          projectId,
          commandRunId,
          executable: 'npm',
          argCount: 2,
          exitCode: 0,
          timedOut: false,
          durationMs: 42,
        },
        moduleId: WorkflowModuleId.COMMAND_RUNNER,
        edgeId: 'worker-commands',
        kind: 'completed',
      },
      {
        source: {
          type: 'vscode',
          phase: 'sent',
          projectId,
          action: 'show_diff',
          path: workspaceRelativePathSchema.parse('src/example.ts'),
        },
        moduleId: WorkflowModuleId.VSCODE_BRIDGE,
        edgeId: 'worker-vscode',
        kind: 'started',
      },
      {
        source: { type: 'image', phase: 'failed', projectId, provider: 'openai_dalle3', count: 1 },
        moduleId: WorkflowModuleId.CHAT,
        edgeId: 'chat-router',
        kind: 'failed',
      },
      {
        source: {
          type: 'embedding',
          projectId,
          modelKey: modelKeySchema.parse('openai/text-embedding-3-small'),
          chunkCount: 3,
          cost: 8,
        },
        moduleId: WorkflowModuleId.EMBEDDINGS,
        edgeId: 'embeddings-ledger',
        kind: 'completed',
      },
    ];

    for (const { source, moduleId, edgeId, kind } of cases) {
      expect(mapWorkflowInternalEvent(source)).toMatchObject({ moduleId, edgeId, kind });
    }
  });

  it('TC-MW-006 excludes prompt, retrieval query, and secret command args from summaries', () => {
    const privateText = 'private customer query that must not be recorded';
    const secretArgument = '--token=private-workflow-secret';
    const publicEvent = mapWorkflowEvent(
      {
        name: 'chat.delta',
        payload: {
          requestId: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000003'),
          textDelta: privateText,
        },
      },
      projectId,
    );
    const retrievalSource = Object.assign(
      { type: 'retriever' as const, phase: 'completed' as const, projectId, hitCount: 1, topScore: 0.81 },
      { query: privateText },
    );
    const commandSource = Object.assign(
      {
        type: 'command' as const,
        phase: 'finished' as const,
        projectId,
        commandRunId: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000004'),
        executable: 'npm',
        argCount: 2,
        exitCode: 0,
        timedOut: false,
      },
      { args: ['run', secretArgument] },
    );
    const summaries = [
      publicEvent.summary,
      mapWorkflowInternalEvent(retrievalSource).summary,
      mapWorkflowInternalEvent(commandSource).summary,
    ];

    for (const summary of summaries) {
      expect(summary).not.toContain(privateText);
      expect(summary).not.toContain(secretArgument);
    }
  });
});
