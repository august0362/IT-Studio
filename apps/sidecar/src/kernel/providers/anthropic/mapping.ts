import type { ContentBlockParam, Message, MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { ToolName, type ContentPart, type ToolParameterSchema } from '@itstudio/schemas';
import type { ProviderMessage, ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';
import { toolCallSchema } from '../../validation/chat.js';
import { jsonObjectSchema } from '../../validation/common.js';

export function mapRequest(req: ProviderRequest): {
  readonly system: string | undefined;
  readonly messages: MessageParam[];
  readonly tools: Tool[] | undefined;
} {
  const system = [req.system, ...(req.responseFormat === 'json' ? ['Respond with a single JSON object only.'] : [])]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n');
  return {
    system: system || undefined,
    messages: req.messages.map(mapMessage),
    tools: req.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([name, schema]) => [name, mutableSchema(schema)]),
        ),
        required: [...tool.parameters.required],
      },
    })),
  };
}

function mutableSchema(schema: ToolParameterSchema): Record<string, unknown> {
  if (schema.type === 'object') {
    return {
      type: schema.type,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([name, child]) => [name, mutableSchema(child)]),
      ),
      required: [...schema.required],
    };
  }
  if (schema.type === 'array') {
    return {
      type: schema.type,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      items: mutableSchema(schema.items),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    };
  }
  if (schema.type === 'string') {
    return { ...schema, ...(schema.enum === undefined ? {} : { enum: [...schema.enum] }) };
  }
  return { ...schema };
}

function mapMessage(message: ProviderMessage): MessageParam {
  const content = message.parts.flatMap(mapPart);
  if (message.role === 'assistant') return { role: 'assistant', content };
  return { role: 'user', content };
}

function mapPart(part: ContentPart): ContentBlockParam[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }];
    case 'tool_call':
      return [{ type: 'tool_use', id: part.call.id, name: part.call.name, input: part.call.arguments }];
    case 'tool_result':
      return [
        {
          type: 'tool_result',
          tool_use_id: part.result.callId,
          content: typeof part.result.content === 'string' ? part.result.content : JSON.stringify(part.result.content),
          is_error: part.result.isError,
        },
      ];
    case 'citation':
      return [{ type: 'text', text: `[${part.hit.documentTitle}] ${part.hit.text}` }];
    case 'image':
      throw new ImageUnsupportedError();
  }
}

export class ImageUnsupportedError extends Error {
  constructor() {
    super('Image parts are not supported by the Anthropic adapter.');
    this.name = 'ImageUnsupportedError';
  }
}

export function mapResponse(message: Message): ProviderResponse {
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const toolCalls = message.content.flatMap((block) => {
    if (
      block.type !== 'tool_use' ||
      (block.name !== ToolName.SEARCH_KNOWLEDGE && block.name !== ToolName.GENERATE_IMAGE)
    )
      return [];
    const input = jsonObjectSchema.safeParse(block.input);
    if (!input.success) return [];
    const call = toolCallSchema.safeParse({ id: block.id, name: block.name, arguments: input.data });
    return call.success ? [call.data] : [];
  });
  const cachedInputTokens = message.usage.cache_read_input_tokens ?? 0;
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: message.usage.input_tokens + cachedInputTokens + (message.usage.cache_creation_input_tokens ?? 0),
      cachedInputTokens,
      outputTokens: message.usage.output_tokens,
    },
    finishReason: finishReason(message.stop_reason),
    providerModelId: message.model,
  };
}

export function finishReason(stopReason: string | null): ProviderResponse['finishReason'] {
  switch (stopReason) {
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    case 'end_turn':
    case 'stop_sequence':
    case null:
    default:
      return 'stop';
  }
}
