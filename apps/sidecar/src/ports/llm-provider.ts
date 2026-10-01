import type {
  ContentPart,
  FailureKind,
  LlmResponse,
  ProviderId,
  Result,
  TokenUsage,
  ToolCall,
  ToolDeclaration,
} from '@itstudio/schemas';

export interface ProviderRequest {
  readonly modelId: string;
  readonly system?: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools?: readonly ToolDeclaration[];
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  readonly responseFormat: 'text' | 'json';
  readonly timeoutMs: number;
}

export interface ProviderMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly parts: readonly ContentPart[];
}

export interface ProviderResponse {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: TokenUsage;
  readonly finishReason: LlmResponse['finishReason'];
  readonly providerModelId: string;
}

export interface ProviderFailure {
  readonly kind: FailureKind;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly billed: boolean;
  readonly message: string;
}

export interface ILlmProvider {
  readonly id: ProviderId;
  complete(
    req: ProviderRequest,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<Result<ProviderResponse, ProviderFailure>>;
  stream(
    req: ProviderRequest,
    apiKey: string,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>>;
  listModels(apiKey: string, signal: AbortSignal): Promise<Result<readonly string[], ProviderFailure>>;
}
