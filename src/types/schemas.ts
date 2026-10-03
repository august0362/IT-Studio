/**
 * IT Studio — Canonical Data Contracts
 * =====================================
 * Single source of truth for every type that crosses a boundary:
 *   React UI  <—JSON-RPC/Tauri—>  Node Sidecar  <—WebSocket—>  VS Code Extension
 *   Node Sidecar  <—HTTPS—>  LLM / Embedding / Image providers
 *
 * Governance (see CONVENTIONS.md §2, ARCHITECTURE.md §1):
 *  - Owned by the Architect role (Claude). Codex MUST NOT change existing shapes without an ADR in docs/decisions/.
 *    Additive changes (new optional field, new union member) are allowed when a task spec says so.
 *  - Zero `any`. Unknown data is `JsonValue` or `unknown` + runtime validation (zod schemas mirror these types).
 *  - No TS `enum` (Node type-stripping + erasableSyntaxOnly). Use `as const` objects + derived unions.
 *  - Money is integer micro-USD (1 USD = 1_000_000 µUSD) to avoid float drift. VND is integer đồng.
 *  - All timestamps are ISO-8601 UTC strings.
 *  - Every persisted entity carries `projectId` (decision D13).
 */

/* ============================================================================
 * §0. PRIMITIVES
 * ========================================================================== */

/** Nominal typing helper. Values are created only via validated constructors. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type LlmRequestId = Brand<string, 'LlmRequestId'>;
export type PipelineRunId = Brand<string, 'PipelineRunId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type RevenueEntryId = Brand<string, 'RevenueEntryId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type ChunkId = Brand<string, 'ChunkId'>;
export type IngestJobId = Brand<string, 'IngestJobId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type CommandRunId = Brand<string, 'CommandRunId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type ImageAssetId = Brand<string, 'ImageAssetId'>;
export type PriceTableVersion = Brand<string, 'PriceTableVersion'>;

/** ISO-8601 UTC timestamp, e.g. "2026-10-01T08:00:00.000Z". */
export type IsoDateTime = Brand<string, 'IsoDateTime'>;
/** Integer micro-USD. 1 USD = 1_000_000. */
export type MicroUsd = Brand<number, 'MicroUsd'>;
/** Integer Vietnamese đồng. */
export type Vnd = Brand<number, 'Vnd'>;
/** POSIX-style path relative to the active project workspace root. Never absolute, never contains "..". */
export type WorkspaceRelativePath = Brand<string, 'WorkspaceRelativePath'>;
/** SHA-256 hex digest. */
export type Sha256 = Brand<string, 'Sha256'>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Discriminated success/failure container used by every service method. Services never throw across layers. */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/* ============================================================================
 * §1. ERRORS
 * ========================================================================== */

export const ErrorCode = {
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SECRET_MISSING: 'SECRET_MISSING',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_QUOTA_EXHAUSTED: 'PROVIDER_QUOTA_EXHAUSTED',
  PROVIDER_AUTH: 'PROVIDER_AUTH',
  PROVIDER_SERVER: 'PROVIDER_SERVER',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_BAD_REQUEST: 'PROVIDER_BAD_REQUEST',
  PROVIDER_CONTENT_FILTERED: 'PROVIDER_CONTENT_FILTERED',
  LADDER_EXHAUSTED: 'LADDER_EXHAUSTED',
  FALLBACK_DECLINED: 'FALLBACK_DECLINED',
  BUDGET_HARD_STOP: 'BUDGET_HARD_STOP',
  PATH_OUTSIDE_WORKSPACE: 'PATH_OUTSIDE_WORKSPACE',
  PATCH_CONFLICT: 'PATCH_CONFLICT',
  COMMAND_FAILED: 'COMMAND_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PIPELINE_REVIEW_REJECTED: 'PIPELINE_REVIEW_REJECTED',
  VSCODE_UNAVAILABLE: 'VSCODE_UNAVAILABLE',
  CANCELLED: 'CANCELLED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppError {
  readonly code: ErrorCode;
  /** Human-readable, English, safe to display (MUST NOT contain secrets or raw provider bodies). */
  readonly message: string;
  /** Actionable next steps for the user; required for any error surfaced in a failure report. */
  readonly remediation?: readonly string[];
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

/* ============================================================================
 * §2. PROJECTS
 * ========================================================================== */

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /** Absolute path on disk. Only the sidecar reads this; UI shows it read-only. */
  readonly workspaceRoot: string;
  readonly createdAt: IsoDateTime;
  readonly archived: boolean;
}

/* ============================================================================
 * §3. PROVIDERS & MODELS
 * ========================================================================== */

export const ProviderId = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google',
  XAI: 'xai',
  GROQ: 'groq',
  TOGETHER: 'together',
  REPLICATE: 'replicate',
} as const;
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];

/** Stable model key: "<provider>/<provider-model-id>", e.g. "openai/gpt-4o-mini". */
export type ModelKey = `${ProviderId}/${string}`;

export const ModelCapability = {
  CHAT: 'chat',
  TOOL_CALLING: 'tool_calling',
  VISION: 'vision',
  CODE: 'code',
  EMBEDDING: 'embedding',
  IMAGE_GENERATION: 'image_generation',
  JSON_MODE: 'json_mode',
} as const;
export type ModelCapability = (typeof ModelCapability)[keyof typeof ModelCapability];

export interface ModelDescriptor {
  readonly key: ModelKey;
  readonly provider: ProviderId;
  /** Exact id sent to the provider API. */
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly enabled: boolean;
}

/** Status of the API key for a provider. The key value itself NEVER leaves the sidecar. */
export interface SecretStatus {
  readonly provider: ProviderId;
  readonly configured: boolean;
  /** Last 4 chars only, for UI confirmation. */
  readonly hint?: string;
  readonly lastVerifiedAt?: IsoDateTime;
}

/* ============================================================================
 * §4. CHAT & TOOLS
 * ========================================================================== */

export const ChatRole = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
} as const;
export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];

export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly assetId: ImageAssetId; readonly mimeType: ImageMimeType }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | { readonly type: 'tool_result'; readonly result: ToolResult }
  | { readonly type: 'citation'; readonly hit: RetrievalHit };

export interface ChatMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: ChatRole;
  readonly parts: readonly ContentPart[];
  /** Model that produced an assistant message (after any fallback). */
  readonly modelKey?: ModelKey;
  readonly usage?: TokenUsage;
  readonly createdAt: IsoDateTime;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly projectId: ProjectId;
  readonly title: string;
  /** When true, retrieval runs on every user turn. */
  readonly ragEnabled: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Restricted JSON Schema subset accepted by all providers for tool parameters. */
export type ToolParameterSchema =
  | { readonly type: 'string'; readonly description?: string; readonly enum?: readonly string[]; readonly maxLength?: number }
  | { readonly type: 'number' | 'integer'; readonly description?: string; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'boolean'; readonly description?: string }
  | { readonly type: 'array'; readonly description?: string; readonly items: ToolParameterSchema; readonly maxItems?: number }
  | {
      readonly type: 'object';
      readonly description?: string;
      readonly properties: Readonly<Record<string, ToolParameterSchema>>;
      readonly required: readonly string[];
    };

export const ToolName = {
  GENERATE_IMAGE: 'generate_image',
  SEARCH_KNOWLEDGE: 'search_knowledge',
} as const;
export type ToolName = (typeof ToolName)[keyof typeof ToolName];

export interface ToolDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: Extract<ToolParameterSchema, { type: 'object' }>;
  /** Deferred tools are declared but rejected at dispatch while `enabled` is false (see ARCHITECTURE.md §10). */
  readonly enabled: boolean;
}

export interface ToolCall {
  readonly id: ToolCallId;
  readonly name: ToolName;
  /** Raw arguments from the model; validated against the declaration before dispatch. */
  readonly arguments: JsonObject;
}

export interface ToolResult {
  readonly callId: ToolCallId;
  readonly isError: boolean;
  readonly content: JsonValue;
}

