import { describe, expect, it } from 'vitest';
import type { AgentEnvelope } from '../../kernel/ports/agent-execution.js';
import { agentAcknowledgement, agentPromptKind, buildAgentPrompt, extractJsonObjects } from './prompts.js';

const envelope: AgentEnvelope = {
  schemaVersion: '1',
  agentId: 'w',
  roleId: 'worker',
  roleVersion: '1',
  modelId: 'mock',
  providerId: 'mock',
  transportId: 'claude-cli',
  projectId: 'p',
  orchestrationRunId: 'r',
  taskId: 'T1',
  attemptId: 'a1',
  assignedWorktree: null,
  allowedPaths: ['src/**'],
  approvedTools: [],
  forbiddenActions: [],
  objective: 'Add a helper',
  requirements: [],
  acceptanceCriteria: ['helper exists'],
  reportingSchema: {},
  budgetPolicy: {},
  timeoutMs: 1000,
  contextReferences: [],
};

describe('orchestration prompts', () => {
  it('extracts JSON objects from prose, fences and pretty-printed output', () => {
    const text = [
      'Sure, here it is:',
      '```json',
      '{"ack": true, "note": "braces } in { strings"}',
      '```',
      'and {not json} then',
      '{',
      '  "summary": "done",',
      '  "operations": [{"kind": "create", "path": "src/a.ts", "content": "x"}]',
      '}',
    ].join('\n');
    expect(extractJsonObjects(text)).toEqual([
      { ack: true, note: 'braces } in { strings' },
      { summary: 'done', operations: [{ kind: 'create', path: 'src/a.ts', content: 'x' }] },
    ]);
    expect(extractJsonObjects('no json here')).toEqual([]);
    expect(extractJsonObjects('{"unterminated": ')).toEqual([]);
  });

  it('picks the payload kind from role and input', () => {
    expect(agentPromptKind({ roleId: 'supervisor' }, { kind: 'plan' })).toBe('plan');
    expect(agentPromptKind({ roleId: 'supervisor' }, { kind: 'final-review' })).toBe('supervisor-report');
    expect(agentPromptKind({ roleId: 'worker' }, {})).toBe('worker');
    expect(agentPromptKind({ roleId: 'reviewer' }, { kind: 'integration-conflict' })).toBe('reviewer');
  });

  it('includes the exact acknowledgement only for CLI agents and always the payload schema', () => {
    const cli = buildAgentPrompt(envelope, { task: { id: 'T1' } }, { withAck: true });
    expect(cli).toContain(JSON.stringify(agentAcknowledgement(envelope)));
    expect(cli).toContain('Payload schema:');
    expect(cli).toContain('"operations"');
    expect(cli).toContain('<context name="input">{"task":{"id":"T1"}}</context>');
    const api = buildAgentPrompt(envelope, {}, { withAck: false });
    expect(api).not.toContain('Acknowledgement:');
    expect(api).toContain('exactly one JSON object');
    const plan = buildAgentPrompt({ ...envelope, roleId: 'supervisor' }, { kind: 'plan' }, { withAck: false });
    expect(plan).toContain('"candidateAgents"');
  });
});
