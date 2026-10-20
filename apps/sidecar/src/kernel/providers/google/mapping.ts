import { BlockedReason } from '@google/genai';
import type {
  Content,
  FunctionDeclaration,
  FunctionResponse,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
} from '@google/genai';
import { ToolName, type ContentPart, type ToolCall, type ToolParameterSchema } from '@itstudio/schemas';
import type { ProviderMessage, ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';
import { toolCallSchema } from '../../validation/chat.js';
import { jsonObjectSchema } from '../../validation/common.js';

export function mapRequest(req: ProviderRequest): {
  readonly contents: Content[];
  readonly systemInstruction: string | undefined;
  readonly tools: readonly { readonly functionDeclarations: FunctionDeclaration[] }[] | undefined;
  readonly responseMimeType: string | undefined;
} {
  const priorCalls = new Map<string, string>();
  const contents = req.messages.map((message) => {
    const content = mapMessage(message, priorCalls);
    for (const part of message.parts) {
      if (part.type === 'tool_call') priorCalls.set(part.call.id, part.call.name);
    }
    return content;
  });
  return {
    contents,
    systemInstruction: req.system,
    tools: req.tools === undefined ? undefined : [{ functionDeclarations: req.tools.map(mapTool) }],
    responseMimeType: req.responseFormat === 'json' ? 'application/json' : undefined,
  };
}

function mapMessage(message: ProviderMessage, priorCalls: ReadonlyMap<string, string>): Content {
  if (message.role === 'assistant') {
    return {
      role: 'model',
      parts: message.parts.flatMap<Part>((part): Part[] => {
        if (part.type === 'text') return [{ text: part.text }];
        if (part.type === 'tool_call')
          return [{ functionCall: { id: part.call.id, name: part.call.name, args: part.call.arguments } }];
        return [];
      }),
    };
  }
  if (message.role === 'tool') {
    return {
      role: 'user',
      parts: message.parts.flatMap((part) => {
        if (part.type !== 'tool_result') return [];
        const result = part.result;
        const response: Record<string, unknown> = result.isError
          ? { error: result.content }
          : { output: result.content };
        const functionResponse: FunctionResponse = {
          id: result.callId,
          name: priorCalls.get(result.callId) ?? result.callId,
          response,
        };
        return [{ functionResponse }];
      }),
    };
  }
  return { role: 'user', parts: message.parts.flatMap(mapUserPart) };
}

function mapUserPart(part: ContentPart): { text: string }[] {
  switch (part.type) {
    case 'text':
      return [{ text: part.text }];
    case 'citation':
      return [{ text: `[${part.hit.documentTitle}] ${part.hit.text}` }];
    case 'tool_result':
      return [{ text: JSON.stringify(part.result.content) }];
    case 'tool_call':
    case 'image':
      return [];
  }
}

function mapTool(tool: NonNullable<ProviderRequest['tools']>[number]): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: mutableSchema(tool.parameters),
  };
}

function mutableSchema(schema: ToolParameterSchema): Record<string, unknown> {
  if (schema.type === 'object')
    return {
      type: 'object',
      ...(schema.description === undefined ? {} : { description: schema.description }),
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, mutableSchema(value)]),
      ),
      required: [...schema.required],
    };
  if (schema.type === 'array')
    return {
      type: 'array',
      ...(schema.description === undefined ? {} : { description: schema.description }),
      items: mutableSchema(schema.items),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    };
  if (schema.type === 'string') return { ...schema, ...(schema.enum === undefined ? {} : { enum: [...schema.enum] }) };
  return { ...schema };
}

export function mapResponse(response: GenerateContentResponse, fallbackModelId = ''): ProviderResponse {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const toolCalls = parseToolCalls(
    parts.flatMap((part) => (part.functionCall === undefined ? [] : [part.functionCall])),
  );
  return {
    text: parts.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(''),
    toolCalls,
    usage: mapUsage(response.usageMetadata),
    finishReason: finishReason(candidate?.finishReason, toolCalls.length > 0),
    providerModelId: response.modelVersion ?? fallbackModelId,
  };
}

export function mapStreamResponse(
  chunks: readonly GenerateContentResponse[],
  fallbackModelId: string,
): ProviderResponse {
  const first = chunks[0];
  const last = chunks.at(-1);
  const candidate = last?.candidates?.[0];
  const parts = chunks.flatMap((chunk) => chunk.candidates?.[0]?.content?.parts ?? []);
  const calls = parseToolCalls(parts.flatMap((part) => (part.functionCall === undefined ? [] : [part.functionCall])));
  return {
    text: parts.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join(''),
    toolCalls: calls,
    usage: mapUsage(last?.usageMetadata ?? chunks.find((chunk) => chunk.usageMetadata !== undefined)?.usageMetadata),
    finishReason: finishReason(candidate?.finishReason, calls.length > 0),
    providerModelId: last?.modelVersion ?? first?.modelVersion ?? fallbackModelId,
  };
}

export function promptBlockReason(response: GenerateContentResponse): string | undefined {
  const reason = response.promptFeedback?.blockReason;
  return reason === undefined || reason === BlockedReason.BLOCKED_REASON_UNSPECIFIED ? undefined : reason;
}

export function mapUsage(usage: GenerateContentResponseUsageMetadata | undefined): ProviderResponse['usage'] {
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    cachedInputTokens: usage?.cachedContentTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}

export function parseToolCalls(
  rawCalls: readonly { readonly id?: string; readonly name?: string; readonly args?: unknown }[],
): ToolCall[] {
  const calls: ToolCall[] = [];
  rawCalls.forEach((call, index) => {
    if (call.name !== ToolName.GENERATE_IMAGE && call.name !== ToolName.SEARCH_KNOWLEDGE) return;
    const args = jsonObjectSchema.safeParse(call.args ?? {});
    if (!args.success) return;
    const parsed = toolCallSchema.safeParse({
      id: call.id ?? `call_${String(index)}`,
      name: call.name,
      arguments: args.data,
    });
    if (parsed.success) calls.push(parsed.data);
  });
  return calls;
}

export function finishReason(reason: string | undefined, hasToolCalls: boolean): ProviderResponse['finishReason'] {
  if (hasToolCalls) return 'tool_calls';
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    case 'STOP':
    case undefined:
    default:
      return 'stop';
  }
}