/** Arguments of `generate_image` (deferred milestone M8). */
export interface GenerateImageArgs {
  readonly prompt: string;
  readonly size?: ImageSize;
  readonly style?: string;
  readonly count?: 1 | 2 | 3 | 4;
}

/** Arguments of `search_knowledge` (RAG as a tool, M5). */
export interface SearchKnowledgeArgs {
  readonly query: string;
  readonly topK?: number;
}

/* ============================================================================
 * §5. LLM ROUTER
 * ========================================================================== */

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prompt-cache reads, if the provider reports them. */
  readonly cachedInputTokens: number;
}

export interface LlmRequest {
  readonly id: LlmRequestId;
  readonly projectId: ProjectId;
  /** Set by RoleCaller for pipeline role calls; copied to the ledger row. */
  readonly pipelineRunId?: PipelineRunId;
  /** What this call is for — drives ledger attribution and P&L breakdown. */
  readonly purpose: CostPurpose;
  readonly messages: readonly ChatMessage[];
  readonly systemPrompt?: string;
  readonly tools?: readonly ToolDeclaration[];
  readonly requiredCapabilities: readonly ModelCapability[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: 'text' | 'json';
  /** Chat model choice: tried first, then the rest of the ladder (fallback per autoFallback). */
  readonly preferredModelKey?: ModelKey;
  /** Overrides the ladder for this request only (e.g. pipeline role assignment). */
  readonly ladderOverride?: readonly ModelKey[];
  readonly stream: boolean;
}

export interface LlmResponse {
  readonly requestId: LlmRequestId;
  /** Model that actually answered. */
  readonly modelKey: ModelKey;
  readonly message: ChatMessage;
  readonly usage: TokenUsage;
  readonly costMicroUsd: MicroUsd;
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  /** Every attempt made, in order, including failures. */
  readonly attempts: readonly RouterAttempt[];
  readonly latencyMs: number;
}

export const FailureKind = {
  RATE_LIMITED: 'rate_limited',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  SERVER_ERROR: 'server_error',
  TIMEOUT: 'timeout',
  AUTH: 'auth',
  BAD_REQUEST: 'bad_request',
  CONTENT_FILTERED: 'content_filtered',
  CAPABILITY_MISMATCH: 'capability_mismatch',
  CIRCUIT_OPEN: 'circuit_open',
} as const;
export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

/** Failure kinds that trigger fallback. AUTH/BAD_REQUEST/CONTENT_FILTERED do not (see ARCHITECTURE.md §5.3). */
export const FALLBACK_TRIGGERS: readonly FailureKind[] = [
  FailureKind.RATE_LIMITED,
  FailureKind.QUOTA_EXHAUSTED,
  FailureKind.SERVER_ERROR,
  FailureKind.TIMEOUT,
  FailureKind.CIRCUIT_OPEN,
  FailureKind.CAPABILITY_MISMATCH,
];

export interface RouterAttempt {
  readonly modelKey: ModelKey;
  readonly startedAt: IsoDateTime;
  readonly latencyMs: number;
  readonly outcome: 'success' | 'failed' | 'skipped';
  readonly failure?: FailureKind;
  readonly httpStatus?: number;
  /** Provider-suggested wait (Retry-After), if any. */
  readonly retryAfterMs?: number;
}

export interface LadderEntry {
  readonly modelKey: ModelKey;
  /** 1 = highest priority. Unique within a ladder. */
  readonly priority: number;
  readonly enabled: boolean;
  /** Max same-model retries for transient failures before moving down the ladder. */
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export interface CircuitBreakerConfig {
  /** Consecutive fallback-triggering failures before the circuit opens. */
  readonly failureThreshold: number;
  /** How long an open circuit skips the model before a half-open probe. */
  readonly cooldownMs: number;
}

export interface RouterConfig {
  readonly ladder: readonly LadderEntry[];
  /** D10: true = switch automatically; false = emit `router.fallbackRequired` and wait for the user. */
  readonly autoFallback: boolean;
  /** When set, all chat requests go only to this model; fallback still applies per `autoFallback`. */
  readonly lockedModelKey: ModelKey | null;
  readonly circuitBreaker: CircuitBreakerConfig;
  /** How long to wait for a user fallback decision before failing with FALLBACK_DECLINED. */
  readonly userDecisionTimeoutMs: number;
}

export const RouterState = {
  IDLE: 'idle',
  BUDGET_CHECK: 'budget_check',
  DISPATCHING: 'dispatching',
  STREAMING: 'streaming',
  RETRY_WAIT: 'retry_wait',
  FALLING_BACK: 'falling_back',
  AWAITING_USER: 'awaiting_user',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type RouterState = (typeof RouterState)[keyof typeof RouterState];

export type RouterEvent =
  | { readonly type: 'state'; readonly requestId: LlmRequestId; readonly state: RouterState; readonly modelKey?: ModelKey }
  | { readonly type: 'attempt_failed'; readonly requestId: LlmRequestId; readonly attempt: RouterAttempt }
  | { readonly type: 'fallback'; readonly requestId: LlmRequestId; readonly from: ModelKey; readonly to: ModelKey; readonly reason: FailureKind }
  | { readonly type: 'circuit'; readonly modelKey: ModelKey; readonly status: 'open' | 'half_open' | 'closed' };

/** Emitted when `autoFallback=false` and the current model failed with a fallback trigger. */
export interface FallbackDecisionRequest {
  readonly requestId: LlmRequestId;
  readonly failedModel: ModelKey;
  readonly reason: FailureKind;
  /** Remaining eligible models, ladder order, with estimated cost for this request. */
  readonly candidates: readonly {
    readonly modelKey: ModelKey;
    readonly estimatedCostMicroUsd: MicroUsd;
    readonly estimatedCost?: MoneyDisplay;
  }[];
  readonly expiresAt: IsoDateTime;
}

export type FallbackDecision =
  | { readonly requestId: LlmRequestId; readonly action: 'use_model'; readonly modelKey: ModelKey }
  | { readonly requestId: LlmRequestId; readonly action: 'retry_same' }
  | { readonly requestId: LlmRequestId; readonly action: 'abort' };

/* ============================================================================
 * §6. COST, PRICING, FX, BUDGET, P&L
 * ========================================================================== */

export const CostPurpose = {
  CHAT: 'chat',
  PIPELINE_PM: 'pipeline_pm',
  PIPELINE_CODER: 'pipeline_coder',
  PIPELINE_REVIEWER: 'pipeline_reviewer',
  EMBEDDING: 'embedding',
  IMAGE: 'image',
  PRICING_EXTRACTION: 'pricing_extraction',
} as const;
export type CostPurpose = (typeof CostPurpose)[keyof typeof CostPurpose];

/** Price unit for one model. Rates are µUSD per 1M tokens (or per image). */
export interface PriceEntry {
  readonly modelKey: ModelKey;
  readonly inputPerMTokMicroUsd: MicroUsd;
  readonly outputPerMTokMicroUsd: MicroUsd;
  readonly cachedInputPerMTokMicroUsd: MicroUsd;
  /** Image models only. */
  readonly perImageMicroUsd?: MicroUsd;
  /** Free-tier models record 0 but are still metered. */
  readonly freeTier: boolean;
  readonly sourceUrl: string;
}

export interface PriceRow {
  readonly entry: PriceEntry;
  readonly input: MoneyDisplay;
  readonly output: MoneyDisplay;
  readonly cachedInput: MoneyDisplay;
  readonly perImage?: MoneyDisplay;
  /** True when a manual override is active for this model. */
  readonly overridden: boolean;
}

export interface PriceTable {
  readonly version: PriceTableVersion;
  readonly effectiveFrom: IsoDateTime;
  readonly entries: readonly PriceEntry[];
  readonly origin: 'seed' | 'auto_extracted' | 'manual_override';
}

export interface PriceUpdateRun {
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime;
  readonly status: 'applied' | 'rejected_validation' | 'no_change' | 'fetch_failed';
  /** Per-model change in percent; validation rejects any |delta| above `PricingSettings.maxAutoChangePercent`. */
  readonly deltas: readonly { readonly modelKey: ModelKey; readonly field: keyof PriceEntry; readonly percent: number }[];
  readonly newVersion?: PriceTableVersion;
  readonly error?: AppError;
}

export interface FxRate {
  /** VND per 1 USD. */
  readonly usdToVnd: number;
  readonly asOf: IsoDateTime;
  readonly source: 'auto' | 'manual_override';
}

/** Dual-currency display value (D8): USD on line 1, VND on line 2. Computed in the sidecar, never in React. */
export interface MoneyDisplay {
  readonly microUsd: MicroUsd;
  readonly vnd: Vnd;
  /** Pre-formatted, e.g. "$1.2345" */
  readonly usdText: string;
  /** Pre-formatted, e.g. "31.456 ₫" */
  readonly vndText: string;
  readonly fxAsOf: IsoDateTime;
}

export interface LedgerEntry {
  readonly id: LedgerEntryId;
  readonly projectId: ProjectId;
  readonly occurredAt: IsoDateTime;
  readonly purpose: CostPurpose;
  readonly modelKey: ModelKey;
  readonly llmRequestId?: LlmRequestId;
  readonly pipelineRunId?: PipelineRunId;
  readonly conversationId?: ConversationId;
  readonly usage: TokenUsage;
  readonly imageCount?: number;
  /** Cost frozen at write time using `priceTableVersion`. Never recomputed. */
  readonly costMicroUsd: MicroUsd;
  readonly priceTableVersion: PriceTableVersion;
  /** Failed attempts that the provider still billed are recorded with `billedFailure=true`. */
  readonly billedFailure: boolean;
}

export interface RevenueEntry {
  readonly id: RevenueEntryId;
  readonly projectId: ProjectId;
  readonly occurredAt: IsoDateTime;
  readonly amountMicroUsd: MicroUsd;
  /** Original currency the user typed (converted at entry time). */
  readonly enteredCurrency: 'USD' | 'VND';
  readonly description: string;
}

export interface LedgerRow { readonly entry: LedgerEntry; readonly cost: MoneyDisplay; }
export interface RevenueRow { readonly entry: RevenueEntry; readonly amount: MoneyDisplay; }

export const BudgetPeriod = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  PROJECT_LIFETIME: 'project_lifetime',
} as const;
export type BudgetPeriod = (typeof BudgetPeriod)[keyof typeof BudgetPeriod];

export interface Budget {
  readonly projectId: ProjectId;
  readonly period: BudgetPeriod;
  readonly limitMicroUsd: MicroUsd;
  /** Warning thresholds as fractions of the limit, ascending, e.g. [0.5, 0.8, 1.0]. */
  readonly warnAt: readonly number[];
}

export interface BudgetStatus {
  readonly budget: Budget;
  readonly spent: MoneyDisplay;
  readonly remaining: MoneyDisplay;
  readonly fractionUsed: number;
  readonly level: 'ok' | 'warning' | 'exceeded';
  /** True only when exceeded AND `BudgetSettings.hardStop` is on. */
  readonly blocking: boolean;
}

export interface CostBreakdownRow {
  readonly key: string;
  readonly cost: MoneyDisplay;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
}

export interface ProjectPnL {
  readonly projectId: ProjectId;
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly revenue: MoneyDisplay;
  readonly cost: MoneyDisplay;
  /** revenue − cost; may be negative. */
  readonly margin: MoneyDisplay;
  /** margin / revenue; null when revenue is 0. */
  readonly marginPercent: number | null;
  readonly byModel: readonly CostBreakdownRow[];
  readonly byPurpose: readonly CostBreakdownRow[];
  readonly byDay: readonly CostBreakdownRow[];
}

export interface PortfolioPnL {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  /** One entry per project (including projects with no activity), ordered by margin ascending (worst first). */
  readonly projects: readonly ProjectPnL[];
  readonly revenue: MoneyDisplay;
  readonly cost: MoneyDisplay;
  readonly margin: MoneyDisplay;
  readonly marginPercent: number | null;
  /** Cost per project; `key` = projectId. Sorted by cost descending. */
  readonly byProject: readonly CostBreakdownRow[];
  /** Cost per model across all projects. Sorted by cost descending. */
  readonly byModel: readonly CostBreakdownRow[];
}

export interface LedgerQuery {
  readonly projectId: ProjectId;
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly purposes?: readonly CostPurpose[];
  readonly modelKeys?: readonly ModelKey[];
  readonly limit: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/* ============================================================================
 * §7. RAG
 * ========================================================================== */

export const DocumentFormat = {
  MARKDOWN: 'markdown',
  TEXT: 'text',
  PDF: 'pdf',
  DOCX: 'docx',
  CODE: 'code',
  HTML: 'html',
} as const;
export type DocumentFormat = (typeof DocumentFormat)[keyof typeof DocumentFormat];

export interface SourceDocument {
  readonly id: DocumentId;
  readonly projectId: ProjectId;
  readonly title: string;
  /** Absolute path of the original file (sidecar-only). */
  readonly sourcePath: string;
  readonly format: DocumentFormat;
  readonly contentHash: Sha256;
  readonly chunkCount: number;
  readonly embeddingModel: ModelKey;
  readonly ingestedAt: IsoDateTime;
  readonly tags: readonly string[];
}

export interface Chunk {
  readonly id: ChunkId;
  readonly documentId: DocumentId;
  readonly projectId: ProjectId;
  readonly ordinal: number;
  readonly text: string;
  readonly tokenCount: number;
  /** Heading trail / symbol path, e.g. ["Contracts", "Termination", "Art. 12"]. */
  readonly sectionPath: readonly string[];
  /** Vector stored in LanceDB only; never sent to the UI. */
  readonly embeddingDim: number;
}

export interface ChunkingConfig {
  readonly targetTokens: number;
  readonly overlapTokens: number;
  readonly respectHeadings: boolean;
}

export interface EmbeddingConfig {
  readonly modelKey: ModelKey;
  readonly dimensions: number;
  readonly batchSize: number;
  /** Fallback embedding models MUST share `dimensions`; switching dimension requires full re-index. */
  readonly fallbackModelKeys: readonly ModelKey[];
}

export const IngestStatus = {
  QUEUED: 'queued',
  PARSING: 'parsing',
  CHUNKING: 'chunking',
  EMBEDDING: 'embedding',
  INDEXED: 'indexed',
  FAILED: 'failed',
  SKIPPED_UNCHANGED: 'skipped_unchanged',
} as const;
export type IngestStatus = (typeof IngestStatus)[keyof typeof IngestStatus];

export interface IngestJob {
  readonly id: IngestJobId;
  readonly projectId: ProjectId;
  readonly paths: readonly string[];
  readonly status: IngestStatus;
  readonly processedFiles: number;
  readonly totalFiles: number;
  readonly cost: MicroUsd;
  readonly error?: AppError;
}

export interface RetrievalQuery {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly topK: number;
  /** Cosine similarity floor in [0,1]; hits below are dropped. */
  readonly minScore: number;
  readonly tagFilter?: readonly string[];
}

export interface RetrievalHit {
  readonly chunkId: ChunkId;
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly sectionPath: readonly string[];
  readonly text: string;
  readonly score: number;
}

/* ============================================================================
 * §8. AGENT PIPELINE (in-app runtime)
 * ========================================================================== */

export const AgentRole = {
  PM: 'pm',
  CODER: 'coder',
  REVIEWER: 'reviewer',
  WORKER: 'worker',
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

/** D5 defaults: PM + REVIEWER → Claude, CODER → Codex-class. Overridable in Settings. */
export type RoleAssignment = Readonly<Record<Exclude<AgentRole, 'worker'>, readonly ModelKey[]>>;

export const PipelineStage = {
  SPECIFYING: 'specifying',
  CODING: 'coding',
  REVIEWING: 'reviewing',
  FIXING: 'fixing',
  RE_REVIEWING: 're_reviewing',
  WRITING: 'writing',
  VALIDATING: 'validating',
  COMPLETED: 'completed',
  ROLLED_BACK: 'rolled_back',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type PipelineStage = (typeof PipelineStage)[keyof typeof PipelineStage];

/** PM output: the contract handed to the Coder. */
export interface TaskSpec {
  readonly title: string;
  readonly userStory: string;
  readonly acceptanceCriteria: readonly string[];
  /** Files the coder may touch. Anything else is rejected by the Worker. */
  readonly allowedPaths: readonly WorkspaceRelativePath[];
  /** TypeScript interfaces / signatures the implementation must satisfy (verbatim code). */
  readonly contracts: string;
  readonly constraints: readonly string[];
  readonly testPlan: readonly string[];
  readonly outOfScope: readonly string[];
}

/** Coder output. */
export interface CoderOutput {
  readonly summary: string;
  readonly operations: readonly FileOperation[];
  /** Coder's own notes on assumptions; Reviewer must check each. */
  readonly assumptions: readonly string[];
}

export const FindingSeverity = {
  BLOCKER: 'blocker',
  MAJOR: 'major',
  MINOR: 'minor',
  NIT: 'nit',
} as const;
export type FindingSeverity = (typeof FindingSeverity)[keyof typeof FindingSeverity];

export const FindingCategory = {
  SECURITY_XSS: 'security_xss',
  SECURITY_INJECTION: 'security_injection',
  SECURITY_SECRET: 'security_secret',
  SECURITY_PATH: 'security_path',
  CORRECTNESS: 'correctness',
  EDGE_CASE: 'edge_case',
  CONTRACT_VIOLATION: 'contract_violation',
  SCOPE_VIOLATION: 'scope_violation',
  STYLE: 'style',
  TESTING: 'testing',
} as const;
export type FindingCategory = (typeof FindingCategory)[keyof typeof FindingCategory];

export interface ReviewFinding {
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly path: WorkspaceRelativePath;
  readonly line?: number;
  readonly message: string;
  readonly suggestedFix: string;
}

/** Reviewer output. `approved` MUST be false if any BLOCKER or MAJOR finding exists. */
export interface ReviewVerdict {
  readonly approved: boolean;
  readonly findings: readonly ReviewFinding[];
  readonly summary: string;
}

export interface PipelineRun {
  readonly id: PipelineRunId;
  readonly projectId: ProjectId;
  readonly prompt: string;
  readonly stage: PipelineStage;
  readonly roleAssignment: RoleAssignment;
  readonly spec?: TaskSpec;
  readonly coderOutputs: readonly CoderOutput[];
  readonly verdicts: readonly ReviewVerdict[];
  /** 0 or 1. Hard-capped at 1 (D5). */
  readonly fixAttempts: 0 | 1;
  readonly transactionId?: TransactionId;
  readonly validation?: readonly CommandRun[];
  readonly failureReport?: FailureReport;
  readonly cost: MoneyDisplay;
  readonly startedAt: IsoDateTime;
  readonly finishedAt?: IsoDateTime;
}

export type PipelineEvent =
  | { readonly type: 'stage'; readonly runId: PipelineRunId; readonly stage: PipelineStage }
  | { readonly type: 'artifact'; readonly runId: PipelineRunId; readonly kind: 'spec' | 'code' | 'review'; readonly index: number }
  | { readonly type: 'command_output'; readonly runId: PipelineRunId; readonly commandRunId: CommandRunId; readonly stream: 'stdout' | 'stderr'; readonly chunk: string }
  | { readonly type: 'finished'; readonly runId: PipelineRunId; readonly stage: 'completed' | 'rolled_back' | 'failed' | 'cancelled' };

/** D11: produced on any rollback; shown to the user with remediation steps. */
export interface FailureReport {
  readonly runId?: PipelineRunId;
  readonly stage: PipelineStage;
  readonly error: AppError;
  readonly rolledBack: boolean;
  readonly restoredSnapshot?: string;
  /** Ordered, imperative instructions for the user. */
  readonly nextSteps: readonly string[];
  readonly logExcerpt: string;
}

/* ============================================================================
 * §9. WORKER — atomic file operations & command runs
 * ========================================================================== */

export type FileOperation =
  | { readonly kind: 'create'; readonly path: WorkspaceRelativePath; readonly content: string }
  | {
      readonly kind: 'replace';
      readonly path: WorkspaceRelativePath;
      readonly content: string;
      /** Hash of the file the coder based its change on; mismatch → PATCH_CONFLICT. */
      readonly baseHash: Sha256;
    }
  | {
      readonly kind: 'patch';
      readonly path: WorkspaceRelativePath;
      /** Unified diff against `baseHash`. */
      readonly unifiedDiff: string;
      readonly baseHash: Sha256;
    }
  | { readonly kind: 'delete'; readonly path: WorkspaceRelativePath; readonly baseHash: Sha256 }
  | { readonly kind: 'rename'; readonly from: WorkspaceRelativePath; readonly to: WorkspaceRelativePath; readonly baseHash: Sha256 };

export const TransactionStatus = {
  PREPARED: 'prepared',
  COMMITTED: 'committed',
  VALIDATED: 'validated',
  ROLLED_BACK: 'rolled_back',
  ROLLBACK_FAILED: 'rollback_failed',
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export interface WriteTransaction {
  readonly id: TransactionId;
  readonly projectId: ProjectId;
  readonly runId?: PipelineRunId;
  readonly operations: readonly FileOperation[];
  /** Journal directory `.itstudio/tx/<id>/` holding pre-write copies of every touched file — the rollback target. */
  readonly snapshotRef: string;
  readonly status: TransactionStatus;
  readonly createdAt: IsoDateTime;
}

export const CommandKind = {
  INSTALL: 'install',
  TYPECHECK: 'typecheck',
  LINT: 'lint',
  TEST: 'test',
  BUILD: 'build',
} as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

/** Allow-listed commands only; resolved from project config, never from model output. */
export interface CommandSpec {
  readonly kind: CommandKind;
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface CommandRun {
  readonly id: CommandRunId;
  readonly spec: CommandSpec;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly tests?: TestSummary;
}

export interface TestSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly { readonly name: string; readonly message: string; readonly path?: WorkspaceRelativePath }[];
}

export interface Diagnostic {
  readonly source: 'tsc' | 'eslint' | 'vitest' | 'vscode';
  readonly severity: 'error' | 'warning' | 'info';
  readonly path: WorkspaceRelativePath;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: string;
}

/* ============================================================================
 * §10. IPC — React ⇄ Sidecar (JSON-RPC 2.0 relayed by Tauri over stdio)
 * ========================================================================== */

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: M;
  readonly params: RpcMethodMap[M]['params'];
}

export type RpcResponse<M extends RpcMethod = RpcMethod> =
  | { readonly jsonrpc: '2.0'; readonly id: number; readonly result: RpcMethodMap[M]['result'] }
  | { readonly jsonrpc: '2.0'; readonly id: number; readonly error: RpcError };

export interface RpcError {
  /** JSON-RPC code: -32700..-32600 protocol; -32000 application (see `data.code`). */
  readonly code: number;
  readonly message: string;
  readonly data: AppError;
}

export interface RpcNotification<N extends RpcNotificationName = RpcNotificationName> {
  readonly jsonrpc: '2.0';
  readonly method: N;
  readonly params: RpcNotificationMap[N];
}

type Empty = Readonly<Record<string, never>>;

/** Exhaustive request/response catalog. Adding a method = additive change (no ADR needed). */
export interface RpcMethodMap {
  'system.ping': { params: Empty; result: { readonly version: string; readonly uptimeMs: number } };
  /** Sent by the Rust shell on app exit; sidecar rolls back in-flight writes and exits within 5 s. */
  'system.shutdown': { params: Empty; result: { readonly accepted: true } };

  'project.list': { params: Empty; result: readonly Project[] };
  'project.create': { params: { readonly name: string; readonly workspaceRoot: string }; result: Project };
  'project.setActive': { params: { readonly projectId: ProjectId }; result: Project };

  'settings.get': { params: Empty; result: AppSettings };
  'settings.update': { params: { readonly patch: SettingsPatch }; result: AppSettings };

  /** Write-only: the key is stored in the OS keychain and never returned. */
  'secrets.set': { params: { readonly provider: ProviderId; readonly apiKey: string }; result: SecretStatus };
  'secrets.delete': { params: { readonly provider: ProviderId }; result: SecretStatus };
  'secrets.status': { params: Empty; result: readonly SecretStatus[] };
  'secrets.verify': { params: { readonly provider: ProviderId }; result: SecretStatus };

  'models.list': { params: Empty; result: readonly ModelDescriptor[] };

  'chat.listConversations': { params: { readonly projectId: ProjectId }; result: readonly Conversation[] };
  'chat.createConversation': { params: { readonly projectId: ProjectId; readonly title?: string }; result: Conversation };
  'chat.getMessages': { params: { readonly conversationId: ConversationId }; result: readonly ChatMessage[] };
  'chat.setRagEnabled': { params: { readonly conversationId: ConversationId; readonly enabled: boolean }; result: Conversation };
  /** Returns immediately; content arrives via `chat.delta` / `chat.completed`. */
  'chat.send': {
    params: { readonly conversationId: ConversationId; readonly text: string; readonly modelOverride?: ModelKey };
    result: { readonly requestId: LlmRequestId; readonly userMessageId: MessageId };
  };
  'chat.cancel': { params: { readonly requestId: LlmRequestId }; result: { readonly cancelled: boolean } };

  'images.list': { params: { readonly projectId: ProjectId }; result: readonly ImageAsset[] };
  'images.delete': { params: { readonly assetId: ImageAssetId }; result: { readonly deleted: boolean } };

  'router.getConfig': { params: Empty; result: RouterConfig };
  'router.updateConfig': { params: { readonly config: RouterConfig }; result: RouterConfig };
  'router.resolveFallback': { params: FallbackDecision; result: { readonly accepted: boolean } };

  'ledger.query': { params: LedgerQuery; result: Page<LedgerEntry> };
  'ledger.queryRows': { params: LedgerQuery; result: Page<LedgerRow> };
  'pnl.get': { params: { readonly projectId: ProjectId; readonly from: IsoDateTime; readonly to: IsoDateTime }; result: ProjectPnL };
  'pnl.getAll': { params: { readonly from: IsoDateTime; readonly to: IsoDateTime }; result: PortfolioPnL };
  'revenue.list': { params: { readonly projectId: ProjectId; readonly from: IsoDateTime; readonly to: IsoDateTime }; result: readonly RevenueEntry[] };
  'revenue.listRows': { params: { readonly projectId: ProjectId; readonly from: IsoDateTime; readonly to: IsoDateTime }; result: readonly RevenueRow[] };
  'revenue.add': {
    params: { readonly projectId: ProjectId; readonly amount: number; readonly currency: 'USD' | 'VND'; readonly description: string };
    result: RevenueEntry;
  };
  'budget.set': { params: Budget; result: BudgetStatus };
  'budget.setUsd': { params: { readonly projectId: ProjectId; readonly period: BudgetPeriod; readonly limitUsd: string; readonly warnAt: readonly number[] }; result: BudgetStatus };
  'budget.status': { params: { readonly projectId: ProjectId }; result: readonly BudgetStatus[] };

  'pricing.get': { params: Empty; result: PriceTable };
  'pricing.getRows': { params: Empty; result: { readonly table: PriceTable; readonly rows: readonly PriceRow[]; readonly stale: boolean } };
  'pricing.refresh': { params: Empty; result: PriceUpdateRun };
  'pricing.override': { params: { readonly entry: PriceEntry }; result: PriceTable };
  'pricing.clearOverride': { params: { readonly modelKey: ModelKey }; result: PriceTable };
  'pricing.overrideUsd': {
    params: { readonly modelKey: ModelKey; readonly inputPerMTokUsd: string; readonly outputPerMTokUsd: string; readonly cachedInputPerMTokUsd: string };
    result: PriceTable;
  };
  'fx.get': { params: Empty; result: FxRate };
  'fx.override': { params: { readonly usdToVnd: number | null }; result: FxRate };

  'rag.ingest': { params: { readonly projectId: ProjectId; readonly paths: readonly string[]; readonly tags?: readonly string[] }; result: IngestJob };
  'rag.listDocuments': { params: { readonly projectId: ProjectId }; result: readonly SourceDocument[] };
  'rag.deleteDocument': { params: { readonly documentId: DocumentId }; result: { readonly deleted: boolean } };
  'rag.query': { params: RetrievalQuery; result: readonly RetrievalHit[] };

  'pipeline.start': { params: { readonly projectId: ProjectId; readonly prompt: string }; result: PipelineRun };
  'pipeline.get': { params: { readonly runId: PipelineRunId }; result: PipelineRun };
  'pipeline.list': { params: { readonly projectId: ProjectId; readonly limit: number }; result: readonly PipelineRun[] };
  'pipeline.cancel': { params: { readonly runId: PipelineRunId }; result: PipelineRun };

  'workspace.openInVSCode': { params: { readonly projectId: ProjectId }; result: VSCodeStatus };
  'workspace.readFile': { params: { readonly projectId: ProjectId; readonly path: WorkspaceRelativePath }; result: { readonly content: string; readonly hash: Sha256 } };
  'workspace.runCommand': { params: { readonly projectId: ProjectId; readonly kind: CommandKind }; result: CommandRun };
}
export type RpcMethod = keyof RpcMethodMap;

/** Sidecar → UI push events. */
export interface RpcNotificationMap {
  /** First line the sidecar writes after migrations + journal recovery complete. */
  'system.ready': { readonly version: string; readonly recoveredTransactions: number };
  'chat.delta': { readonly requestId: LlmRequestId; readonly textDelta: string };
  'chat.completed': { readonly requestId: LlmRequestId; readonly message: ChatMessage; readonly cost: MoneyDisplay };
  'chat.failed': { readonly requestId: LlmRequestId; readonly error: AppError };
  'router.event': RouterEvent;
  'router.fallbackRequired': FallbackDecisionRequest;
  'ledger.entry': { readonly entry: LedgerEntry; readonly cost: MoneyDisplay };
  'budget.alert': BudgetStatus;
  'pricing.updated': PriceUpdateRun;
  'rag.progress': IngestJob;
  'pipeline.event': PipelineEvent;
  'pipeline.failureReport': FailureReport;
  'vscode.status': VSCodeStatus;
  'vscode.diagnostics': { readonly projectId: ProjectId; readonly diagnostics: readonly Diagnostic[] };
}
export type RpcNotificationName = keyof RpcNotificationMap;

/* ============================================================================
 * §11. VS CODE EXTENSION PROTOCOL (Sidecar ⇄ Extension over ws://127.0.0.1)
 * ========================================================================== */

export interface VSCodeStatus {
  readonly installed: boolean;
  readonly extensionInstalled: boolean;
  readonly connected: boolean;
  readonly workspaceRoot?: string;
  readonly extensionVersion?: string;
}

/** First frame the extension MUST send; sidecar closes the socket on bad token or protocol mismatch. */
export interface ExtHello {
  readonly type: 'hello';
  readonly protocolVersion: 1;
  /** One-time token the sidecar wrote to `.itstudio/session.json` in the workspace. */
  readonly token: string;
  readonly workspaceRoot: string;
  readonly extensionVersion: string;
}

export type ExtToSidecar =
  | ExtHello
  | { readonly type: 'diagnostics'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly type: 'file_saved_by_user'; readonly path: WorkspaceRelativePath; readonly hash: Sha256 }
  | { readonly type: 'ack'; readonly ref: number }
  | { readonly type: 'pong' };

export type SidecarToExt =
  | { readonly type: 'welcome'; readonly sessionId: string }
  | { readonly type: 'reveal'; readonly ref: number; readonly path: WorkspaceRelativePath; readonly line?: number }
  | { readonly type: 'show_diff'; readonly ref: number; readonly path: WorkspaceRelativePath; readonly before: string; readonly after: string; readonly title: string }
  | { readonly type: 'transaction'; readonly ref: number; readonly transactionId: TransactionId; readonly status: TransactionStatus; readonly paths: readonly WorkspaceRelativePath[] }
  | { readonly type: 'notify'; readonly ref: number; readonly level: 'info' | 'warning' | 'error'; readonly message: string }
  | { readonly type: 'request_diagnostics'; readonly ref: number }
  | { readonly type: 'ping' };

/* ============================================================================
 * §12. SETTINGS
 * ========================================================================== */

export interface BudgetSettings {
  /** D7: false = warn only (default); true = block every paid call once a budget is exceeded. */
  readonly hardStop: boolean;
}

export interface PricingSettings {
  readonly autoUpdate: boolean;
  readonly updateIntervalHours: number;
  /** Auto-extracted changes larger than this (abs %) are rejected and require manual review. */
  readonly maxAutoChangePercent: number;
  /** Model used to extract prices from fetched pages. */
  readonly extractionModelKey: ModelKey;
}

export interface FxSettings {
  readonly autoUpdate: boolean;
  /** When non-null, overrides the fetched rate. */
  readonly manualUsdToVnd: number | null;
}

export interface VSCodeSettings {
  readonly autoLaunch: boolean;
  /** Path to `code` executable; null = resolve from PATH. */
  readonly codeExecutable: string | null;
  readonly showDiffBeforeValidate: boolean;
  readonly revealChangedFiles: boolean;
}

export interface PipelineSettings {
  readonly roleAssignment: RoleAssignment;
  /** Commands run in VALIDATING stage, in order; any failure → rollback. */
  readonly validationCommands: readonly CommandSpec[];
  /** Fixed at 1 per D5; present for visibility, not user-editable. */
  readonly maxFixAttempts: 1;
}

export interface RagSettings {
  readonly embedding: EmbeddingConfig;
  readonly chunking: ChunkingConfig;
  readonly defaultTopK: number;
  readonly minScore: number;
}

export interface ImageSettings {
  /** Deferred (M8). Always false until the milestone ships. */
  readonly enabled: boolean;
  readonly providerOrder: readonly ImageProviderId[];
}

export interface UiSettings {
  /** Selected theme from `config/themes.json` (docs/design/THEMES.md). Unknown id → fall back to catalog defaults. */
  readonly themeId: ThemeId;
  /** `system` follows the OS light/dark preference using the selected theme's matching variant. */
  readonly mode: ThemeMode;
  readonly locale: 'en' | 'vi';
}

export interface AppSettings {
  readonly activeProjectId: ProjectId | null;
  readonly router: RouterConfig;
  readonly budget: BudgetSettings;
  readonly pricing: PricingSettings;
  readonly fx: FxSettings;
  readonly vscode: VSCodeSettings;
  readonly pipeline: PipelineSettings;
  readonly rag: RagSettings;
  readonly image: ImageSettings;
  readonly ui: UiSettings;
}

/** Deep-partial patch accepted by `settings.update`. */
export type SettingsPatch = {
  readonly [K in keyof AppSettings]?: AppSettings[K] extends readonly unknown[]
    ? AppSettings[K]
    : AppSettings[K] extends object
      ? Partial<AppSettings[K]>
      : AppSettings[K];
};

/* ============================================================================
 * §12a. THEMES (docs/design/THEMES.md; data in config/themes.json, bundled into the UI at build time)
 * ========================================================================== */

/** Kebab-case theme id, e.g. "arctic-focus". */
export type ThemeId = Brand<string, 'ThemeId'>;
/** Lower-case 7-char hex color, e.g. "#0d47a1". */
export type HexColor = Brand<string, 'HexColor'>;

export const ThemeMode = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
} as const;
export type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode];

/** Semantic color tokens. Components use ONLY these (as CSS variables `--color-<kebab-name>`), never raw hex. */
export interface ThemeTokens {
  readonly bg: HexColor;
  readonly surface: HexColor;
  readonly surfaceAlt: HexColor;
  readonly border: HexColor;
  readonly text: HexColor;
  readonly textMuted: HexColor;
  readonly primary: HexColor;
  readonly primaryFg: HexColor;
  readonly primaryHover: HexColor;
  readonly accent: HexColor;
  readonly focusRing: HexColor;
  readonly success: HexColor;
  readonly warning: HexColor;
  readonly danger: HexColor;
  readonly info: HexColor;
  /** Up to 6 categorical chart colors, each ≥ 3:1 against `surface`. */
  readonly chart: readonly HexColor[];
  /** Measured WCAG contrast ratios, recorded by the derivation tool for audit. */
  readonly contrast: Readonly<Record<string, number>>;
}

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly name: string;
  /** Source palette image (repo-relative). */
  readonly source: string;
  /** The four original palette colors. */
  readonly palette: readonly HexColor[];
  readonly nativeMode: 'light' | 'dark';
  /** Short mood label shown on the theme card. */
  readonly mood: string;
  /** Color-psychology rationale shown in the theme detail tooltip. */
  readonly psychology: string;
  readonly recommendedFor: readonly string[];
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

export interface ThemeCatalog {
  readonly version: 1;
  readonly generatedBy: string;
  readonly defaultLight: ThemeId;
  readonly defaultDark: ThemeId;
  readonly themes: readonly ThemeDefinition[];
}

/* ============================================================================
 * §12b. WORKFLOW MAP (v1 addendum — milestone MW; ARCHITECTURE.md §13.1, D32)
 * Types only; RPC methods `workflow.graph`, `workflow.activity` and the notification
 * `workflow.activity` are added together with their validators by MW-01.
 * ========================================================================== */

export type ActivityEventId = Brand<string, 'ActivityEventId'>;

export const WorkflowModuleId = {
  CHAT: 'chat',
  CODE: 'code',
  KNOWLEDGE: 'knowledge',
  ROUTER: 'router',
  PROVIDERS: 'providers',
  BUDGET_GUARD: 'budget_guard',
  LEDGER: 'ledger',
  PNL: 'pnl',
  PRICING_FX: 'pricing_fx',
  RAG_INGEST: 'rag_ingest',
  EMBEDDINGS: 'embeddings',
  VECTOR_STORE: 'vector_store',
  RETRIEVER: 'retriever',
  PIPELINE_PM: 'pipeline_pm',
  PIPELINE_CODER: 'pipeline_coder',
  PIPELINE_REVIEWER: 'pipeline_reviewer',
  WORKER: 'worker',
  COMMAND_RUNNER: 'command_runner',
  WORKSPACE_FS: 'workspace_fs',
  VSCODE_BRIDGE: 'vscode_bridge',
  STORAGE: 'storage',
} as const;
export type WorkflowModuleId = (typeof WorkflowModuleId)[keyof typeof WorkflowModuleId];

export type WorkflowLane = 'ui' | 'engine' | 'data' | 'pipeline' | 'storage';

export interface WorkflowNode {
  readonly id: WorkflowModuleId;
  readonly lane: WorkflowLane;
  /** i18n key for the display name. */
  readonly labelKey: string;
  readonly status: 'idle' | 'active' | 'error' | 'disabled';
  /** In-flight items right now (streams, stages, jobs, commands). */
  readonly inFlight: number;
  /** Rolling 24 h counters. */
  readonly calls24h: number;
  readonly errors24h: number;
  readonly cost24h?: MoneyDisplay;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly from: WorkflowModuleId;
  readonly to: WorkflowModuleId;
  /** Name of the schema type carried on this link, e.g. "LlmRequest", "RetrievalHit[]", "FileOperation[]". */
  readonly contract: string;
  /** Time of the last event that travelled on this edge (drives the UI animation). */
  readonly lastFlowAt?: IsoDateTime;
}

export interface WorkflowGraph {
  /** null = aggregated over all projects. */
  readonly projectId: ProjectId | null;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly generatedAt: IsoDateTime;
}

export type ActivityKind = 'started' | 'progress' | 'completed' | 'failed' | 'info';

export interface ActivityEvent {
  readonly id: ActivityEventId;
  readonly projectId: ProjectId | null;
  readonly moduleId: WorkflowModuleId;
  /** Edge the data travelled on, when the event represents a hand-off between modules. */
  readonly edgeId?: string;
  readonly kind: ActivityKind;
  /** Human-readable, redacted: sizes, counts, model ids, stage names, paths — never prompt/document text or keys. */
  readonly summary: string;
  /** Deep-link references for the UI. */
  readonly refs: {
    readonly requestId?: LlmRequestId;
    readonly conversationId?: ConversationId;
    readonly pipelineRunId?: PipelineRunId;
    readonly ingestJobId?: IngestJobId;
    readonly ledgerEntryId?: LedgerEntryId;
    readonly transactionId?: TransactionId;
    readonly commandRunId?: CommandRunId;
  };
  readonly durationMs?: number;
  readonly cost?: MoneyDisplay;
  readonly ts: IsoDateTime;
}

/* ============================================================================
 * §13. IMAGE GENERATION (DEFERRED — M8; contracts frozen now to avoid later breakage)
 * ========================================================================== */

export const ImageProviderId = {
  OPENAI_DALLE3: 'openai_dalle3',
  FLUX_TOGETHER: 'flux_together',
  FLUX_REPLICATE: 'flux_replicate',
  /** No official API; adapter ships disabled (D12). */
  MIDJOURNEY_PROXY: 'midjourney_proxy',
} as const;
export type ImageProviderId = (typeof ImageProviderId)[keyof typeof ImageProviderId];

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageGenerationRequest {
  readonly projectId: ProjectId;
  readonly args: GenerateImageArgs;
  readonly toolCallId?: ToolCallId;
}

export interface ImageAsset {
  readonly id: ImageAssetId;
  readonly projectId: ProjectId;
  readonly provider: ImageProviderId;
  readonly prompt: string;
  /** Provider-rewritten prompt, if any (DALL·E 3 does this). */
  readonly revisedPrompt?: string;
  readonly size: ImageSize;
  readonly mimeType: ImageMimeType;
  /** Stored under app data dir; never a remote URL (remote URLs expire). */
  readonly localPath: string;
  readonly cost: MicroUsd;
  readonly createdAt: IsoDateTime;
}

/* ============================================================================
 * §14. AGENTS (v2 — M10; ARCHITECTURE.md §15). Types only; RPC methods are added by M10 tasks.
 * ========================================================================== */

export type AgentId = Brand<string, 'AgentId'>;
export type AgentRunId = Brand<string, 'AgentRunId'>;
export type RoutingRuleId = Brand<string, 'RoutingRuleId'>;

export const AgentTemplate = {
  PM: 'pm',
  ARCHITECT: 'architect',
  CODER: 'coder',
  QA: 'qa',
  EMAIL_ASSISTANT: 'email_assistant',
  PAGE_SUPPORT: 'page_support',
  CUSTOM: 'custom',
} as const;
export type AgentTemplate = (typeof AgentTemplate)[keyof typeof AgentTemplate];

/** Tools an agent may call. Anything that leaves the machine goes through the Outbox (D22). */
export const AgentToolName = {
  SEARCH_KNOWLEDGE: 'search_knowledge',
  RECALL_MEMORY: 'recall_memory',
  REMEMBER: 'remember',
  DRAFT_REPLY: 'draft_reply',
  START_PIPELINE: 'start_pipeline',
  GENERATE_IMAGE: 'generate_image',
} as const;
export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName];

export interface AgentMemoryPolicy {
  readonly enabled: boolean;
  /** Extract memories automatically after a user-driven conversation ends (D19). */
  readonly autoExtract: boolean;
  /** Extract from external channels (Gmail/Facebook). Default false (privacy). */
  readonly extractFromExternalChannels: boolean;
  readonly recallTopK: number;
  /** Memories are scoped to agent + project; true also recalls this agent's global (projectId=null) memories. */
  readonly shareAcrossProjects: boolean;
}

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly template: AgentTemplate;
  readonly description: string;
  /** Persona + rules; the common safety rules (ROLES §2) are appended automatically and cannot be removed. */
  readonly systemPrompt: string;
  /** Model fallback ladder for this agent (router ladderOverride). */
  readonly modelLadder: readonly ModelKey[];
  readonly tools: readonly AgentToolName[];
  readonly channels: readonly ChannelKind[];
  readonly memory: AgentMemoryPolicy;
  /** Built-in templates can be cloned and edited but not deleted. */
  readonly builtIn: boolean;
  readonly enabled: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Routes an inbound channel message to an agent. First matching enabled rule (by order) wins; no match → account's default agent. */
export interface RoutingRule {
  readonly id: RoutingRuleId;
  readonly order: number;
  readonly channel: ChannelKind;
  /** Case-insensitive substring matches; all omitted = match all. */
  readonly match: { readonly fromContains?: string; readonly subjectContains?: string; readonly textContains?: string };
  readonly agentId: AgentId;
  readonly enabled: boolean;
}

export const AgentRunStatus = {
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

/** One agent turn. Always started by a user action (D21) — never by a background timer. */
export interface AgentRun {
  readonly id: AgentRunId;
  readonly agentId: AgentId;
  readonly projectId: ProjectId;
  readonly trigger: { readonly kind: 'ui' | 'vscode' | 'channel_action'; readonly channelMessageId?: ChannelMessageId };
  readonly status: AgentRunStatus;
  readonly toolCalls: readonly ToolCall[];
  readonly recalledMemoryIds: readonly MemoryId[];
  readonly outboxItemIds: readonly OutboxItemId[];
  readonly cost: MoneyDisplay;
  readonly startedAt: IsoDateTime;
  readonly finishedAt?: IsoDateTime;
  readonly error?: AppError;
}

/* ============================================================================
 * §15. AGENT MEMORY (v2 — M11; ARCHITECTURE.md §16). Vectors in LanceDB; metadata in SQLite.
 * ========================================================================== */

export type MemoryId = Brand<string, 'MemoryId'>;

export const MemoryKind = {
  FACT: 'fact',
  PREFERENCE: 'preference',
  INSTRUCTION: 'instruction',
  EPISODE: 'episode',
} as const;
export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export interface MemoryItem {
  readonly id: MemoryId;
  readonly agentId: AgentId;
  /** null = global (shared across projects for this agent). */
  readonly projectId: ProjectId | null;
  readonly kind: MemoryKind;
  /** One self-contained statement, ≤ 500 chars. Never contains secrets (extractor prompt + filter enforce). */
  readonly text: string;
  /** 1 (trivia) … 5 (critical). */
  readonly importance: 1 | 2 | 3 | 4 | 5;
  readonly pinned: boolean;
  readonly source: {
    readonly kind: 'conversation' | 'channel' | 'manual';
    readonly conversationId?: ConversationId;
    readonly channelMessageId?: ChannelMessageId;
  };
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly lastRecalledAt?: IsoDateTime;
  /** Expired items are excluded from recall and purged on the next user-triggered memory maintenance. */
  readonly expiresAt?: IsoDateTime;
}

export interface MemoryRecallHit {
  readonly item: MemoryItem;
  /** similarity × importance weight × recency decay (ARCH §16.3). */
  readonly score: number;
}

/* ============================================================================
 * §16. CHANNELS & OUTBOX (v2 — M12–M14; ARCHITECTURE.md §17)
 * ========================================================================== */

export type ChannelAccountId = Brand<string, 'ChannelAccountId'>;
export type ChannelMessageId = Brand<string, 'ChannelMessageId'>;
export type OutboxItemId = Brand<string, 'OutboxItemId'>;

export const ChannelKind = {
  APP: 'app',
  VSCODE: 'vscode',
  GMAIL: 'gmail',
  FACEBOOK_PAGE: 'facebook_page',
} as const;
export type ChannelKind = (typeof ChannelKind)[keyof typeof ChannelKind];

/** External channels: inbound content is untrusted; outbound always requires approval (D22). */
export const EXTERNAL_CHANNELS: readonly ChannelKind[] = [ChannelKind.GMAIL, ChannelKind.FACEBOOK_PAGE];

export interface ChannelAccount {
  readonly id: ChannelAccountId;
  readonly kind: ChannelKind;
  /** Gmail address or Page name. */
  readonly displayName: string;
  /** OAuth / page tokens live in the OS keychain under `itstudio-channel/<id>`; never in this record. */
  readonly connected: boolean;
  readonly defaultAgentId: AgentId | null;
  readonly projectId: ProjectId;
  /** Gmail only: sender addresses allowed to issue commands by email (D23). */
  readonly commandSenders: readonly string[];
  readonly lastSyncedAt?: IsoDateTime;
}

export const InboundTriage = {
  UNTRIAGED: 'untriaged',
  URGENT: 'urgent',
  ACTION: 'action',
  FYI: 'fyi',
  SPAM: 'spam',
  COMMAND: 'command',
} as const;
export type InboundTriage = (typeof InboundTriage)[keyof typeof InboundTriage];

/** Normalised inbound message from any channel. Content is untrusted data. */
export interface ChannelMessage {
  readonly id: ChannelMessageId;
  readonly accountId: ChannelAccountId;
  readonly kind: ChannelKind;
  /** Provider ids for threading (Gmail threadId / FB conversation id). */
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly from: { readonly id: string; readonly name: string };
  readonly subject?: string;
  /** Plain text only (HTML stripped). */
  readonly text: string;
  readonly receivedAt: IsoDateTime;
  readonly triage: InboundTriage;
  readonly summary?: string;
  readonly handledByRunId?: AgentRunId;
}

export const OutboxStatus = {
  PENDING_APPROVAL: 'pending_approval',
  SENT: 'sent',
  REJECTED: 'rejected',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

/** A message an agent wants to send to an external channel. Nothing is sent until the user approves (D22). */
export interface OutboxItem {
  readonly id: OutboxItemId;
  readonly accountId: ChannelAccountId;
  readonly kind: ChannelKind;
  readonly runId: AgentRunId | null;
  readonly inReplyTo?: ChannelMessageId;
  readonly to: readonly string[];
  readonly subject?: string;
  /** Draft body; the user may edit before approving. Plain text; Facebook ≤ 2000 chars. */
  readonly body: string;
  readonly status: OutboxStatus;
  /** Facebook: replies allowed only within the 24 h messaging window; after this the item becomes `expired`. */
  readonly sendBefore?: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly decidedAt?: IsoDateTime;
  readonly error?: AppError;
}

/* ============================================================================
 * §17. INFRASTRUCTURE / SERVERS (v3 — M15–M19; ARCHITECTURE.md Part III §18–§22)
 * Types only; `AppSettings.monitoring` and `server.*` / `docker.*` / `sftp.*` RPC methods are added by M15 tasks.
 * ========================================================================== */

export type ServerId = Brand<string, 'ServerId'>;
export type ContainerId = Brand<string, 'ContainerId'>;
export type LogStreamId = Brand<string, 'LogStreamId'>;
/** POSIX-style absolute path on the remote host (Windows hosts use `/C:/...` SFTP form). */
export type RemotePath = Brand<string, 'RemotePath'>;

export const ServerOs = {
  LINUX: 'linux',
  MACOS: 'macos',
  WINDOWS: 'windows',
  UNKNOWN: 'unknown',
} as const;
export type ServerOs = (typeof ServerOs)[keyof typeof ServerOs];

export interface ServerConfig {
  readonly id: ServerId;
  readonly name: string;
  /** Hostname, Tailscale IP or public IP. */
  readonly host: string;
  readonly port: number;
  readonly username: string;
  /** Detected on first connect (`uname -s` / PowerShell probe); may be overridden. */
  readonly os: ServerOs;
  /** SHA-256 host key fingerprint pinned on first connect after user confirmation (TOFU). */
  readonly hostKeyFingerprint: string | null;
  /** The private key is stored encrypted in the app data dir; its decryption key lives in the OS keychain (ARCH §18.2). */
  readonly keyConfigured: boolean;
  readonly keyHasPassphrase: boolean;
  readonly tags: readonly string[];
  readonly createdAt: IsoDateTime;
}

export const ServerConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  OFFLINE: 'offline',
  AUTH_FAILED: 'auth_failed',
  HOST_KEY_MISMATCH: 'host_key_mismatch',
} as const;
export type ServerConnectionState = (typeof ServerConnectionState)[keyof typeof ServerConnectionState];

export interface BatteryInfo {
  readonly percent: number;
  readonly state: 'charging' | 'discharging' | 'full' | 'not_charging' | 'unknown';
}

export interface DiskUsage {
  readonly mount: string;
  readonly usedBytes: number;
  readonly totalBytes: number;
}

/** One metrics sample. Network rates are deltas between consecutive samples (first sample: 0). */
export interface ServerMetricsSample {
  readonly serverId: ServerId;
  readonly at: IsoDateTime;
  readonly uptimeSeconds: number;
  /** 0..100 across all cores. */
  readonly cpuPercent: number;
  readonly load1: number | null;
  readonly memUsedBytes: number;
  readonly memTotalBytes: number;
  readonly netRxBytesPerSec: number;
  readonly netTxBytesPerSec: number;
  readonly disks: readonly DiskUsage[];
  /** null when the host has no battery → UI hides the widget. */
  readonly battery: BatteryInfo | null;
}

export interface ServerStatus {
  readonly serverId: ServerId;
  readonly state: ServerConnectionState;
  readonly lastSample?: ServerMetricsSample;
  readonly lastError?: AppError;
  readonly dockerAvailable: boolean;
}

export const AlertMetric = {
  OFFLINE: 'offline',
  CPU_PERCENT: 'cpu_percent',
  MEM_PERCENT: 'mem_percent',
  DISK_PERCENT: 'disk_percent',
  BATTERY_PERCENT: 'battery_percent',
  CONTAINER_EXITED: 'container_exited',
} as const;
export type AlertMetric = (typeof AlertMetric)[keyof typeof AlertMetric];

export interface AlertRule {
  readonly metric: AlertMetric;
  /** Percent for percentage metrics; ignored for offline / container_exited. */
  readonly threshold: number;
  /** Condition must hold this long before firing (debounce). */
  readonly forSeconds: number;
  readonly enabled: boolean;
}

/** Added to AppSettings as `monitoring` in M15 (D25). */
export interface MonitoringSettings {
  /** false (default): poll only while the Servers tab is visible. true: poll continuously in the background and raise alerts. */
  readonly backgroundMonitoring: boolean;
  /** 3..60 s; default 5. */
  readonly pollIntervalSeconds: number;
  readonly alertRules: readonly AlertRule[];
  /** Alert delivery: in-app toast always; OS notification optional. */
  readonly osNotifications: boolean;
}

export interface ServerAlert {
  readonly serverId: ServerId;
  readonly metric: AlertMetric;
  readonly value: number | null;
  readonly message: string;
  readonly at: IsoDateTime;
  readonly resolved: boolean;
}

export interface ContainerInfo {
  readonly id: ContainerId;
  readonly name: string;
  readonly image: string;
  readonly state: 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead';
  readonly status: string;
  readonly ports: readonly { readonly hostPort: number | null; readonly containerPort: number; readonly protocol: 'tcp' | 'udp' }[];
  readonly createdAt: IsoDateTime;
}

export type ContainerAction = 'start' | 'stop' | 'restart';

export interface LogChunk {
  readonly streamId: LogStreamId;
  readonly stream: 'stdout' | 'stderr';
  /** Newline-separated lines, ≤ 64 KB per chunk. */
  readonly text: string;
  readonly at: IsoDateTime;
}

export interface RemoteFileEntry {
  readonly path: RemotePath;
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'symlink';
  readonly sizeBytes: number;
  readonly modifiedAt: IsoDateTime;
  readonly mode: number;
}

/** Save request for the remote editor (D27): rejected with CONFLICT when the remote file changed since it was opened. */
export interface RemoteFileWriteRequest {
  readonly serverId: ServerId;
  readonly path: RemotePath;
  readonly content: string;
  readonly baseSha256: Sha256;
  /** Default true: write `<file>.itstudio-bak-<timestamp>` before overwriting. */
  readonly backup: boolean;
}

export type SystemAction = 'reboot' | 'shutdown';
