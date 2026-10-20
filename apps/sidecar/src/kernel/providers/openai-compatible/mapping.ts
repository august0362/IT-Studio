import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { type ContentPart, type ToolCall, type ToolParameterSchema } from '@itstudio/schemas';
import type { ProviderMessage, ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';
import { toolCallSchema } from '../../validation/chat.js';
import { jsonObjectSchema } from '../../validation/common.js';

export function mapMessages(req: ProviderRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (req.system !== undefined && req.system.length > 0) messages.push({ role: 'system', content: req.system });
  for (const message of req.messages) messages.push(mapMessage(message));
  return messages;
}

function mapMessage(message: ProviderMessage): ChatCompletionMessageParam {
  if (message.role === 'assistant') {
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
    const calls = message.parts.flatMap((part) => (part.type === 'tool_call' ? [part.call] : []));
    return {
      role: 'assistant',
      content: text || null,
      ...(calls.length === 0
        ? {}
        : {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }),
    };
  }
  if (message.role === 'tool') {
    const results = message.parts.flatMap((part) => (part.type === 'tool_result' ? [part.result] : []));
    return {
      role: 'tool',
      tool_call_id: results[0]?.callId ?? '',
      content: results.map((result) => JSON.stringify(result.content)).join('\n'),
    };
  }
  return { role: 'user', content: message.parts.flatMap(mapUserPart).join('\n') };
}

function mapUserPart(part: ContentPart): string[] {
  switch (part.type) {
    case 'text':
      return [part.text];
    case 'citation':
      return [`[${part.hit.documentTitle}] ${part.hit.text}`];
    case 'tool_result':
      return [JSON.stringify(part.result.content)];
    case 'tool_call':
      return [];
    case 'image':
      throw new UnsupportedImageError();
  }
}

export function mapTools(req: ProviderRequest) {
  return req.tools?.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: mutableSchema(tool.parameters),
    },
  }));
}

function mutableSchema(schema: ToolParameterSchema): Record<string, unknown> {
  if (schema.type === 'object')
    return {
      type: schema.type,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, mutableSchema(value)]),
      ),
      required: [...schema.required],
    };
  if (schema.type === 'array')
    return {
      type: schema.type,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      items: mutableSchema(schema.items),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    };
  if (schema.type === 'string') return { ...schema, ...(schema.enum === undefined ? {} : { enum: [...schema.enum] }) };
  return { ...schema };
}

export function mapResponse(completion: ChatCompletion): ProviderResponse | ProviderFailureResponse {
  const choice = completion.choices[0];
  if (choice === undefined) return { failure: true, message: 'The provider returned no completion choices.' };
  const parsed = parseToolCalls(
    (choice.message.tool_calls ?? [])
      .map((call) => ({
        id: call.id,
        name: call.type === 'function' ? call.function.name : '',
        arguments: call.type === 'function' ? call.function.arguments : '',
      }))
      .filter((call) => call.name.length > 0),
  );
  if (!parsed.ok) return { failure: true, message: parsed.message };
  const details = completion.usage?.prompt_tokens_details;
  const cachedInputTokens =
    details && 'cached_tokens' in details && typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
  return {
    text: choice.message.content ?? '',
    toolCalls: parsed.calls,
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      cachedInputTokens,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    finishReason: finishReason(choice.finish_reason),
    providerModelId: completion.model,
  };
}

export function mapChunkUsage(chunk: ChatCompletionChunk): ProviderResponse['usage'] | undefined {
  if (chunk.usage === null || chunk.usage === undefined) return undefined;
  return {
    inputTokens: chunk.usage.prompt_tokens,
    cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: chunk.usage.completion_tokens,
  };
}

export function parseToolCalls(
  rawCalls: readonly { readonly id: string; readonly name: string; readonly arguments: string }[],
): { readonly ok: true; readonly calls: readonly ToolCall[] } | { readonly ok: false; readonly message: string } {
  const calls: ToolCall[] = [];
  for (const call of rawCalls) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments) as unknown;
    } catch {
      return { ok: false, message: 'The provider returned invalid JSON tool arguments.' };
    }
    const args = jsonObjectSchema.safeParse(parsed);
    const candidate = toolCallSchema.safeParse({
      id: call.id,
      name: call.name,
      arguments: args.success ? args.data : parsed,
    });
    if (!candidate.success) return { ok: false, message: 'The provider returned invalid tool-call data.' };
    calls.push(candidate.data);
  }
  return { ok: true, calls };
}

export function finishReason(reason: string | null): ProviderResponse['finishReason'] {
  switch (reason) {
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    case 'stop':
    case null:
    default:
      return 'stop';
  }
}

export class UnsupportedImageError extends Error {
  constructor() {
    super('Image parts are not supported by the OpenAI-compatible adapter.');
  }
}

export interface ProviderFailureResponse {
  readonly failure: true;
  readonly message: string;
}
