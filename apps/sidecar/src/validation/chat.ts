import type {
  ChatMessage,
  ContentPart,
  Conversation,
  GenerateImageArgs,
  SearchKnowledgeArgs,
  TokenUsage,
  ToolCall,
  ToolDeclaration,
  ToolParameterSchema,
  ToolResult,
} from '@itstudio/schemas';
import {
  conversationIdSchema,
  imageAssetIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
  modelKeySchema,
  toolCallIdSchema,
  projectIdSchema,
  jsonObjectSchema,
  jsonValueSchema,
  z,
} from './common.js';
import { retrievalHitSchema } from './rag.js';
export const toolParameterSchema: z.ZodType<ToolParameterSchema> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('string'),
        description: z.string().exactOptional(),
        enum: z.array(z.string()).readonly().exactOptional(),
        maxLength: z.number().exactOptional(),
      })
      .readonly(),
    z
      .object({
        type: z.union([z.literal('number'), z.literal('integer')]),
        description: z.string().exactOptional(),
        minimum: z.number().exactOptional(),
        maximum: z.number().exactOptional(),
      })
      .readonly(),
    z.object({ type: z.literal('boolean'), description: z.string().exactOptional() }).readonly(),
    z
      .object({
        type: z.literal('array'),
        description: z.string().exactOptional(),
        items: toolParameterSchema,
        maxItems: z.number().exactOptional(),
      })
      .readonly(),
    z
      .object({
        type: z.literal('object'),
        description: z.string().exactOptional(),
        properties: z.record(z.string(), toolParameterSchema).readonly(),
        required: z.array(z.string()).readonly(),
      })
      .readonly(),
  ]),
);
const toolParameterObjectSchema: z.ZodType<Extract<ToolParameterSchema, { type: 'object' }>> = z
  .object({
    type: z.literal('object'),
    description: z.string().exactOptional(),
    properties: z.record(z.string(), toolParameterSchema).readonly(),
    required: z.array(z.string()).readonly(),
  })
  .readonly();
export const toolDeclarationSchema = z
  .object({
    name: z.enum(['generate_image', 'search_knowledge']),
    description: z.string(),
    parameters: toolParameterObjectSchema,
    enabled: z.boolean(),
  })
  .readonly() satisfies z.ZodType<ToolDeclaration>;
export const toolCallSchema = z
  .object({ id: toolCallIdSchema, name: z.enum(['generate_image', 'search_knowledge']), arguments: jsonObjectSchema })
  .readonly() satisfies z.ZodType<ToolCall>;
export const toolResultSchema = z
  .object({ callId: toolCallIdSchema, isError: z.boolean(), content: jsonValueSchema })
  .readonly() satisfies z.ZodType<ToolResult>;
export const generateImageArgsSchema = z
  .object({
    prompt: z.string(),
    size: z.enum(['1024x1024', '1792x1024', '1024x1792']).exactOptional(),
    style: z.string().exactOptional(),
    count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).exactOptional(),
  })
  .readonly() satisfies z.ZodType<GenerateImageArgs>;
export const searchKnowledgeArgsSchema = z
  .object({ query: z.string(), topK: z.number().exactOptional() })
  .readonly() satisfies z.ZodType<SearchKnowledgeArgs>;
export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  })
  .readonly() satisfies z.ZodType<TokenUsage>;
export const contentPartSchema: z.ZodType<ContentPart> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).readonly(),
  z
    .object({
      type: z.literal('image'),
      assetId: imageAssetIdSchema,
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    })
    .readonly(),
  z.object({ type: z.literal('tool_call'), call: toolCallSchema }).readonly(),
  z.object({ type: z.literal('tool_result'), result: toolResultSchema }).readonly(),
  z.object({ type: z.literal('citation'), hit: retrievalHitSchema }).readonly(),
]);
export const chatMessageSchema = z
  .object({
    id: messageIdSchema,
    conversationId: conversationIdSchema,
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    parts: z.array(contentPartSchema).readonly(),
    modelKey: modelKeySchema.exactOptional(),
    usage: tokenUsageSchema.exactOptional(),
    createdAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<ChatMessage>;
export const conversationSchema = z
  .object({
    id: conversationIdSchema,
    projectId: projectIdSchema,
    title: z.string(),
    ragEnabled: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<Conversation>;
